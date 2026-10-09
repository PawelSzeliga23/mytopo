"""Reverting a history transaction: a plan with conflict detection, then inserts, field restores and deletes.

The whole revert is one database transaction (one history transaction by the reverting editor).
"""

from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

import numpy as np
import sqlalchemy as sa
from PIL import Image
from sqlalchemy.orm import Session
from sqlalchemy_continuum import version_class

from topo.changes import KIND, ObjectChange, transaction_changes, version_values
from topo.db import refresh_area_geom
from topo.depth import DEPTH_FILE, SEGMENTS_FILE, update_wall_fields, vegetation_stats
from topo.editing import apply_grade, delete_crag, delete_line, delete_route, delete_wall, location_from, location_of
from topo.history import current_transaction_id, set_author, transaction_class
from topo.models import Area, Crag, LinePoint, Route, RouteLine, Wall
from topo.slugs import unique_slug
from topo.topo_edit import bump_wall_versions, walls_touched

Mode = Literal["check", "safe", "all"]

# Columns pointing at other restorable objects: (model, column). The first one is the required parent
# (Area.parent_id may be empty); RouteLine.route_id and the variant branch point are optional.
REFERENCES: dict[type, list[tuple[type, str]]] = {
    Area: [(Area, "parent_id")],
    Crag: [(Area, "area_id")],
    Wall: [(Crag, "crag_id")],
    Route: [(Crag, "crag_id")],
    RouteLine: [(Wall, "wall_id"), (Route, "route_id"), (LinePoint, "parent_point_id")],
    LinePoint: [(RouteLine, "line_id")],
}
# Rows that deleting an object would take with it (or that block deleting it): (child model, column).
CHILDREN: dict[type, list[tuple[type, str]]] = {
    Area: [(Area, "parent_id"), (Crag, "area_id")],
    Crag: [(Wall, "crag_id"), (Route, "crag_id")],
    Wall: [(RouteLine, "wall_id")],
    Route: [(RouteLine, "route_id")],
    RouteLine: [(LinePoint, "line_id")],
    LinePoint: [],
}
VARIANT_FIELDS = ("parent_line_id", "parent_point_id")
_LABEL = {"area": "obszar", "crag": "skałę", "wall": "ścianę", "route": "drogę", "line": "linię", "point": "punkt"}
_DELETE: dict[type, Callable[[Session, Any], None]] = {
    Crag: delete_crag, Wall: delete_wall, Route: delete_route, RouteLine: delete_line,
}  # fmt: skip

Key = tuple[type, int]


@dataclass
class Conflict:
    kind: str
    id: int
    name: str | None
    field: str  # "*" = the object as a whole was changed or deleted later
    author: str | None
    issued_at: datetime | None
    current: Any
    restored: Any


class RevertConflict(Exception):
    def __init__(self, conflicts: list[Conflict]):
        super().__init__(f"{len(conflicts)} konflikt(y) cofania")
        self.conflicts = conflicts


class MissingParent(Exception):
    def __init__(self, kind: str, name: str | None, transaction_id: int | None):
        self.kind, self.name, self.transaction_id = kind, name, transaction_id
        self.message = f"Najpierw przywróć: {name or _LABEL[kind]}"
        super().__init__(self.message)


@dataclass
class _Plan:
    inserts: list[ObjectChange] = field(default_factory=list)  # deleted in T, restored from their last version
    restores: dict[Key, tuple[Any, dict[str, Any]]] = field(default_factory=dict)  # object, field -> value before T
    deletes: list[Key] = field(default_factory=list)  # created in T; children first
    conflicts: list[Conflict] = field(default_factory=list)


def _norm(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, 7)
    if isinstance(value, list | tuple):
        return [_norm(v) for v in value]
    return value


def _current(obj: Any, name: str) -> Any:
    value = getattr(obj, name)
    if name == "location" and value is not None:
        return location_of(obj)
    if isinstance(value, list | tuple):
        return list(value)
    return value


def _later(session: Session, model: type, obj_id: int, tx_id: int) -> tuple[str | None, datetime | None] | None:
    """Author and time of the newest version of the object written after transaction ``tx_id``."""
    version, tx = version_class(model), transaction_class()
    row = session.execute(
        sa.select(tx.author, tx.issued_at)
        .select_from(version)
        .outerjoin(tx, tx.id == version.transaction_id)
        .where(version.id == obj_id, version.transaction_id > tx_id)
        .order_by(version.transaction_id.desc())
        .limit(1)
    ).first()
    return (row.author, row.issued_at) if row else None


