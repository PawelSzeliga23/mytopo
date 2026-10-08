from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, ForeignKeyConstraint, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from topo.models.base import Base, SourceMixin, source_constraint

if TYPE_CHECKING:
    from topo.models.crag import Crag
    from topo.models.wall import Wall


class Route(SourceMixin, Base):
    __versioned__ = {}

    __tablename__ = "route"
    __table_args__ = (source_constraint("route"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    crag_id: Mapped[int] = mapped_column(ForeignKey("crag.id", ondelete="CASCADE"), index=True)
    number: Mapped[int | None]
    name: Mapped[str] = mapped_column(String(300))
    grade: Mapped[str | None] = mapped_column(String(32))
    grade_sort: Mapped[int | None] = mapped_column(index=True)
    length_m: Mapped[float | None]
    protection: Mapped[str | None] = mapped_column(String(100))
    first_ascent: Mapped[str | None] = mapped_column(String(300))
    year: Mapped[int | None]
    description: Mapped[str | None] = mapped_column(Text)

    crag: Mapped["Crag"] = relationship(back_populates="routes")


class RouteLine(SourceMixin, Base):
    __versioned__ = {}

    __tablename__ = "route_line"
    __table_args__ = (
        source_constraint("route_line"),
        CheckConstraint("(parent_line_id IS NULL) = (parent_point_id IS NULL)", name="ck_route_line_parent_pair"),
        # A variant's branch point must belong to its parent line (references uq_line_point_line_id_id).
        ForeignKeyConstraint(
            ["parent_line_id", "parent_point_id"],
            ["line_point.line_id", "line_point.id"],
            name="fk_route_line_parent_point_id",
            ondelete="SET NULL",
            use_alter=True,
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    wall_id: Mapped[int] = mapped_column(ForeignKey("wall.id", ondelete="CASCADE"), index=True)
    route_id: Mapped[int | None] = mapped_column(ForeignKey("route.id", ondelete="SET NULL"), index=True)
    color: Mapped[str] = mapped_column(String(16), default="#e11d48", server_default="#e11d48")
    sort_order: Mapped[int] = mapped_column(default=0, server_default="0")
    # Deferred NO ACTION, not SET NULL: nulling parent_line_id alone would violate ck_route_line_parent_pair;
    # the composite fk_route_line_parent_point_id nulls both columns when the parent's points cascade away.
    parent_line_id: Mapped[int | None] = mapped_column(
        ForeignKey("route_line.id", deferrable=True, initially="DEFERRED"), index=True
    )
    parent_point_id: Mapped[int | None] = mapped_column(index=True)

    wall: Mapped["Wall"] = relationship(back_populates="lines")
    route: Mapped["Route | None"] = relationship()
    points: Mapped[list["LinePoint"]] = relationship(
        back_populates="line",
        foreign_keys="LinePoint.line_id",
        order_by="(LinePoint.sort_order, LinePoint.id)",
        cascade="all, delete-orphan",
    )
    # Each relationship writes exactly one column; the composite FK + CHECK keep the pair consistent.
    parent_line: Mapped["RouteLine | None"] = relationship(
        remote_side=[id],
        foreign_keys=[parent_line_id],
        primaryjoin="RouteLine.parent_line_id == RouteLine.id",
        post_update=True,
    )
    parent_point: Mapped["LinePoint | None"] = relationship(
        foreign_keys=[parent_point_id],
        primaryjoin="RouteLine.parent_point_id == LinePoint.id",
        post_update=True,
    )


class LinePoint(SourceMixin, Base):
    __versioned__ = {}

    __tablename__ = "line_point"
    __table_args__ = (
        source_constraint("line_point"),
        CheckConstraint(
            "kind IN ('start', 'ring', 'hak', 'ucho', 'stanowisko', 'przelot')", name="ck_line_point_kind"
        ),
        CheckConstraint("x >= 0 AND x <= 1 AND y >= 0 AND y <= 1", name="ck_line_point_xy"),
        UniqueConstraint("line_id", "id", name="uq_line_point_line_id_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    line_id: Mapped[int] = mapped_column(ForeignKey("route_line.id", ondelete="CASCADE"), index=True)
    sort_order: Mapped[int]
    x: Mapped[float]
    y: Mapped[float]
    kind: Mapped[str] = mapped_column(String(16))
    visible: Mapped[bool] = mapped_column(default=True, server_default="true")

    line: Mapped["RouteLine"] = relationship(back_populates="points", foreign_keys=[line_id])
