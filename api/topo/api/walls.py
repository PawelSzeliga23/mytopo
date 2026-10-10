from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Form, Query, Response, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from topo.api.deps import current_editor, start_change
from topo.api.errors import ApiError, raise_not_found
from topo.config import get_settings
from topo.db import get_session
from topo.depth import model_number, update_wall_fields
from topo.depth_queue import enqueue_depth
from topo.editing import apply_fields, delete_wall
from topo.model_edit import MAX_MODEL_UPLOAD, InvalidModel, check_model, original_size, store_model
from topo.models import Wall
from topo.photos import read_upload, set_photo
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


@router.put("/{wall_id:int}/image")
def replace_image(
    wall_id: int,
    file: UploadFile,
    comment: Annotated[str | None, Form(max_length=500)] = None,
    nick: str = Depends(current_editor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    data = read_upload(file)
    # Locked until commit: two uploads at the same moment must not pick the same folder number.
    wall = session.get(Wall, wall_id, with_for_update=True) or raise_not_found("ściana")
    start_change(session, nick, comment)
    set_photo(session, wall, data, Path(get_settings().media_root))
    session.commit()
    return {"id": wall.id, "version": wall.version}


@router.post("/{wall_id:int}/depth", status_code=202)
def retry_depth(
    wall_id: int, _nick: str = Depends(current_editor), session: Session = Depends(get_session)
) -> dict[str, bool]:
    wall = session.get(Wall, wall_id) or raise_not_found("ściana")
    if wall.image_path is None:
        raise ApiError(422, "no_image", "Ściana nie ma zdjęcia")
    update_wall_fields(session, wall.id, depth_status="pending")  # derived data: no history entry
    enqueue_depth(session, wall.id)
    session.commit()
    return {"queued": True}


Color = Annotated[str | None, Form(pattern=r"^(#[0-9a-fA-F]{6}|default)$")]  # "default": back to the default colour
SWITCH = {"auto": None, "on": True, "off": False}


@router.put("/{wall_id:int}/model", response_model=None)
def save_model(
    wall_id: int,
    base_model: Annotated[str, Form(pattern=r"^\d*$")] = "",
    depth: UploadFile | None = None,
    segments: UploadFile | None = None,
    rock_color: Color = None,
    ground_color: Color = None,
    depth_enabled: Annotated[Literal["auto", "on", "off"] | None, Form()] = None,
    comment: Annotated[str | None, Form(max_length=500)] = None,
    nick: str = Depends(current_editor),
    session: Session = Depends(get_session),
) -> Any:
    """The 2.5D model edited by hand (both rasters, or none) and the wall's hologram colours and 2.5D switch."""
    # Locked until commit: two saves at the same moment get model numbers in turn and the second one a conflict.
    wall = session.get(Wall, wall_id, with_for_update=True) or raise_not_found("ściana")
    if wall.depth_status != "ready" or wall.depth_path is None:
        raise ApiError(422, "no_depth", "Ta ściana nie ma jeszcze modelu 2.5D")
    current = model_number(wall.model_path)
    if (int(base_model) if base_model else None) != current:
        session.rollback()
        content = {"code": "model_conflict", "message": "Ktoś zapisał model w międzyczasie", "current_model": current}
        return JSONResponse(content, status_code=409)
    media_root = Path(get_settings().media_root)
    rasters = None
    if depth is not None or segments is not None:
        if depth is None or segments is None:
            raise ApiError(422, "invalid_model", "Wyślij głębię i segmentację razem")
        rasters = depth.file.read(MAX_MODEL_UPLOAD + 1), segments.file.read(MAX_MODEL_UPLOAD + 1)
        try:
            if max(len(data) for data in rasters) > MAX_MODEL_UPLOAD:
                raise InvalidModel("Pliki modelu są za duże")
            check_model(*rasters, original_size(media_root, wall))
        except InvalidModel as exc:
            raise ApiError(422, "invalid_model", str(exc)) from exc
    start_change(session, nick, comment)
    data: dict[str, Any] = {}
    for name, value in (("rock_color", rock_color), ("ground_color", ground_color)):
        if value is not None:
            data[name] = None if value == "default" else value.lower()
    if depth_enabled is not None:
        data["depth_enabled"] = SWITCH[depth_enabled]
    changed = apply_fields(wall, data)
    if rasters is not None:
        wall.model_path = store_model(media_root, wall, *rasters)
        changed.add("model_path")
    if not changed:
        session.rollback()
        return {"model_version": current, "changed": []}
    session.commit()
    return {"model_version": model_number(wall.model_path), "changed": sorted(changed)}
