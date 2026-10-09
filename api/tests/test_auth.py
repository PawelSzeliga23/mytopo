import pytest

from topo.api.app import create_app
from topo.auth import COOKIE, LoginLimiter, login_limiter
from topo.config import get_settings


@pytest.fixture(autouse=True)
def _clear_limiter():
    login_limiter.clear()
    yield
    login_limiter.clear()


def login(client, password="tajne", nick="ania"):
    return client.post("/api/auth/login", json={"password": password, "nick": nick})


def test_login_sets_cookie_and_me(client, edit_settings):
    response = login(client)
    assert response.status_code == 200
    assert response.json() == {"nick": "ania"}
    header = response.headers["set-cookie"]
    assert f"{COOKIE}=" in header
    assert "HttpOnly" in header
    assert "Max-Age=31536000" in header
    assert client.get("/api/auth/me").json() == {"nick": "ania"}


def test_wrong_password(client, edit_settings):
    response = login(client, password="zle")
    assert response.status_code == 401
    assert response.json() == {"code": "wrong_password", "message": "Złe hasło"}


def test_rate_limit_even_with_correct_password(client, edit_settings):
    for _ in range(5):
        assert login(client, password="zle").status_code == 401
    response = login(client)
    assert response.status_code == 429
    assert response.json()["code"] == "too_many_attempts"


def test_limiter_resets_after_window():
    limiter = LoginLimiter(limit=2, window=60.0)
    assert limiter.hit("ip", now=0.0)
    assert limiter.hit("ip", now=1.0)
    assert not limiter.hit("ip", now=2.0)
    assert limiter.hit("ip", now=100.0)


@pytest.mark.parametrize("nick", [" a ", "import:x", "x" * 41])
def test_invalid_nick(client, edit_settings, nick):
    response = login(client, nick=nick)
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_nick"


def test_nick_is_trimmed(client, edit_settings):
    assert login(client, nick="  ania ").json() == {"nick": "ania"}
    assert client.get("/api/auth/me").json() == {"nick": "ania"}


def test_password_change_logs_out(client, edit_settings, monkeypatch):
    login(client)
    monkeypatch.setenv("EDIT_PASSWORD", "inne")
    get_settings.cache_clear()
    assert client.get("/api/auth/me").status_code == 401


def test_forged_cookie(client, edit_settings):
    client.cookies.set(COOKIE, "podrobione")
    response = client.get("/api/auth/me")
    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


def test_logout(client, edit_settings):
    login(client)
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_editing_disabled_without_password(client, monkeypatch):
    monkeypatch.delenv("EDIT_PASSWORD", raising=False)
    monkeypatch.delenv("SECRET_KEY", raising=False)
    get_settings.cache_clear()
    try:
        response = login(client)
        assert response.status_code == 503
        assert response.json()["code"] == "editing_disabled"
    finally:
        get_settings.cache_clear()


def test_password_without_secret_key_fails_on_start(monkeypatch):
    monkeypatch.setenv("EDIT_PASSWORD", "tajne")
    monkeypatch.delenv("SECRET_KEY", raising=False)
    get_settings.cache_clear()
    try:
        with pytest.raises(RuntimeError):
            create_app()
    finally:
        get_settings.cache_clear()
