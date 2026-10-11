from typing import Any, Literal

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from topo.db import get_session
from topo.queries import EMPTY_AREA_STATS, area_stats, crag_summaries

router = APIRouter(tags=["map"])

_AREA_GEOMETRY = {"center": "g.center", "hull": "g.hull"}
_CRAG_PROPERTIES = (
    "id", "name", "slug", "area_id", "in_sector", "area_kind", "needs_location", "route_count", "grade_bands",
    "grade_min", "grade_min_sort", "grade_max", "grade_max_sort", "by_kind",
)  # fmt: skip


def _feature(geometry: dict[str, Any], properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "Feature", "geometry": geometry, "properties": properties}


def _collection(features: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "FeatureCollection", "features": features}


@router.get("/areas")
def map_areas(
    kind: Literal["obszar", "region", "sektor"],
    geometry: Literal["center", "hull"] = "center",
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    rows = session.execute(
        text(f"""
            SELECT a.id, a.name, a.slug, a.kind, a.parent_id,
                   ST_AsGeoJSON({_AREA_GEOMETRY[geometry]}, 6)::json AS geom,
                   ST_X(g.center) AS lng, ST_Y(g.center) AS lat,
                   ST_XMin(g.hull) AS xmin, ST_YMin(g.hull) AS ymin,
                   ST_XMax(g.hull) AS xmax, ST_YMax(g.hull) AS ymax
            FROM area a
            JOIN area_geom g ON g.area_id = a.id
            WHERE a.kind = :kind
            ORDER BY a.name
        """),
        {"kind": kind},
    ).mappings()
    counts = area_stats(session, kind=kind)
    return _collection(
        [
            _feature(
                r["geom"],
                {
                    "id": r["id"],
                    "name": r["name"],
                    "slug": r["slug"],
                    "kind": r["kind"],
                    "parent_id": r["parent_id"],
                    **counts.get(r["id"], EMPTY_AREA_STATS),
                    "center": [round(r["lng"], 6), round(r["lat"], 6)],
                    "bbox": [r["xmin"], r["ymin"], r["xmax"], r["ymax"]],
                },
            )
            for r in rows
        ]
    )


@router.get("/crags")
def map_crags(session: Session = Depends(get_session)) -> dict[str, Any]:
    return _collection(
        [
            _feature(
                {"type": "Point", "coordinates": [round(c["lng"], 6), round(c["lat"], 6)]},
                {key: c[key] for key in _CRAG_PROPERTIES},
            )
            for c in crag_summaries(session)
        ]
    )
