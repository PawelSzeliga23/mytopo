from fastapi import Request
from sqlalchemy.orm import Session

from topo.api.errors import ApiError
from topo.auth import COOKIE, read_token
from topo.config import get_settings
from topo.history import set_author


def current_editor(request: Request) -> str:
    nick = read_token(request.cookies.get(COOKIE), get_settings())
    if not nick:
        raise ApiError(401, "unauthorized", "Zaloguj się, aby edytować")
    return nick


def start_change(session: Session, nick: str, comment: str | None) -> None:
    set_author(session, nick, (comment or "").strip() or None)
