from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from topo.models.base import Base, SourceMixin, source_constraint

if TYPE_CHECKING:
    from topo.models.crag import Crag
    from topo.models.route import RouteLine


class Wall(SourceMixin, Base):
    __versioned__ = {}

    __tablename__ = "wall"
    __table_args__ = (
        source_constraint("wall"),
        CheckConstraint("depth_status IN ('pending', 'ready', 'failed')", name="ck_wall_depth_status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    crag_id: Mapped[int] = mapped_column(ForeignKey("crag.id", ondelete="CASCADE"), index=True)
    name: Mapped[str | None] = mapped_column(String(200))
    sort_order: Mapped[int] = mapped_column(default=0, server_default="0")
    version: Mapped[int] = mapped_column(default=1, server_default="1")
    image_original_path: Mapped[str | None] = mapped_column(String(500))
    image_path: Mapped[str | None] = mapped_column(String(500))
    thumb_path: Mapped[str | None] = mapped_column(String(500))
    image_width: Mapped[int | None]
    image_height: Mapped[int | None]
    depth_path: Mapped[str | None] = mapped_column(String(500))
    depth_status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")
    depth_model: Mapped[str | None] = mapped_column(String(64))

    crag: Mapped["Crag"] = relationship(back_populates="walls")
    lines: Mapped[list["RouteLine"]] = relationship(
        back_populates="wall", order_by="(RouteLine.sort_order, RouteLine.id)", cascade="all, delete-orphan"
    )
