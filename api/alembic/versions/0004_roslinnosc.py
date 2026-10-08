"""roślinność i ręczne 2.5D ściany

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-08 23:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None

COLUMNS = (
    ('vegetation_ratio', sa.Float),
    ('route_vegetation_ratio', sa.Float),
    ('depth_enabled', sa.Boolean),
)


def upgrade() -> None:
    for table in ('wall', 'wall_version'):
        for name, type_ in COLUMNS:
            op.add_column(table, sa.Column(name, type_(), autoincrement=False, nullable=True))


def downgrade() -> None:
    for table in ('wall_version', 'wall'):
        for name, _ in reversed(COLUMNS):
            op.drop_column(table, name)
