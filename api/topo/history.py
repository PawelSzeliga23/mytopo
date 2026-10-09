"""Change history (SQLAlchemy-Continuum): every write is a versioned transaction with an author."""

from collections.abc import Iterable
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy_continuum import UnitOfWork, make_versioned, version_class, versioning_manager
from sqlalchemy_continuum.plugins.base import Plugin
from sqlalchemy_continuum.transaction import TransactionFactory

IMPORT_AUTHOR_PREFIX = "import:"


class _TopoTransactionFactory(TransactionFactory):
    """Continuum's Transaction table extended with who made the change and why."""

    def create_class(self, manager):
        transaction = super().create_class(manager)
        transaction.author = sa.Column(sa.String(100))
        transaction.comment = sa.Column(sa.String(500))
        transaction.reverts_id = sa.Column(sa.BigInteger, index=True)
        # Continuum's issued_at is a naive DateTime (from TransactionBase); make it timezone-aware in place.
        issued_at = transaction.__table__.c.issued_at
        issued_at.type = sa.DateTime(timezone=True)
        issued_at.default = sa.ColumnDefault(lambda: datetime.now(UTC))
        return transaction


class _TopoUnitOfWork(UnitOfWork):
    """Writes versions in the caller's (sub)transaction instead of opening a SAVEPOINT of its own.

    Continuum's internal version session uses the default join mode, which starts its own SAVEPOINT
    whenever the caller's connection is inside one (``begin_nested()``, the test fixture) and never
    releases it; SQLAlchemy then warns "nested transaction already deassociated from connection".
    """

    def _ensure_version_session(self, session: Session) -> None:
        if self.version_session is None:
            self.version_session = Session(bind=session.connection(), join_transaction_mode="rollback_only")

    def process_before_flush(self, session):
        if session is not self.version_session and self.is_modified(session):
            self._ensure_version_session(session)
        super().process_before_flush(session)

    def process_after_flush(self, session):
        if session is not self.version_session and self.current_transaction is not None:
            self._ensure_version_session(session)
        super().process_after_flush(session)

    def create_transaction(self, session):
        self._ensure_version_session(session)
        return super().create_transaction(session)


class _AuthorPlugin(Plugin):
    def transaction_args(self, uow, session):
        return {"author": session.info.get("author"), "comment": session.info.get("comment"), "reverts_id": session.info.get("reverts_id")}


def enable_versioning() -> None:
    versioning_manager.transaction_cls = _TopoTransactionFactory(remote_addr=False)
    versioning_manager.uow_class = _TopoUnitOfWork
    make_versioned(user_cls=None, plugins=[_AuthorPlugin()])


def set_author(session: Session, author: str, comment: str | None = None, reverts_id: int | None = None) -> None:
    session.info["author"] = author
    session.info["comment"] = comment
    session.info["reverts_id"] = reverts_id


def transaction_class() -> type:
    return versioning_manager.transaction_cls


def has_manual_version(session: Session, model: type, *conditions) -> bool:
    """True if any version row of ``model`` matching ``conditions`` was written by someone other than an importer.

    Conditions are built on the version class columns (``version_class(model)``).
    """
    transaction = transaction_class()
    version = version_class(model)
    # A version whose transaction row is gone (left by a rolled-back SAVEPOINT) counts as manual.
    manual = sa.or_(
        transaction.id.is_(None), transaction.author.is_(None), sa.not_(transaction.author.startswith(IMPORT_AUTHOR_PREFIX))
    )
    stmt = sa.select(
        sa.exists(
            sa.select(version.id)
            .select_from(version)
            .outerjoin(transaction, version.transaction_id == transaction.id)
            .where(manual, *conditions)
        )
    )
    return bool(session.scalar(stmt))


def is_manually_edited(session: Session, model: type, ids: Iterable[int]) -> bool:
    """True if any version of the given rows was written by someone other than an importer."""
    ids = list(ids)
    if not ids:
        return False
    return has_manual_version(session, model, version_class(model).id.in_(ids))
