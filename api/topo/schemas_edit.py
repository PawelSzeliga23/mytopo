from typing import Annotated, Any, ClassVar, Literal

from pydantic import BaseModel, Field, ValidationInfo, field_validator, model_validator

Name = Annotated[str, Field(min_length=1, max_length=200)]
RouteName = Annotated[str, Field(min_length=1, max_length=300)]
LngLat = tuple[float, float]


class EditBase(BaseModel):
    """Trims strings; an empty optional text means "clear the value"."""

    comment: Annotated[str | None, Field(max_length=500)] = None

    @field_validator("*", mode="before")
    @classmethod
    def _trim(cls, value: Any, info: ValidationInfo) -> Any:
        if isinstance(value, str):
            value = value.strip()
            if not value and info.field_name != "name":
                return None
        return value


class PatchBase(EditBase):
    # Mandatory columns cannot be cleared with an explicit null.
    _not_null: ClassVar[tuple[str, ...]] = ()

    @model_validator(mode="after")
    def _check_not_null(self) -> "PatchBase":
        for name in self._not_null:
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} nie może być puste")
        return self


class CragFields(BaseModel):
    rock_type: Annotated[str | None, Field(max_length=64)] = None
    height_min: Annotated[float | None, Field(ge=0, le=2000)] = None
    height_max: Annotated[float | None, Field(ge=0, le=2000)] = None
    aspects: list[Annotated[str, Field(min_length=1, max_length=3)]] | None = None
    formations: list[Annotated[str, Field(min_length=1, max_length=32)]] | None = None
    approach_minutes: Annotated[int | None, Field(ge=0, le=600)] = None
    child_friendly: bool | None = None
    surroundings: Annotated[str | None, Field(max_length=100)] = None
    description: str | None = None
    approach_description: str | None = None


class CragCreate(EditBase):
    name: Name
    area_id: int
    location: LngLat


class CragPatch(CragFields, PatchBase):
    _not_null: ClassVar[tuple[str, ...]] = ("name", "area_id", "location", "aspects", "formations")

    name: Name | None = None
    area_id: int | None = None
    location: LngLat | None = None


class RouteFields(BaseModel):
    grade: Annotated[str | None, Field(max_length=32)] = None
    length_m: Annotated[float | None, Field(ge=1, le=500)] = None
    protection: Annotated[str | None, Field(max_length=100)] = None
    first_ascent: Annotated[str | None, Field(max_length=300)] = None
    year: Annotated[int | None, Field(ge=1900, le=2100)] = None
    description: str | None = None


class RouteCreate(RouteFields, EditBase):
    name: RouteName


class RoutePatch(RouteFields, PatchBase):
    _not_null: ClassVar[tuple[str, ...]] = ("name",)

    name: RouteName | None = None
    number: Annotated[int | None, Field(ge=0, le=10000)] = None


class WallPatch(PatchBase):
    _not_null: ClassVar[tuple[str, ...]] = ("sort_order",)

    name: Name | None = None
    description: str | None = None
    sort_order: int | None = None


class DeleteBody(EditBase):
    """DELETE carries the comment in the `?comment=` query parameter."""


class AreaCreate(EditBase):
    kind: Literal["region", "sektor"]
    parent_id: int
    name: Name
    description: str | None = None
    crag_ids: list[int] | None = None


class AreaPatch(PatchBase):
    _not_null: ClassVar[tuple[str, ...]] = ("name", "parent_id")

    name: Name | None = None
    description: str | None = None
    parent_id: int | None = None


class RevertBody(EditBase):
    mode: Literal["safe", "all"] | None = None  # None: revert only when nothing conflicts
