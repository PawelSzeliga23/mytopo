import hmac

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from topo.api.errors import ApiError
from topo.auth import COOKIE, MAX_AGE, clean_nick, login_limiter, make_token, read_token
from topo.config import get_settings

router = APIRouter()


class LoginIn(BaseModel):
    password: str
    nick: str


class MeOut(BaseModel):
    nick: str | None  # None: not logged in (a 200, so the browser logs no failed request)


class NickOut(BaseModel):
    nick: str


@router.post("/login", response_model=NickOut)
def login(body: LoginIn, request: Request, response: Response) -> NickOut:
    if not login_limiter.hit(request.client.host if request.client else "unknown"):
        raise ApiError(429, "too_many_attempts", "Za dużo prób logowania, spróbuj za chwilę")
    settings = get_settings()
    if not settings.edit_password or not settings.secret_key:
        raise ApiError(503, "editing_disabled", "Edycja wyłączona")
    if not hmac.compare_digest(body.password.encode(), settings.edit_password.encode()):
        raise ApiError(401, "wrong_password", "Złe hasło")
    nick = clean_nick(body.nick)
    response.set_cookie(
        COOKIE,
        make_token(nick, settings),
        max_age=MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=settings.public_url.startswith("https://"),
        path="/",
    )
    return NickOut(nick=nick)


@router.post("/logout", status_code=204)
def logout(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/")


@router.get("/me", response_model=MeOut)
def me(request: Request) -> MeOut:
    return MeOut(nick=read_token(request.cookies.get(COOKIE), get_settings()) or None)
