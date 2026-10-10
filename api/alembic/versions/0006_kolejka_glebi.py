"""kolejka głębi: model zadania wpisuje worker

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-10 12:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column('depth_job', 'model', existing_type=sa.String(64), nullable=True)


def downgrade() -> None:
    op.execute("UPDATE depth_job SET model = '' WHERE model IS NULL")
    op.alter_column('depth_job', 'model', existing_type=sa.String(64), nullable=False)