def _missing_parent(session: Session, model: type, obj_id: int) -> MissingParent:
    version = version_class(model)
    last = session.scalars(
        sa.select(version).where(version.id == obj_id).order_by(version.transaction_id.desc()).limit(1)
    ).first()
    deleted_in = session.scalar(
        sa.select(sa.func.max(version.transaction_id)).where(version.id == obj_id, version.operation_type == 2)
    )
    return MissingParent(KIND[model], getattr(last, "name", None), deleted_in)


class _Planner:
    def __init__(self, session: Session, tx_id: int, force: bool):
        self.session, self.tx_id, self.force = session, tx_id, force
        self.plan = _Plan()
        self.inserting: set[Key] = set()

    def exists(self, model: type, obj_id: int) -> bool:
        return (model, obj_id) in self.inserting or self.session.get(model, obj_id) is not None

    def conflict(self, change: ObjectChange, name: str | None, fld: str, later, current=None, restored=None) -> None:
        author, issued_at = later or (None, None)
        self.plan.conflicts.append(
            Conflict(KIND[change.model], change.id, name, fld, author, issued_at, current, restored)
        )

    def run(self, changes: list[ObjectChange]) -> _Plan:
        for change in changes:
            if change.op == "deleted" and self.session.get(change.model, change.id) is None:
                self.plan.inserts.append(self.state_before(change))
                self.inserting.add((change.model, change.id))
        for change in self.plan.inserts:
            parent, column = REFERENCES[change.model][0]
            parent_id = change.before[column]
            if parent_id is not None and not self.exists(parent, parent_id):
                raise _missing_parent(self.session, parent, parent_id)
        for change in changes:
            if change.op == "updated":
                self.update(change)
        for change in reversed(changes):  # children first, so a parent sees which children go away
            if change.op == "created":
                self.delete(change)
        return self.plan

    def state_before(self, change: ObjectChange) -> ObjectChange:
        """A deleted object restored from its last version before T rather than from the delete row: on delete,
        SQLAlchemy clears a variant's parent pair (post_update) before Continuum copies the state."""
        version = version_class(change.model)
        previous = self.session.scalars(
            sa.select(version)
            .where(version.id == change.id, version.transaction_id < self.tx_id)
            .order_by(version.transaction_id.desc())
            .limit(1)
        ).first()
        return replace(change, before=version_values(change.model, previous)) if previous else change

    def update(self, change: ObjectChange) -> None:
        obj = self.session.get(change.model, change.id)
        if obj is None or change.before is None:  # deleted since, or the state before T is unknown
            name = getattr(obj, "name", None) if obj is not None else change.after.get("name")
            self.conflict(change, name, "*", _later(self.session, change.model, change.id, self.tx_id))
            return
        values: dict[str, Any] = {}
        for diff in change.diffs:
            current = _current(obj, diff.field)
            if _norm(current) == _norm(diff.before):
                continue
            if _norm(current) != _norm(diff.after):
                later = _later(self.session, change.model, change.id, self.tx_id)
                self.conflict(change, getattr(obj, "name", None), diff.field, later, current, diff.before)
                if not self.force:
                    continue
            values[diff.field] = diff.before
        self.check_references(change.model, obj, values)
        if values:
            self.plan.restores[change.model, change.id] = (obj, values)

    def check_references(self, model: type, obj: Any, values: dict[str, Any]) -> None:
        parent, column = REFERENCES[model][0]
        if values.get(column) is not None and not self.exists(parent, values[column]):
            raise _missing_parent(self.session, parent, values[column])
        if model is not RouteLine:
            return
        if values.get("route_id") is not None and not self.exists(Route, values["route_id"]):
            del values["route_id"]
        if any(name in values for name in VARIANT_FIELDS):
            point = values.get("parent_point_id", obj.parent_point_id)
            if point is not None and not self.exists(LinePoint, point):
                for name in VARIANT_FIELDS:  # the branch point is gone for good: leave the pair as it is
                    values.pop(name, None)

    def delete(self, change: ObjectChange) -> None:
        obj = self.session.get(change.model, change.id)
        if obj is None:
            return
        later = _later(self.session, change.model, change.id, self.tx_id)
        child = None if later else self.remaining_child(change.model, change.id)
        if later or child:
            if child:
                later = _later(self.session, *child, self.tx_id)
            self.conflict(change, getattr(obj, "name", None), "*", later)
            if not self.force:
                return
        self.plan.deletes.append((change.model, change.id))

    def remaining_child(self, model: type, obj_id: int) -> Key | None:
        """A row attached to the object that this revert neither deletes nor moves away (added or moved in later)."""
        deleting = set(self.plan.deletes)
        for child, column in CHILDREN[model]:
            for child_id in self.session.scalars(sa.select(child.id).where(getattr(child, column) == obj_id)):
                if (child, child_id) in deleting:
                    continue
                restored = self.plan.restores.get((child, child_id))
                if restored and restored[1].get(column, obj_id) != obj_id:
                    continue
                return child, child_id
        return None


