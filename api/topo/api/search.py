from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from topo.api.errors import ApiError, raise_not_found
from topo.db import get_session
from topo.grades import grade_sort
from topo.models import Area
from topo.search import RouteKind, SearchType, search

router = APIRouter(tags=["search"])


def _grade(raw: str | None) -> int | None:
    if raw is None or raw == "":
        return None
    sort = grade_sort(raw)
    if sort is None:
        raise ApiError(422, "invalid_grade", f"Nieznana wycena „{raw}”")
    return sort


@router.get("")
def get_search(
    q: Annotated[str, Query(max_length=100)] = "",
    type: SearchType = "all",
    grade_min: str | None = None,
    grade_max: str | None = None,
    area: str | None = None,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
    kind: RouteKind | None = None,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    area_id = None
    if area:
        area_id = session.scalar(select(Area.id).where(Area.slug == area)) or raise_not_found("obszar")
    return search(session, q, type, _grade(grade_min), _grade(grade_max), area_id, offset, kind)
