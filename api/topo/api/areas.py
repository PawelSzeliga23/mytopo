from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select, text
from sqlalchemy.orm import Session, selectinload

from topo.api.common import area_path
from topo.api.errors import not_found
from topo.db import get_session
from topo.models import Area
from topo.queries import crag_summaries
from topo.schemas import AreaChild, AreaOut, CragSummary

router = APIRouter(tags=["areas"])


def _area_stats(session: Session, ids: list[int]) -> dict[int, dict[str, Any]]:
    rows = session.execute(
        text("""
            SELECT area_id, crag_count, route_count,
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
            "crag_count": r["crag_count"],
            "route_count": r["route_count"],
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
                crag_count=stats.get(child.id, {}).get("crag_count", 0),
                route_count=stats.get(child.id, {}).get("route_count", 0),
            )
            for child in area.children
        ],
        crags=[CragSummary(**summary) for summary in crag_summaries(session, area.id)],
        center=own["center"] if own else None,
        bbox=own["bbox"] if own else None,
    )
