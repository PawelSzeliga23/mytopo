"""initial schema: areas, crags, walls, routes, lines, points, depth jobs, area_geom view

Revision ID: 0001
Revises:
Create Date: 2026-10-08
"""
import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

AREA_GEOM_SQL = """
CREATE MATERIALIZED VIEW area_geom AS
WITH RECURSIVE tree(root_id, area_id) AS (
    SELECT id, id FROM area
    UNION ALL
    SELECT t.root_id, a.id FROM area a JOIN tree t ON a.parent_id = t.area_id
),
crag_routes AS (
    SELECT c.id, c.area_id, c.location, count(r.id) AS route_count
    FROM crag c
    LEFT JOIN route r ON r.crag_id = c.id
    GROUP BY c.id
)
SELECT t.root_id AS area_id,
       count(cr.id)::int AS crag_count,
       coalesce(sum(cr.route_count), 0)::int AS route_count,
       ST_Centroid(ST_Collect(cr.location)) AS center,
       ST_Buffer(ST_ConvexHull(ST_Collect(cr.location))::geography, 50)::geometry AS hull
FROM tree t
JOIN crag_routes cr ON cr.area_id = t.area_id
GROUP BY t.root_id
"""


def _source_columns() -> list[sa.Column]:
    return [
        sa.Column("source", sa.String(32), nullable=False, server_default="manual"),
        sa.Column("source_id", sa.String(64)),
        sa.Column("source_url", sa.String(1024)),
    ]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    op.create_table(
        "area",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("parent_id", sa.Integer, sa.ForeignKey("area.id", ondelete="RESTRICT")),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(220), nullable=False, unique=True),
        sa.Column("description", sa.Text),
        *_source_columns(),
        sa.CheckConstraint("kind IN ('obszar', 'region', 'sektor')", name="ck_area_kind"),
        sa.UniqueConstraint("source", "source_id", name="uq_area_source"),
    )
    op.create_index("ix_area_parent_id", "area", ["parent_id"])

    op.create_table(
        "crag",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("area_id", sa.Integer, sa.ForeignKey("area.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(220), nullable=False, unique=True),
        sa.Column("location", Geometry("POINT", srid=4326, spatial_index=False), nullable=False),
        sa.Column("rock_type", sa.String(64)),
        sa.Column("height_min", sa.Float),
        sa.Column("height_max", sa.Float),
        sa.Column("aspects", postgresql.ARRAY(sa.String(3)), nullable=False, server_default="{}"),
        sa.Column("formations", postgresql.ARRAY(sa.String(32)), nullable=False, server_default="{}"),
        sa.Column("approach_minutes", sa.Integer),
        sa.Column("description", sa.Text),
        sa.Column("approach_description", sa.Text),
        *_source_columns(),
        sa.UniqueConstraint("source", "source_id", name="uq_crag_source"),
    )
    op.create_index("ix_crag_area_id", "crag", ["area_id"])
    op.create_index("ix_crag_location", "crag", ["location"], postgresql_using="gist")

    op.create_table(
        "wall",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("crag_id", sa.Integer, sa.ForeignKey("crag.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200)),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("image_original_path", sa.String(500)),
        sa.Column("image_path", sa.String(500)),
        sa.Column("thumb_path", sa.String(500)),
        sa.Column("image_width", sa.Integer),
        sa.Column("image_height", sa.Integer),
        sa.Column("depth_path", sa.String(500)),
        sa.Column("depth_status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("depth_model", sa.String(64)),
        *_source_columns(),
        sa.CheckConstraint("depth_status IN ('pending', 'ready', 'failed')", name="ck_wall_depth_status"),
        sa.UniqueConstraint("source", "source_id", name="uq_wall_source"),
    )
    op.create_index("ix_wall_crag_id", "wall", ["crag_id"])

    op.create_table(
        "route",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("crag_id", sa.Integer, sa.ForeignKey("crag.id", ondelete="CASCADE"), nullable=False),
        sa.Column("number", sa.Integer),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("grade", sa.String(32)),
        sa.Column("grade_sort", sa.Integer),
        sa.Column("length_m", sa.Float),
        sa.Column("protection", sa.String(100)),
        sa.Column("first_ascent", sa.String(300)),
        sa.Column("year", sa.Integer),
        sa.Column("description", sa.Text),
        *_source_columns(),
        sa.UniqueConstraint("source", "source_id", name="uq_route_source"),
    )
    op.create_index("ix_route_crag_id", "route", ["crag_id"])
    op.create_index("ix_route_grade_sort", "route", ["grade_sort"])

    op.create_table(
        "route_line",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("wall_id", sa.Integer, sa.ForeignKey("wall.id", ondelete="CASCADE"), nullable=False),
        sa.Column("route_id", sa.Integer, sa.ForeignKey("route.id", ondelete="SET NULL")),
        sa.Column("color", sa.String(16), nullable=False, server_default="#e11d48"),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("parent_line_id", sa.Integer, sa.ForeignKey("route_line.id", ondelete="SET NULL")),
        sa.Column("parent_point_id", sa.Integer),
        *_source_columns(),
        sa.UniqueConstraint("source", "source_id", name="uq_route_line_source"),
    )
    op.create_index("ix_route_line_wall_id", "route_line", ["wall_id"])
    op.create_index("ix_route_line_route_id", "route_line", ["route_id"])

    op.create_table(
        "line_point",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("line_id", sa.Integer, sa.ForeignKey("route_line.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False),
        sa.Column("x", sa.Float, nullable=False),
        sa.Column("y", sa.Float, nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("visible", sa.Boolean, nullable=False, server_default=sa.true()),
        *_source_columns(),
        sa.CheckConstraint(
            "kind IN ('start', 'ring', 'hak', 'ucho', 'stanowisko', 'przelot')", name="ck_line_point_kind"
        ),
        sa.CheckConstraint("x >= 0 AND x <= 1 AND y >= 0 AND y <= 1", name="ck_line_point_xy"),
        sa.UniqueConstraint("source", "source_id", name="uq_line_point_source"),
    )
    op.create_index("ix_line_point_line_id", "line_point", ["line_id"])
    op.create_foreign_key(
        "fk_route_line_parent_point_id", "route_line", "line_point", ["parent_point_id"], ["id"], ondelete="SET NULL"
    )

    op.create_table(
        "depth_job",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("wall_id", sa.Integer, sa.ForeignKey("wall.id", ondelete="CASCADE"), nullable=False),
        sa.Column("model", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
        sa.Column("error", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('queued', 'running', 'done', 'failed')", name="ck_depth_job_status"),
    )
    op.create_index("ix_depth_job_wall_id", "depth_job", ["wall_id"])
    op.create_index("ix_depth_job_status", "depth_job", ["status"])

    op.execute(AREA_GEOM_SQL)
    op.execute("CREATE UNIQUE INDEX ix_area_geom_area_id ON area_geom (area_id)")


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS area_geom")
    op.drop_table("depth_job")
    op.drop_constraint("fk_route_line_parent_point_id", "route_line", type_="foreignkey")
    op.drop_table("line_point")
    op.drop_table("route_line")
    op.drop_table("route")
    op.drop_table("wall")
    op.drop_table("crag")
    op.drop_table("area")
