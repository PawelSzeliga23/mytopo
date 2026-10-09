"""edycja: reverts_id, needs_location, timestamptz, indeksy wersji

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-09 12:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None

TABLES = ("area", "crag", "wall", "route", "route_line", "line_point")


def upgrade() -> None:
    op.alter_column("transaction", "issued_at", type_=sa.DateTime(timezone=True), postgresql_using="issued_at AT TIME ZONE 'UTC'")
    op.add_column("transaction", sa.Column("reverts_id", sa.BigInteger(), nullable=True))
    op.create_index("ix_transaction_reverts_id", "transaction", ["reverts_id"])
    op.add_column("crag", sa.Column("needs_location", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("crag_version", sa.Column("needs_location", sa.Boolean(), nullable=True, server_default="false"))
    for table in TABLES:
        op.create_index(f"ix_{table}_version_source", f"{table}_version", ["source", "source_id"])


def downgrade() -> None:
    for table in TABLES:
        op.drop_index(f"ix_{table}_version_source", f"{table}_version")
    op.drop_column("crag_version", "needs_location")
    op.drop_column("crag", "needs_location")
    op.drop_index("ix_transaction_reverts_id", "transaction")
    op.drop_column("transaction", "reverts_id")
    op.alter_column("transaction", "issued_at", type_=sa.DateTime(timezone=False))
