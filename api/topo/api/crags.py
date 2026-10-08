from fastapi import APIRouter, Depends
from geoalchemy2.shape import to_shape
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from topo.api.common import area_path, media_url
from topo.api.errors import not_found
from topo.db import get_session
from topo.grades import to_french
from topo.models import Crag, Route, RouteLine, Wall
from topo.schemas import CragOut, LineOut, RouteOut, WallOut

router = APIRouter(tags=["crags"])


def _wall_out(wall: Wall) -> WallOut:
    return WallOut(
        id=wall.id,
        name=wall.name,
        sort_order=wall.sort_order,
        version=wall.version,
        image_url=media_url(wall.image_path),
        thumb_url=media_url(wall.thumb_path),
        image_width=wall.image_width,
        image_height=wall.image_height,
        depth_url=media_url(wall.depth_path) if wall.depth_status == "ready" else None,
        depth_status=wall.depth_status,
        depth_model=wall.depth_model,
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
        description=crag.description,
        approach_description=crag.approach_description,
        source=crag.source,
        source_url=crag.source_url,
        walls=[_wall_out(wall) for wall in crag.walls],
        routes=[_route_out(route) for route in crag.routes],
    )
