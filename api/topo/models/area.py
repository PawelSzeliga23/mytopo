from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from topo.models.base import Base, SourceMixin, source_constraint

if TYPE_CHECKING:
    from topo.models.crag import Crag


class Area(SourceMixin, Base):
    __tablename__ = "area"
    __table_args__ = (
        source_constraint("area"),
        CheckConstraint("kind IN ('obszar', 'region', 'sektor')", name="ck_area_kind"),
        CheckConstraint("parent_id IS NULL OR parent_id <> id", name="ck_area_not_own_parent"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("area.id", ondelete="RESTRICT"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(220), unique=True)
    description: Mapped[str | None] = mapped_column(Text)

    parent: Mapped["Area | None"] = relationship(remote_side="Area.id", back_populates="children")
    children: Mapped[list["Area"]] = relationship(back_populates="parent", order_by="(Area.name, Area.id)")
    crags: Mapped[list["Crag"]] = relationship(back_populates="area", order_by="(Crag.name, Crag.id)")
