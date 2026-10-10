"""wyszukiwanie bez polskich znaków

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-10 23:00:00
"""
from alembic import op


revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS unaccent")