def _slug_taken(session: Session, model: type, slug: str) -> bool:
    return session.scalar(sa.select(model.id).where(model.slug == slug)) is not None


def _build(session: Session, change: ObjectChange) -> Any:
    values = dict(change.before)
    if values.get("location") is not None:
        values["location"] = location_from(tuple(values["location"]))
    if "slug" in values and _slug_taken(session, change.model, values["slug"]):
        values["slug"] = unique_slug(session, change.model, values["name"])
    if change.model is RouteLine:
        if values["route_id"] is not None and session.get(Route, values["route_id"]) is None:
            values["route_id"] = None
        if values["parent_point_id"] is not None and session.get(LinePoint, values["parent_point_id"]) is None:
            values["parent_line_id"] = values["parent_point_id"] = None
    return change.model(**values)


def _insert(session: Session, inserts: list[ObjectChange]) -> None:
    """Insert in rounds: an object goes in once everything it points to (including a variant's branch point on
    another restored line) is in, so each row is written once with its final values and stays "created"."""
    pending = {(change.model, change.id): change for change in inserts}
    while pending:
        ready = [
            change for key, change in pending.items()
            if not any(
                (model, change.before[column]) in pending and (model, change.before[column]) != key
                for model, column in REFERENCES[change.model]
            )
        ]  # fmt: skip
        ready = ready or [next(iter(pending.values()))]  # a reference cycle: the optional link is dropped
        for change in ready:
            del pending[change.model, change.id]
            session.add(_build(session, change))
        session.flush()


def _restore(session: Session, restores: dict[Key, tuple[Any, dict[str, Any]]]) -> None:
    for obj, values in restores.values():
        for name, value in values.items():
            if name == "location":
                obj.location = location_from(tuple(value))
            elif name == "grade" and isinstance(obj, Route):
                apply_grade(obj, value)
            else:
                setattr(obj, name, value)
    session.flush()
    session.expire_all()  # collections (crag.walls, area.crags) must see the moved rows before deleting


def _delete(session: Session, deletes: list[Key]) -> None:
    for model, obj_id in deletes:
        obj = session.get(model, obj_id)
        if obj is None:
            continue
        if model is Area and (obj.children or obj.crags):  # "all" mode: a sector still in use stays
            continue
        _DELETE.get(model, lambda s, o: s.delete(o))(session, obj)
        session.flush()


def _restore_depth(session: Session, wall_ids: list[int], media_root: Path) -> None:
    """Depth and segmentation are written outside history, so a restored wall takes them from the files on disk."""
    for wall_id in wall_ids:
        wall = session.get(Wall, wall_id)
        if wall is None:
            continue
        folder = media_root / "walls" / str(wall_id)
        values: dict[str, Any] = {
            "depth_status": "pending", "depth_path": None, "vegetation_ratio": None, "route_vegetation_ratio": None,
        }  # fmt: skip
        if (folder / DEPTH_FILE).exists():
            values.update(depth_status="ready", depth_path=f"walls/{wall_id}/{DEPTH_FILE}")
        if (folder / SEGMENTS_FILE).exists():
            with Image.open(folder / SEGMENTS_FILE) as image:
                classes = np.array(image)
            lines = [[(point.x, point.y) for point in line.points] for line in wall.lines]
            values["vegetation_ratio"], values["route_vegetation_ratio"] = vegetation_stats(classes, lines)
        update_wall_fields(session, wall_id, **values)


def revert_transaction(
    session: Session, tx_id: int, nick: str, comment: str | None, mode: Mode, media_root: Path
) -> int | None:
    """Undo transaction ``tx_id``; return the new transaction's id (None when there was nothing left to undo).

    "check" raises RevertConflict when anything changed later (nothing is written); "safe" skips the conflicting
    fields and objects; "all" overwrites them.
    """
    changes = transaction_changes(session, tx_id)
    note = f"cofnięcie #{tx_id}" + (f": {comment.strip()}" if comment and comment.strip() else "")
    set_author(session, nick, note[:500], reverts_id=tx_id)
    try:
        # "check" plans like "all": the conflict list then names only what changed later, not its consequences.
        plan = _Planner(session, tx_id, force=mode != "safe").run(changes)
        if mode == "check" and plan.conflicts:
            raise RevertConflict(plan.conflicts)
        _insert(session, plan.inserts)
        _restore(session, plan.restores)
        _delete(session, plan.deletes)
        _restore_depth(session, [c.id for c in plan.inserts if c.model is Wall], media_root)
        # An open topo editor must notice that the lines under it changed.
        bump_wall_versions(session, walls_touched(session, changes))
        refresh_area_geom(session)
        new_id = current_transaction_id(session)
    except Exception:
        session.rollback()
        raise
    session.commit()
    return new_id
