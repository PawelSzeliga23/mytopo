"""Search by name for areas, crags, walls (not those named like their crag) and routes; case and Polish letters do not matter."""

from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.orm import Session

SearchType = Literal["all", "routes", "crags"]
LIMITS = {"areas": 5, "crags": 8, "walls": 5, "routes": 20}
MIN_QUERY = 2

# The areas a filter covers: the area and everything below it.
_SUBTREE = """
    WITH RECURSIVE sub AS (
        SELECT id FROM area WHERE id = :area
        UNION ALL
        SELECT a.id FROM area a JOIN sub ON a.parent_id = sub.id
    )
"""


def _like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _match(column: str) -> str:
    # search_key (migration 0009) = unaccent(lower(...)), with a trigram index on every searched name.
    return f"search_key({column}) LIKE search_key(:contains) ESCAPE '\\'"


def _order(column: str) -> str:
    """Names starting with the phrase first, then the rest; alphabetically within both."""
    return f"(search_key({column}) LIKE search_key(:prefix) ESCAPE '\\') DESC, {column}"


def _rows(session: Session, sql: str, params: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
    rows = [dict(row) for row in session.execute(text(sql), params).mappings()]
    total = rows[0].pop("total") if rows else 0
    for row in rows[1:]:
        row.pop("total")
    return rows, total


def search(
    session: Session,
    q: str,
    type_: SearchType = "all",
    grade_min: int | None = None,
    grade_max: int | None = None,
    area_id: int | None = None,
    offset: int = 0,
) -> dict[str, Any]:
    phrase = q.strip()
    has_text = len(phrase) >= MIN_QUERY
    has_filter = grade_min is not None or grade_max is not None or area_id is not None
    result: dict[str, Any] = {"areas": [], "crags": [], "walls": [], "routes": [], "totals": dict.fromkeys(LIMITS, 0)}
    if not has_text and not has_filter:
        return result
    params: dict[str, Any] = {
        "contains": f"%{_like(phrase)}%", "prefix": f"{_like(phrase)}%", "area": area_id,
        "gmin": grade_min, "gmax": grade_max, "offset": offset,
    }  # fmt: skip
    with_area = _SUBTREE if area_id is not None else ""
    in_area = "AND {column} IN (SELECT id FROM sub)" if area_id is not None else ""
    name_match = _match("{name}") if has_text else "TRUE"

    def query(key: str, sql: str, name: str, area_column: str) -> None:
        where = name_match.format(name=name) + " " + in_area.format(column=area_column)
        rows, total = _rows(
            session,
            f"{with_area} {sql.format(where=where, order=_order(name))} LIMIT {LIMITS[key]}"
            + (" OFFSET :offset" if key == "routes" else ""),
            params,
        )
        result[key], result["totals"][key] = rows, total

    # Without text only routes make sense ("all routes VI–VI.2 in this valley").
    if has_text and type_ == "all":
        query(
            "areas",
            """SELECT x.id, x.name, x.slug, x.kind, p.name AS parent_name, count(*) OVER () AS total
               FROM area x LEFT JOIN area p ON p.id = x.parent_id
               WHERE {where} ORDER BY {order}""",
            "x.name", "x.id",
        )
    if has_text and type_ in ("all", "crags"):
        query(
            "crags",
            """SELECT x.id, x.name, x.slug, a.name AS area_name,
                      (SELECT count(*) FROM route r WHERE r.crag_id = x.id)::int AS route_count,
                      count(*) OVER () AS total
               FROM crag x JOIN area a ON a.id = x.area_id
               WHERE {where} ORDER BY {order}""",
            "x.name", "x.area_id",
        )
    if has_text and type_ == "all":
        query(
            "walls",
            """SELECT x.id, x.name, c.name AS crag_name, c.slug AS crag_slug, count(*) OVER () AS total
               FROM wall x JOIN crag c ON c.id = x.crag_id
               WHERE x.name IS NOT NULL AND search_key(x.name) <> search_key(c.name) AND {where}
               ORDER BY {order}""",
            "x.name", "c.area_id",
        )
    if type_ in ("all", "routes"):
        grade = ""
        if grade_min is not None:
            grade += " AND x.grade_sort >= :gmin"
        if grade_max is not None:
            grade += " AND x.grade_sort <= :gmax"
        query(
            "routes",
            """SELECT x.id, x.name, x.grade, x.grade_sort, x.length_m, c.name AS crag_name, c.slug AS crag_slug,
                      count(*) OVER () AS total
               FROM route x JOIN crag c ON c.id = x.crag_id
               WHERE {where}""" + grade + """ ORDER BY {order}, x.id""",
            "x.name", "c.area_id",
        )
    return result
