from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from topo.history import enable_versioning

enable_versioning()


class Base(DeclarativeBase):
    pass


class SourceMixin:
    """Where a record came from; (source, source_id) lets imports upsert without duplicates."""

    source: Mapped[str] = mapped_column(String(32), default="manual", server_default="manual")
    source_id: Mapped[str | None] = mapped_column(String(64))
    source_url: Mapped[str | None] = mapped_column(String(1024))


def source_constraint(table: str) -> UniqueConstraint:
    return UniqueConstraint("source", "source_id", name=f"uq_{table}_source")
