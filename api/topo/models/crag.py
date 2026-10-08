from typing import TYPE_CHECKING

from geoalchemy2 import Geometry, WKBElement
from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from topo.models.base import Base, SourceMixin, source_constraint

if TYPE_CHECKING:
    from topo.models.area import Area
    from topo.models.route import Route
    from topo.models.wall import Wall


class Crag(SourceMixin, Base):
    __tablename__ = "crag"
    __table_args__ = (
        source_constraint("crag"),
        Index("ix_crag_location", "location", postgresql_using="gist"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("area.id", ondelete="RESTRICT"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(220), unique=True)
    location: Mapped[WKBElement] = mapped_column(Geometry("POINT", srid=4326, spatial_index=False))
    rock_type: Mapped[str | None] = mapped_column(String(64))
    height_min: Mapped[float | None]
    height_max: Mapped[float | None]
    aspects: Mapped[list[str]] = mapped_column(ARRAY(String(3)), default=list, server_default="{}")
    formations: Mapped[list[str]] = mapped_column(ARRAY(String(32)), default=list, server_default="{}")
    approach_minutes: Mapped[int | None]
    description: Mapped[str | None] = mapped_column(Text)
    approach_description: Mapped[str | None] = mapped_column(Text)

    area: Mapped["Area"] = relationship(back_populates="crags")
    walls: Mapped[list["Wall"]] = relationship(
        back_populates="crag", order_by="(Wall.sort_order, Wall.id)", cascade="all, delete-orphan"
    )
    routes: Mapped[list["Route"]] = relationship(
        back_populates="crag", order_by="(Route.number.nulls_last(), Route.id)", cascade="all, delete-orphan"
    )
