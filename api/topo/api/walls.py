from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from topo.api.deps import current_editor, start_change
from topo.api.errors import raise_not_found
from topo.db import get_session
from topo.editing import apply_fields, delete_wall
from topo.models import Wall
from topo.schemas_edit import DeleteBody, WallPatch

router = APIRouter(tags=["walls"])


@router.patch("/{wall_id:int}")
def patch_wall(
    wall_id: int, body: WallPatch, nick: str = Depends(current_editor), session: Session = Depends(get_session)
) -> dict[str, Any]:
    wall = session.get(Wall, wall_id) or raise_not_found("ściana")
    data = body.model_dump(exclude_unset=True)
    start_change(session, nick, data.pop("comment", None))
    changed = apply_fields(wall, data)
    if not changed:
        session.rollback()
        return {"id": wall_id, "changed": []}
    session.commit()
    return {"id": wall_id, "changed": sorted(changed)}


@router.delete("/{wall_id:int}", status_code=204)
def remove_wall(
    wall_id: int,
    comment: Annotated[str | None, Query(max_length=500)] = None,
    nick: str = Depends(current_editor),
    session: Session = Depends(get_session),
) -> Response:
    wall = session.get(Wall, wall_id) or raise_not_found("ściana")
    start_change(session, nick, DeleteBody(comment=comment).comment)
    delete_wall(session, wall)
    session.commit()
    return Response(status_code=204)
