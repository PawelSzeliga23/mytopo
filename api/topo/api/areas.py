from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select, text
from sqlalchemy.orm import Session, selectinload

from topo.api.common import area_path
from topo.api.deps import current_editor, start_change
from topo.api.errors import ApiError, not_found, raise_not_found
from topo.db import get_session, refresh_area_geom
from topo.editing import apply_fields
from topo.models import Area, Crag
from topo.queries import EMPTY_AREA_STATS, area_stats, crag_summaries
from topo.schemas import AreaChild, AreaOut, CragSummary
from topo.schemas_edit import AreaCreate, AreaPatch, DeleteBody
from topo.sectors import make_sector
from topo.slugs import unique_slug

router = APIRouter(tags=["areas"])


def _area_stats(session: Session, ids: list[int]) -> dict[int, dict[str, Any]]:
    rows = session.execute(
        text("""
            SELECT area_id,
                   ST_X(center) AS lng, ST_Y(center) AS lat,
                   ST_XMin(hull) AS xmin, ST_YMin(hull) AS ymin,
                   ST_XMax(hull) AS xmax, ST_YMax(hull) AS ymax
            FROM area_geom
            WHERE area_id = ANY(:ids)
        """),
        {"ids": ids},
    ).mappings()
    return {
        r["area_id"]: {
            "center": [r["lng"], r["lat"]],
            "bbox": [r["xmin"], r["ymin"], r["xmax"], r["ymax"]],
        }
        for r in rows
    }


@router.get("/{slug}", response_model=AreaOut)
def get_area(slug: str, session: Session = Depends(get_session)) -> AreaOut:
    area = session.scalar(select(Area).where(Area.slug == slug).options(selectinload(Area.children)))
    if area is None:
        raise not_found("obszar")
    stats = _area_stats(session, [area.id, *(child.id for child in area.children)])
    own = stats.get(area.id)
    counts = area_stats(session, [child.id for child in area.children])
    # The top level (e.g. the Jura) lists its regions only: its crags are thousands.
    crags = [] if area.kind == "obszar" else crag_summaries(session, area.id, with_sectors=True)
    return AreaOut(
        id=area.id,
        name=area.name,
        slug=area.slug,
        kind=area.kind,
        description=area.description,
        path=area_path(area.parent),
        children=[
            AreaChild(
                id=child.id,
                name=child.name,
                slug=child.slug,
                kind=child.kind,
                **counts.get(child.id, EMPTY_AREA_STATS),
            )
            for child in area.children
        ],
        crags=[CragSummary(**summary) for summary in crags],
        center=own["center"] if own else None,
        bbox=own["bbox"] if own else None,
    )


_PARENT_KIND = {"region": "obszar", "sektor": "region"}


def _parent_of_kind(session: Session, parent_id: int, kind: str) -> Area:
    parent = session.get(Area, parent_id)
    if parent is None or parent.kind != kind:
        raise ApiError(422, "invalid_parent", f"Nadrzędny obszar musi być typu „{kind}”")
    return parent


@router.post("", status_code=201)
def create_area(
    body: AreaCreate, nick: str = Depends(current_editor), session: Session = Depends(get_session)
) -> dict[str, Any]:
    parent = _parent_of_kind(session, body.parent_id, _PARENT_KIND[body.kind])
    if body.crag_ids and body.kind != "sektor":
        raise ApiError(422, "invalid_crags", "Skały można wskazać tylko przy tworzeniu sektora")
    crags = [session.get(Crag, crag_id) or raise_not_found("skała") for crag_id in dict.fromkeys(body.crag_ids or [])]
    start_change(session, nick, body.comment)
    if body.kind == "sektor":
        area = make_sector(session, parent, body.name, body.description, crags)
    else:
        area = Area(
            kind="region", parent=parent, name=body.name, description=body.description,
            slug=unique_slug(session, Area, body.name), source="manual",
        )  # fmt: skip
        session.add(area)
    session.flush()
    refresh_area_geom(session)
    session.commit()
    return {"id": area.id, "slug": area.slug}


@router.patch("/{area_id:int}")
def patch_area(
    area_id: int, body: AreaPatch, nick: str = Depends(current_editor), session: Session = Depends(get_session)
) -> dict[str, Any]:
    area = session.get(Area, area_id) or raise_not_found("obszar")
    data = body.model_dump(exclude_unset=True)
    start_change(session, nick, data.pop("comment", None))
    if "parent_id" in data:
        if area.parent is None:
            raise ApiError(422, "invalid_parent", "Tego obszaru nie można przenieść")
        if data["parent_id"] != area.parent_id:
            _parent_of_kind(session, data["parent_id"], area.parent.kind)
        else:
            data.pop("parent_id")
    changed = apply_fields(area, data)
    if not changed:
        session.rollback()
        return {"id": area_id, "slug": area.slug, "changed": []}
    if "parent_id" in changed:
        session.flush()
        refresh_area_geom(session)
    session.commit()
    return {"id": area.id, "slug": area.slug, "changed": sorted(changed)}


@router.delete("/{area_id:int}", status_code=204)
def remove_area(
    area_id: int,
    comment: Annotated[str | None, Query(max_length=500)] = None,
    nick: str = Depends(current_editor),
    session: Session = Depends(get_session),
) -> Response:
    area = session.get(Area, area_id) or raise_not_found("obszar")
    if area.children or area.crags:
        raise ApiError(409, "area_not_empty", "Najpierw przenieś skały i sektory")
    start_change(session, nick, DeleteBody(comment=comment).comment)
    session.delete(area)
    session.flush()
    refresh_area_geom(session)
    session.commit()
    return Response(status_code=204)
