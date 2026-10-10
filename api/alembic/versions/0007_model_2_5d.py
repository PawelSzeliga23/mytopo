"""model 2.5D z edytora i kolory ściany

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-10 22:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None

COLUMNS = (
    ('model_path', sa.String(500)),
    ('rock_color', sa.String(7)),
    ('ground_color', sa.String(7)),
)


def upgrade() -> None:
    for table in ('wall', 'wall_version'):
        for name, type_ in COLUMNS:
            op.add_column(table, sa.Column(name, type_, autoincrement=False, nullable=True))


def downgrade() -> None:
    for table in ('wall_version', 'wall'):
        for name, _ in reversed(COLUMNS):
            op.drop_column(table, name)
