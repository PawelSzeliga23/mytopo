"""What a history transaction changed: per-object before/after values, field diffs, and the filtered change list."""

from dataclasses import dataclass
from typing import Any, Literal

import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy_continuum import version_class

from topo.api.common import area_path
from topo.editing import location_of
from topo.history import IMPORT_AUTHOR_PREFIX, transaction_class
from topo.models import Area, Crag, LinePoint, Route, RouteLine, Wall
from topo.schemas import ChangeOut, CragRef, FieldDiffOut, ObjectChangeOut

MODELS: list[type] = [Area, Crag, Wall, Route, RouteLine, LinePoint]  # parent -> child
KIND = {Area: "area", Crag: "crag", Wall: "wall", Route: "route", RouteLine: "line", LinePoint: "point"}
SKIP_FIELDS = frozenset({
    "version", "source", "source_id", "source_url", "grade_sort", "image_original_path", "image_path", "thumb_path",
    "image_width", "image_height", "depth_path", "depth_status", "depth_model", "vegetation_ratio",
    "route_vegetation_ratio", "depth_enabled", "needs_location",
})

Op = Literal["created", "updated", "deleted"]
_OPS: dict[int, Op] = {0: "created", 1: "updated", 2: "deleted"}


@dataclass
class FieldDiff:
    field: str
    before: Any
    after: Any


@dataclass
class ObjectChange:
    model: type
    id: int
    op: Op
    before: dict[str, Any] | None  # column values before the transaction (None for created)
    after: dict[str, Any] | None  # column values after it (None for deleted)
    diffs: list[FieldDiff]  # fields outside SKIP_FIELDS that differ (created/deleted: all non-empty ones)


def version_values(model: type, row) -> dict[str, Any]:
    """All model columns from a version row; the location comes out as [lon, lat]."""
    values = {column.key: getattr(row, column.key) for column in model.__table__.columns}
    if values.get("location") is not None:
        values["location"] = location_of(row)
    return values


def _is_empty(value: Any) -> bool:
    return value is None or value == "" or value == []


def _diffs(op: Op, before: dict[str, Any] | None, after: dict[str, Any] | None) -> list[FieldDiff]:
    names = [name for name in (after or before or {}) if name not in SKIP_FIELDS and name != "id"]
    if op == "updated" and before is not None:
        return [FieldDiff(n, before[n], after[n]) for n in names if before[n] != after[n]]
    if op in ("created", "updated"):  # updated here means before is unknown: list the non-empty values
        return [FieldDiff(n, None, after[n]) for n in names if not _is_empty(after[n])]
    return [FieldDiff(n, before[n], None) for n in names if not _is_empty(before[n])]


def _latest_version(session: Session, model: type, obj_id: int, tx_id: int, *, inclusive: bool = False):
    """Newest version row of the object from before transaction ``tx_id`` (or up to and including it)."""
    version = version_class(model)
    cond = version.transaction_id <= tx_id if inclusive else version.transaction_id < tx_id
    return session.scalars(
        sa.select(version).where(version.id == obj_id, cond).order_by(version.transaction_id.desc()).limit(1)
    ).first()


def transaction_changes(session: Session, tx_id: int) -> list[ObjectChange]:
    changes: list[ObjectChange] = []
    for model in MODELS:
        version = version_class(model)
        rows = session.scalars(sa.select(version).where(version.transaction_id == tx_id).order_by(version.id))
        for row in rows:
            op = _OPS[row.operation_type]
            current = version_values(model, row)
            before: dict[str, Any] | None
            if op == "created":
                before, after = None, current
            elif op == "deleted":
                before, after = current, None  # Continuum copies the last state into the delete row
            else:
                previous = _latest_version(session, model, row.id, tx_id)
                # No earlier version (row predates versioning): baseline unknown, so it stays "updated" with before=None.
                before, after = (version_values(model, previous) if previous else None), current
            changes.append(ObjectChange(model, row.id, op, before, after, _diffs(op, before, after)))
    return changes


def _plural(n: int, one: str, few: str, many: str) -> str:
    if n == 1:
        return f"{n} {one}"
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return f"{n} {few}"
    return f"{n} {many}"


def _topo_summary(lines: int, points: int) -> str:
    parts = []
    if lines:
        parts.append(_plural(lines, "linię", "linie", "linii"))
    if points:
        parts.append(_plural(points, "punkt", "punkty", "punktów"))
    return "zmieniono " + ", ".join(parts)


