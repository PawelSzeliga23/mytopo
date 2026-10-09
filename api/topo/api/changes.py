from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from topo.api.deps import current_editor
from topo.changes import list_changes
from topo.db import get_session
from topo.schemas import ChangesPage

router = APIRouter(tags=["changes"])


@router.get("", response_model=ChangesPage)
def get_changes(
    crag: int | None = None,
    kind: Literal["all", "deleted"] = "all",
    include_import: bool = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    before: int | None = None,
    _nick: str = Depends(current_editor),
    session: Session = Depends(get_session),
) -> ChangesPage:
    items = list_changes(session, crag_id=crag, kind=kind, include_import=include_import, limit=limit + 1, before=before)
    more = len(items) > limit
    items = items[:limit]
    return ChangesPage(items=items, next_before=items[-1].id if more else None)
