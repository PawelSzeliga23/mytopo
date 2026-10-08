from collections.abc import Sequence

from slugify import slugify
from sqlalchemy import select
from sqlalchemy.orm import Session


def make_slug(text: str) -> str:
    return slugify(text, max_length=200) or "bez-nazwy"


def unique_slug(session: Session, model: type, name: str, context: Sequence[str] = ()) -> str:
    """Return a free slug: the name, then the name extended with context parts, then name-2, name-3..."""
    candidates = [make_slug(" ".join([name, *context[:i]])) for i in range(len(context) + 1)]
    for candidate in candidates:
        if not _taken(session, model, candidate):
            return candidate
    base = candidates[0]
    number = 2
    while _taken(session, model, f"{base}-{number}"):
        number += 1
    return f"{base}-{number}"


def _taken(session: Session, model: type, slug: str) -> bool:
    return session.scalar(select(model.id).where(model.slug == slug)) is not None