def _object_changes(session: Session, tx_id: int, changes: list[ObjectChange]) -> tuple[list[ObjectChangeOut], int | None]:
    """Output objects (line and point changes folded into one "topo" object per wall) and the first crag concerned."""
    objects: list[ObjectChangeOut] = []
    topo: dict[int, dict[str, int]] = {}  # wall id -> number of changed lines / points
    cache: dict[tuple[type, int], Any] = {}

    def latest(model: type, obj_id: int):
        if (model, obj_id) not in cache:
            cache[model, obj_id] = _latest_version(session, model, obj_id, tx_id, inclusive=True)
        return cache[model, obj_id]

    crag_id: int | None = None
    for change in changes:
        values = change.after if change.after is not None else change.before
        if change.model is Crag:
            this_crag = change.id
        elif change.model in (Wall, Route):
            this_crag = values["crag_id"]
        elif change.model is Area:
            this_crag = None
        else:
            if change.model is RouteLine:
                wall_id = values["wall_id"]
            else:
                line = latest(RouteLine, values["line_id"])
                wall_id = line.wall_id if line else None
            wall = latest(Wall, wall_id) if wall_id else None
            this_crag = wall.crag_id if wall else None
            if wall_id is not None:
                counts = topo.setdefault(wall_id, {"lines": 0, "points": 0})
                counts["lines" if change.model is RouteLine else "points"] += 1
        if crag_id is None:
            crag_id = this_crag
        if change.model in (RouteLine, LinePoint):
            continue
        objects.append(
            ObjectChangeOut(
                kind=KIND[change.model], id=change.id, name=values.get("name"), op=change.op,
                diffs=[FieldDiffOut(field=d.field, before=d.before, after=d.after) for d in change.diffs], summary=None,
            )
        )
    for wall_id, counts in topo.items():
        wall = latest(Wall, wall_id)
        objects.append(
            ObjectChangeOut(
                kind="topo", id=wall_id, name=wall.name if wall else None, op="updated", diffs=[],
                summary=_topo_summary(counts["lines"], counts["points"]),
            )
        )
    return objects, crag_id


def _crag_ref(session: Session, crag_id: int | None, tx_id: int) -> tuple[CragRef | None, list]:
    if crag_id is None:
        return None, []
    crag = session.get(Crag, crag_id)
    if crag is not None:
        return CragRef(id=crag.id, name=crag.name, slug=crag.slug), area_path(crag.area)
    version = _latest_version(session, Crag, crag_id, tx_id, inclusive=True)
    return (CragRef(id=crag_id, name=version.name, slug=None) if version else None), []


def _tx_ids_where(model: type, *conditions) -> sa.Select:
    return sa.select(version_class(model).transaction_id).where(*conditions)


def _crag_filter(tx, crag_id: int):
    """Transactions touching the crag, its walls, routes, lines or points, including ones deleted or moved away."""
    crag_v, wall_v, route_v = (version_class(m) for m in (Crag, Wall, Route))
    line_v, point_v = version_class(RouteLine), version_class(LinePoint)
    walls = sa.select(wall_v.id).where(wall_v.crag_id == crag_id)
    lines = sa.select(line_v.id).where(line_v.wall_id.in_(walls))
    return sa.or_(
        tx.id.in_(_tx_ids_where(Crag, crag_v.id == crag_id)),
        tx.id.in_(_tx_ids_where(Wall, wall_v.crag_id == crag_id)),
        tx.id.in_(_tx_ids_where(Route, route_v.crag_id == crag_id)),
        tx.id.in_(_tx_ids_where(RouteLine, line_v.wall_id.in_(walls))),
        tx.id.in_(_tx_ids_where(LinePoint, point_v.line_id.in_(lines))),
    )


def list_changes(
    session: Session, *, crag_id: int | None, kind: Literal["all", "deleted"], include_import: bool, limit: int,
    before: int | None,
) -> list[ChangeOut]:
    tx = transaction_class()
    conditions = [tx.id.in_(sa.union(*(_tx_ids_where(m) for m in MODELS)))]  # skip transactions that changed nothing
    if crag_id is not None:
        conditions.append(_crag_filter(tx, crag_id))
    if kind == "deleted":
        deleted = [_tx_ids_where(m, version_class(m).operation_type == 2) for m in (Crag, Route, Wall)]
        conditions.append(tx.id.in_(sa.union(*deleted)))
    if not include_import:
        conditions.append(sa.or_(tx.author.is_(None), sa.not_(tx.author.startswith(IMPORT_AUTHOR_PREFIX))))
    if before is not None:
        conditions.append(tx.id < before)
    transactions = session.scalars(sa.select(tx).where(*conditions).order_by(tx.id.desc()).limit(limit)).all()

    ids = [t.id for t in transactions]
    reverted_by = dict(
        session.execute(
            sa.select(tx.reverts_id, sa.func.max(tx.id)).where(tx.reverts_id.in_(ids)).group_by(tx.reverts_id)
        ).all()
    )
    result = []
    for t in transactions:
        objects, first_crag = _object_changes(session, t.id, transaction_changes(session, t.id))
        crag, path = _crag_ref(session, first_crag, t.id)
        result.append(
            ChangeOut(
                id=t.id, author=t.author, comment=t.comment, issued_at=t.issued_at,
                is_import=bool(t.author and t.author.startswith(IMPORT_AUTHOR_PREFIX)), reverts_id=t.reverts_id,
                reverted_by=reverted_by.get(t.id), crag=crag, area_path=path, objects=objects,
            )
        )
    return result
