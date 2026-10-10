"""indeksy trigramowe do wyszukiwania po nazwie

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-11 12:00:00
"""
from alembic import op


revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None

TABLES = ("area", "crag", "wall", "route")


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    # unaccent() is only STABLE (it reads its dictionary), so an index needs an IMMUTABLE wrapper.
    op.execute(
        "CREATE OR REPLACE FUNCTION search_key(value text) RETURNS text "
        "LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT "
        "AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, lower(value)) $$"
    )
    for table in TABLES:
        op.execute(f"CREATE INDEX ix_{table}_name_search ON {table} USING gin (search_key(name) gin_trgm_ops)")


def downgrade() -> None:
    for table in TABLES:
        op.execute(f"DROP INDEX IF EXISTS ix_{table}_name_search")
    op.execute("DROP FUNCTION IF EXISTS search_key(text)")
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
