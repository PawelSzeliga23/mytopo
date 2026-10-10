from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response
from geoalchemy2.shape import to_shape
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from topo.api.common import area_path, media_url
from topo.api.deps import current_editor, start_change
from topo.api.errors import ApiError, not_found, raise_not_found
from topo.db import get_session, refresh_area_geom
from topo.depth import SEGMENTS_FILE, photo_folder, wants_3d
from topo.editing import apply_fields, apply_grade, area_kind_ok, delete_crag, location_from, location_of
from topo.grades import to_french
from topo.models import Area, Crag, Route, RouteLine, Wall
from topo.schemas import CragOut, LineOut, RouteOut, WallOut
from topo.schemas_edit import CragCreate, CragPatch, DeleteBody, RouteCreate
from topo.sectors import ToSectorPreview, crag_to_sector, to_sector_preview
from topo.slugs import unique_slug

router = APIRouter(tags=["crags"])


def _wall_out(wall: Wall) -> WallOut:
    return WallOut(
        id=wall.id,
        name=wall.name,
        description=wall.description,
        sort_order=wall.sort_order,
        version=wall.version,
        image_url=media_url(wall.image_path),
        thumb_url=media_url(wall.thumb_path),
        image_width=wall.image_width,
        image_height=wall.image_height,
        depth_url=media_url(wall.depth_path) if wall.depth_status == "ready" else None,
        depth_status=wall.depth_status,
        depth_model=wall.depth_model,
        segments_url=(
            media_url((photo_folder(wall) / SEGMENTS_FILE).as_posix())
            if wall.depth_status == "ready" and wall.vegetation_ratio is not None
            else None
        ),
        show_3d=wants_3d(wall),
        vegetation_ratio=wall.vegetation_ratio,
        lines=[LineOut.model_validate(line) for line in wall.lines],
    )


def _route_out(route: Route) -> RouteOut:
    return RouteOut(
        id=route.id,
        number=route.number,
        name=route.name,
        grade=route.grade,
        grade_fr=to_french(route.grade),
        grade_sort=route.grade_sort,
        length_m=route.length_m,
        protection=route.protection,
        first_ascent=route.first_ascent,
        year=route.year,
        description=route.description,
    )


@router.get("/{slug}", response_model=CragOut)
def get_crag(slug: str, session: Session = Depends(get_session)) -> CragOut:
    crag = session.scalar(
        select(Crag)
        .where(Crag.slug == slug)
        .options(
            selectinload(Crag.walls).selectinload(Wall.lines).selectinload(RouteLine.points),
            selectinload(Crag.routes),
        )
    )
    if crag is None:
        raise not_found("skała")
    point = to_shape(crag.location)
    return CragOut(
        id=crag.id,
        name=crag.name,
        slug=crag.slug,
        path=area_path(crag.area),
        lng=point.x,
        lat=point.y,
        rock_type=crag.rock_type,
        height_min=crag.height_min,
        height_max=crag.height_max,
        aspects=crag.aspects,
        formations=crag.formations,
        approach_minutes=crag.approach_minutes,
        child_friendly=crag.child_friendly,
        surroundings=crag.surroundings,
        description=crag.description,
        approach_description=crag.approach_description,
        source=crag.source,
        source_url=crag.source_url,
        needs_location=crag.needs_location,
        walls=[_wall_out(wall) for wall in crag.walls],
        routes=[_route_out(route) for route in crag.routes],
    )


def _check_area(session: Session, area_id: int) -> None:
    area = session.get(Area, area_id)
    if area is None or not area_kind_ok(area):
        raise ApiError(422, "invalid_area", "Skała może należeć tylko do regionu albo sektora")


@router.post("", status_code=201)
def create_crag(
    body: CragCreate, nick: str = Depends(current_editor), session: Session = Depends(get_session)
) -> dict[str, Any]:
    location = location_from(body.location)
    _check_area(session, body.area_id)
    start_change(session, nick, body.comment)
    crag = Crag(
        name=body.name, area_id=body.area_id, slug=unique_slug(session, Crag, body.name), location=location,
        source="manual",
    )
    session.add(crag)
    session.flush()
    refresh_area_geom(session)
    session.commit()
    return {"id": crag.id, "slug": crag.slug}


@router.patch("/{crag_id:int}")
def patch_crag(
    crag_id: int, body: CragPatch, nick: str = Depends(current_editor), session: Session = Depends(get_session)
) -> dict[str, Any]:
    crag = session.get(Crag, crag_id) or raise_not_found("skała")
    data = body.model_dump(exclude_unset=True)
    start_change(session, nick, data.pop("comment", None))
    if "area_id" in data and data["area_id"] != crag.area_id:
        _check_area(session, data["area_id"])
    else:
        data.pop("area_id", None)
    changed: set[str] = set()
    if "location" in data:
        new = data.pop("location")
        point = location_from(new)
        if location_of(crag) != [round(v, 7) for v in new]:
            crag.location = point
            changed.add("location")
        if crag.needs_location:  # an explicit location, even an unchanged one, confirms the position
            crag.needs_location = False
            changed.add("location")
    changed |= apply_fields(crag, data)
    if not changed:
        session.rollback()
        return {"id": crag_id, "slug": crag.slug, "changed": []}
    if changed & {"location", "area_id"}:
        session.flush()
        refresh_area_geom(session)
    session.commit()
    return {"id": crag.id, "slug": crag.slug, "changed": sorted(changed)}


@router.delete("/{crag_id:int}", status_code=204)
def remove_crag(
    crag_id: int,
    comment: Annotated[str | None, Query(max_length=500)] = None,
    nick: str = Depends(current_editor),
    session: Session = Depends(get_session),
) -> Response:
    crag = session.get(Crag, crag_id) or raise_not_found("skała")
    start_change(session, nick, DeleteBody(comment=comment).comment)
    delete_crag(session, crag)
    session.flush()
    refresh_area_geom(session)
    session.commit()
    return Response(status_code=204)


@router.post("/{crag_id:int}/routes", status_code=201)
def create_route(
    crag_id: int, body: RouteCreate, nick: str = Depends(current_editor), session: Session = Depends(get_session)
) -> dict[str, Any]:
    crag = session.get(Crag, crag_id) or raise_not_found("skała")
    data = body.model_dump(exclude={"comment", "grade"})
    route = Route(crag=crag, source="manual", **data)
    apply_grade(route, body.grade)
    start_change(session, nick, body.comment)
    session.add(route)
    session.flush()
    refresh_area_geom(session)
    session.commit()
    return {"id": route.id}


@router.get("/{crag_id:int}/to-sector/preview")
def preview_to_sector(
    crag_id: int, _nick: str = Depends(current_editor), session: Session = Depends(get_session)
) -> ToSectorPreview:
    crag = session.get(Crag, crag_id) or raise_not_found("skała")
    return to_sector_preview(crag)


@router.post("/{crag_id:int}/to-sector")
def convert_to_sector(
    crag_id: int, body: DeleteBody, nick: str = Depends(current_editor), session: Session = Depends(get_session)
) -> dict[str, Any]:
    crag = session.get(Crag, crag_id) or raise_not_found("skała")
    start_change(session, nick, body.comment)
    sector, new_crags = crag_to_sector(session, crag)
    refresh_area_geom(session)
    session.commit()
    return {
        "sector": {"id": sector.id, "slug": sector.slug, "kind": sector.kind},
        "crags": [{"id": c.id, "slug": c.slug, "name": c.name, "needs_location": c.needs_location} for c in new_crags],
    }
