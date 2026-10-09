from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class AreaRef(BaseModel):
    id: int
    name: str
    slug: str
    kind: str


class PointOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sort_order: int
    x: float
    y: float
    kind: str
    visible: bool


class LineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    route_id: int | None
    color: str
    sort_order: int
    parent_line_id: int | None
    parent_point_id: int | None
    points: list[PointOut]


class WallOut(BaseModel):
    id: int
    name: str | None
    description: str | None
    sort_order: int
    version: int
    image_url: str | None
    thumb_url: str | None
    image_width: int | None
    image_height: int | None
    depth_url: str | None
    depth_status: str
    depth_model: str | None
    segments_url: str | None
    show_3d: bool
    vegetation_ratio: float | None
    lines: list[LineOut]


class RouteOut(BaseModel):
    id: int
    number: int | None
    name: str
    grade: str | None
    grade_fr: str | None
    grade_sort: int | None
    length_m: float | None
    protection: str | None
    first_ascent: str | None
    year: int | None
    description: str | None


class CragOut(BaseModel):
    id: int
    name: str
    slug: str
    path: list[AreaRef]
    lng: float
    lat: float
    rock_type: str | None
    height_min: float | None
    height_max: float | None
    aspects: list[str]
    formations: list[str]
    approach_minutes: int | None
    child_friendly: bool | None
    surroundings: str | None
    description: str | None
    approach_description: str | None
    source: str
    source_url: str | None
    needs_location: bool
    walls: list[WallOut]
    routes: list[RouteOut]


class CragSummary(BaseModel):
    id: int
    name: str
    slug: str
    route_count: int
    grade_bands: list[int]
    grade_min: str | None
    grade_min_sort: int | None
    grade_max: str | None
    grade_max_sort: int | None


class AreaChild(BaseModel):
    id: int
    name: str
    slug: str
    kind: str
    crag_count: int
    route_count: int


class AreaOut(BaseModel):
    id: int
    name: str
    slug: str
    kind: str
    description: str | None
    path: list[AreaRef]
    children: list[AreaChild]
    crags: list[CragSummary]
    center: list[float] | None
    bbox: list[float] | None


class FieldDiffOut(BaseModel):
    field: str
    before: Any
    after: Any


class ObjectChangeOut(BaseModel):
    kind: Literal["area", "crag", "wall", "route", "topo"]
    id: int
    name: str | None
    op: Literal["created", "updated", "deleted"]
    diffs: list[FieldDiffOut]
    summary: str | None  # "topo" only, e.g. "zmieniono 3 linie, 7 punktów"


class CragRef(BaseModel):
    id: int
    name: str
    slug: str | None  # None once the crag is gone


class ChangeOut(BaseModel):
    id: int
    author: str | None
    comment: str | None
    issued_at: datetime
    is_import: bool
    reverts_id: int | None
    reverted_by: int | None
    crag: CragRef | None
    area_path: list[AreaRef]
    objects: list[ObjectChangeOut]


class ChangesPage(BaseModel):
    items: list[ChangeOut]
    next_before: int | None
