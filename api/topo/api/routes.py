from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from topo.api.deps import current_editor, start_change
from topo.api.errors import raise_not_found
from topo.db import get_session, refresh_area_geom
from topo.editing import apply_fields, apply_grade, delete_route
from topo.models import Route
from topo.schemas_edit import DeleteBody, RoutePatch

router = APIRouter(tags=["routes"])


@router.patch("/{route_id:int}")
def patch_route(
    route_id: int, body: RoutePatch, nick: str = Depends(current_editor), session: Session = Depends(get_session)
) -> dict[str, Any]:
    route = session.get(Route, route_id) or raise_not_found("droga")
    data = body.model_dump(exclude_unset=True)
    start_change(session, nick, data.pop("comment", None))
    changed: set[str] = set()
    if "grade" in data:
        old = route.grade
        apply_grade(route, data.pop("grade"))
        if route.grade != old:
            changed.add("grade")
    changed |= apply_fields(route, data)
    if not changed:
        session.rollback()
        return {"id": route_id, "changed": []}
    session.commit()
    return {"id": route_id, "changed": sorted(changed)}


@router.delete("/{route_id:int}", status_code=204)
def remove_route(
    route_id: int,
    comment: Annotated[str | None, Query(max_length=500)] = None,
    nick: str = Depends(current_editor),
    session: Session = Depends(get_session),
) -> Response:
    route = session.get(Route, route_id) or raise_not_found("droga")
    start_change(session, nick, DeleteBody(comment=comment).comment)
    delete_route(session, route)
    session.flush()
    refresh_area_geom(session)
    session.commit()
    return Response(status_code=204)
