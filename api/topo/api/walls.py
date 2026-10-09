from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from topo.api.deps import current_editor, start_change
from topo.api.errors import raise_not_found
from topo.db import get_session
from topo.editing import apply_fields, delete_wall
from topo.models import Wall
from topo.schemas_edit import DeleteBody, WallLinesIn, WallPatch
from topo.topo_edit import VersionConflict, save_wall_lines

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


@router.put("/{wall_id:int}/lines")
def put_wall_lines(
    wall_id: int, body: WallLinesIn, nick: str = Depends(current_editor), session: Session = Depends(get_session)
) -> Any:
    # Locked until commit: two saves at the same moment are serialised, so the second one sees the new version (409).
    wall = session.get(Wall, wall_id, with_for_update=True) or raise_not_found("ściana")
    start_change(session, nick, body.comment)
    try:
        result = save_wall_lines(session, wall, body)
    except VersionConflict as exc:
        session.rollback()
        content = {"code": "version_conflict", "message": "Ktoś zapisał topo w międzyczasie", "current_version": exc.current}
        return JSONResponse(content, status_code=409)
    except Exception:
        session.rollback()
        raise
    if result is None:
        session.rollback()
        return {"version": wall.version, "ids": {}}
    return {"version": result.version, "ids": result.ids}
