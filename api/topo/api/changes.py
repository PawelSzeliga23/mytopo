from dataclasses import asdict
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from topo.api.deps import current_editor
from topo.api.errors import ApiError, raise_not_found
from topo.changes import list_changes, shown_area
from topo.config import get_settings
from topo.db import get_session
from topo.history import IMPORT_AUTHOR_PREFIX, transaction_class
from topo.revert import MissingParent, RevertConflict, revert_transaction
from topo.schemas import ChangesPage
from topo.schemas_edit import RevertBody

router = APIRouter(tags=["changes"])


@router.get("", response_model=ChangesPage)
def get_changes(
    crag: int | None = None,
    kind: Literal["all", "deleted"] = "all",
    include_import: bool = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    before: int | None = None,
    session: Session = Depends(get_session),
) -> ChangesPage:
    items = list_changes(session, crag_id=crag, kind=kind, include_import=include_import, limit=limit + 1, before=before)
    more = len(items) > limit
    items = items[:limit]
    return ChangesPage(items=items, next_before=items[-1].id if more else None)


@router.post("/{tx_id:int}/revert", response_model=None)
def revert_change(
    tx_id: int,
    body: RevertBody | None = None,
    nick: str = Depends(current_editor),
    session: Session = Depends(get_session),
) -> dict[str, Any] | JSONResponse:
    body = body or RevertBody()
    tx = session.get(transaction_class(), tx_id) or raise_not_found("zmiana")
    if tx.author and tx.author.startswith(IMPORT_AUTHOR_PREFIX):
        raise ApiError(403, "import_revert", "Danych z importu nie cofa się — popraw je ręcznie")
    try:
        new_id = revert_transaction(
            session, tx_id, nick, body.comment, body.mode or "check", Path(get_settings().media_root)
        )
    except RevertConflict as exc:
        conflicts = [
            asdict(conflict) | {
                "current": shown_area(session, conflict.field, conflict.current),
                "restored": shown_area(session, conflict.field, conflict.restored),
            }
            for conflict in exc.conflicts
        ]  # fmt: skip
        content = {"code": "revert_conflict", "message": "Część pól zmieniono później", "conflicts": conflicts}
        return JSONResponse(jsonable_encoder(content), status_code=409)
    except MissingParent as exc:
        content = {"code": "missing_parent", "message": exc.message, "transaction_id": exc.transaction_id}
        return JSONResponse(content, status_code=409)
    return {"transaction_id": new_id}
