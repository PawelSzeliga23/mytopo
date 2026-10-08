"""Plain data parsed from Portal Górski; no database or network here."""

from dataclasses import dataclass


@dataclass(frozen=True)
class TrailItem:
    kind: str
    source_id: int
    name: str
    url: str


@dataclass(frozen=True)
class RockRef:
    source_id: int
    name: str
    url: str
    lat: float
    lng: float


@dataclass(frozen=True)
class StartList:
    rocks: list[RockRef]
    invalid_urls: list[str]


@dataclass(frozen=True)
class WallRef:
    source_id: int
    name: str | None
    description: str | None
    image_url: str | None


@dataclass(frozen=True)
class RockPage:
    source_id: int
    name: str
    url: str
    path: list[TrailItem]
    lat: float | None
    lng: float | None
    rock_type: str | None
    height_min: float | None
    height_max: float | None
    aspects: list[str]
    formations: list[str]
    approach_minutes: int | None
    child_friendly: bool | None
    surroundings: str | None
    description: str | None
    walls: list[WallRef]


@dataclass(frozen=True)
class PointData:
    source_id: int
    x: float
    y: float
    kind: str
    visible: bool
    raw_kind: str


@dataclass(frozen=True)
class LineData:
    source_id: int
    order: int
    branch_order: int
    color: str
    parent_source_id: int | None
    parent_point_source_id: int | None
    points: list[PointData]


@dataclass(frozen=True)
class RouteData:
    source_id: int
    name: str
    protection: str | None
    grade: str | None
    first_ascent: str | None
    year: int | None
    length_m: float | None


@dataclass(frozen=True)
class WallTopo:
    lines: list[LineData]
    routes: list[RouteData]
