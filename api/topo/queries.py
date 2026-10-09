from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from topo.grades import BAND_LIMITS


def crag_summaries(session: Session, area_id: int | None = None) -> list[dict[str, Any]]:
    """Crags with route counts and route counts per grade band (see topo.grades.grade_band)."""
    b1, b2, b3 = BAND_LIMITS
    params: dict[str, Any] = {"b1": b1, "b2": b2, "b3": b3}
    where = ""
    if area_id is not None:
        where = "WHERE c.area_id = :area_id"
        params["area_id"] = area_id
    rows = session.execute(
        text(f"""
            SELECT c.id, c.name, c.slug, c.area_id, a.kind = 'sektor' AS in_sector, a.kind AS area_kind, c.needs_location,
                   ST_X(c.location) AS lng, ST_Y(c.location) AS lat,
                   count(r.id)::int AS route_count,
                   count(r.id) FILTER (WHERE r.grade_sort < :b1)::int AS band0,
                   count(r.id) FILTER (WHERE r.grade_sort >= :b1 AND r.grade_sort < :b2)::int AS band1,
                   count(r.id) FILTER (WHERE r.grade_sort >= :b2 AND r.grade_sort < :b3)::int AS band2,
                   count(r.id) FILTER (WHERE r.grade_sort >= :b3)::int AS band3,
                   (array_agg(r.grade ORDER BY r.grade_sort, r.id) FILTER (WHERE r.grade_sort IS NOT NULL))[1] AS grade_min,
                   min(r.grade_sort)::int AS grade_min_sort,
                   (array_agg(r.grade ORDER BY r.grade_sort DESC, r.id) FILTER (WHERE r.grade_sort IS NOT NULL))[1] AS grade_max,
                   max(r.grade_sort)::int AS grade_max_sort
            FROM crag c
            JOIN area a ON a.id = c.area_id
            LEFT JOIN route r ON r.crag_id = c.id
            {where}
            GROUP BY c.id, a.kind
            ORDER BY c.name
        """),
        params,
    ).mappings()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "slug": r["slug"],
            "area_id": r["area_id"],
            "in_sector": r["in_sector"],
            "area_kind": r["area_kind"],
            "needs_location": r["needs_location"],
            "lng": r["lng"],
            "lat": r["lat"],
            "route_count": r["route_count"],
            "grade_bands": [r["band0"], r["band1"], r["band2"], r["band3"]],
            "grade_min": r["grade_min"],
            "grade_min_sort": r["grade_min_sort"],
            "grade_max": r["grade_max"],
            "grade_max_sort": r["grade_max_sort"],
        }
        for r in rows
    ]
