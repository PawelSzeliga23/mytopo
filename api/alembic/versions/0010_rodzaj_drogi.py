"""widok route_kind: droga sportowa albo tradowa

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-11 18:00:00
"""
from alembic import op


revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Sport: a bolt-like point on any of the route's lines, or bolts named in the imported protection text
    # ("4r + ST" rings, "3s" spits, "1h" pitons; "2ST" is two belays, hence the word end). Everything else is trad.
    op.execute(r"""
        CREATE VIEW route_kind AS
        SELECT r.id AS route_id,
               CASE WHEN coalesce(r.protection, '') ~* '\d+\s*[rsh]\M'
                         OR EXISTS (
                             SELECT 1 FROM route_line l JOIN line_point p ON p.line_id = l.id
                             WHERE l.route_id = r.id AND p.kind IN ('ring', 'hak', 'ucho')
                         )
                    THEN 'sport' ELSE 'trad' END AS kind
        FROM route r
    """)


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS route_kind")
