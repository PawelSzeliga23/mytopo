from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from topo.grades import BAND_LIMITS

# Route-kind variants of every statistic: all routes, then sport and trad only (view route_kind, migration 0010).
KINDS = ("sport", "trad")
_VARIANTS = {"": "r.id IS NOT NULL", "sport_": "rk.kind = 'sport'", "trad_": "rk.kind = 'trad'"}


def _band_columns(prefix: str, cond: str) -> str:
    return f"""
        count(r.id) FILTER (WHERE {cond})::int AS {prefix}route_count,
        count(r.id) FILTER (WHERE {cond} AND r.grade_sort < :b1)::int AS {prefix}band0,
        count(r.id) FILTER (WHERE {cond} AND r.grade_sort >= :b1 AND r.grade_sort < :b2)::int AS {prefix}band1,
        count(r.id) FILTER (WHERE {cond} AND r.grade_sort >= :b2 AND r.grade_sort < :b3)::int AS {prefix}band2,
        count(r.id) FILTER (WHERE {cond} AND r.grade_sort >= :b3)::int AS {prefix}band3"""


def _range_columns(prefix: str, cond: str) -> str:
    graded = f"{cond} AND r.grade_sort IS NOT NULL"
    return f"""
        (array_agg(r.grade ORDER BY r.grade_sort, r.id) FILTER (WHERE {graded}))[1] AS {prefix}grade_min,
        (min(r.grade_sort) FILTER (WHERE {graded}))::int AS {prefix}grade_min_sort,
        (array_agg(r.grade ORDER BY r.grade_sort DESC, r.id) FILTER (WHERE {graded}))[1] AS {prefix}grade_max,
        (max(r.grade_sort) FILTER (WHERE {graded}))::int AS {prefix}grade_max_sort"""


def _bands(r: Any, prefix: str) -> dict[str, Any]:
    return {
        "route_count": r[f"{prefix}route_count"],
        "grade_bands": [r[f"{prefix}band0"], r[f"{prefix}band1"], r[f"{prefix}band2"], r[f"{prefix}band3"]],
    }


def _crag_stats(r: Any, prefix: str) -> dict[str, Any]:
    return {**_bands(r, prefix), **{key: r[f"{prefix}{key}"] for key in ("grade_min", "grade_min_sort", "grade_max", "grade_max_sort")}}


def _band_params() -> dict[str, Any]:
    b1, b2, b3 = BAND_LIMITS
    return {"b1": b1, "b2": b2, "b3": b3}


def crag_summaries(session: Session, area_id: int | None = None, with_sectors: bool = False) -> list[dict[str, Any]]:
    """Crags with route counts, routes per grade band (see topo.grades.grade_band) and grade range;
    the same statistics for sport and trad routes alone in ``by_kind``.

    ``with_sectors``: also the crags in the sectors of ``area_id`` (a region page lists both).
    """
    params = _band_params()
    where = ""
    if area_id is not None:
        where = "WHERE c.area_id = :area_id" + (" OR a.parent_id = :area_id" if with_sectors else "")
        params["area_id"] = area_id
    columns = ",".join(_band_columns(p, cond) + "," + _range_columns(p, cond) for p, cond in _VARIANTS.items())
    rows = session.execute(
        text(f"""
            SELECT c.id, c.name, c.slug, c.area_id, a.kind = 'sektor' AS in_sector, a.kind AS area_kind, c.needs_location,
                   CASE WHEN a.kind = 'sektor' THEN a.name END AS sector_name,
                   ST_X(c.location) AS lng, ST_Y(c.location) AS lat,
                   {columns}
            FROM crag c
            JOIN area a ON a.id = c.area_id
            LEFT JOIN route r ON r.crag_id = c.id
            LEFT JOIN route_kind rk ON rk.route_id = r.id
            {where}
            GROUP BY c.id, a.kind, a.name
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
            "sector_name": r["sector_name"],
            "lng": r["lng"],
            "lat": r["lat"],
            **_crag_stats(r, ""),
            "by_kind": {kind: _crag_stats(r, f"{kind}_") for kind in KINDS},
        }
        for r in rows
    ]


def area_stats(session: Session, ids: list[int] | None = None, kind: str | None = None) -> dict[int, dict[str, Any]]:
    """Crags, routes and routes per grade band in each area with everything below it (a region with its sectors);
    for sport and trad routes alone in ``by_kind`` (crags counted there when they have a route of that kind).

    The areas: ``ids``, or every area of ``kind``.
    """
    params: dict[str, Any] = {**_band_params(), "ids": ids or [], "kind": kind}
    crag_columns = {
        "": "count(DISTINCT c.id)::int AS crag_count",
        "sport_": "count(DISTINCT c.id) FILTER (WHERE rk.kind = 'sport')::int AS sport_crag_count",
        "trad_": "count(DISTINCT c.id) FILTER (WHERE rk.kind = 'trad')::int AS trad_crag_count",
    }
    columns = ",".join(crag_columns[p] + "," + _band_columns(p, cond) for p, cond in _VARIANTS.items())
    roots = "id = ANY(:ids)" if ids is not None else "kind = :kind"
    rows = session.execute(
        text(f"""
            WITH RECURSIVE tree(root_id, area_id) AS (
                SELECT id, id FROM area WHERE {roots}
                UNION ALL
                SELECT t.root_id, a.id FROM area a JOIN tree t ON a.parent_id = t.area_id
            )
            SELECT t.root_id, {columns}
            FROM tree t
            JOIN crag c ON c.area_id = t.area_id
            LEFT JOIN route r ON r.crag_id = c.id
            LEFT JOIN route_kind rk ON rk.route_id = r.id
            GROUP BY t.root_id
        """),
        params,
    ).mappings()

    def stats(r: Any, prefix: str) -> dict[str, Any]:
        return {"crag_count": r[f"{prefix}crag_count"], **_bands(r, prefix)}

    return {r["root_id"]: {**stats(r, ""), "by_kind": {k: stats(r, f"{k}_") for k in KINDS}} for r in rows}


EMPTY_AREA_STATS: dict[str, Any] = {
    "crag_count": 0,
    "route_count": 0,
    "grade_bands": [0, 0, 0, 0],
    "by_kind": {k: {"crag_count": 0, "route_count": 0, "grade_bands": [0, 0, 0, 0]} for k in KINDS},
}


def route_kinds(session: Session, route_ids: list[int]) -> dict[int, str]:
    """"sport" or "trad" for each route (view route_kind)."""
    rows = session.execute(text("SELECT route_id, kind FROM route_kind WHERE route_id = ANY(:ids)"), {"ids": route_ids})
    return {route_id: kind for route_id, kind in rows}
