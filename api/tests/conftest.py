import warnings
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SAWarning
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from topo.api.app import create_app
from topo.auth import login_limiter
from topo.config import get_settings
from topo.db import get_session

warnings.filterwarnings("error", category=SAWarning)

API_DIR = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session")
def engine():
    url = get_settings().test_database_url
    database = make_url(url).database or ""
    if not database.endswith("_test"):
        pytest.fail(
            f"Refusing to reset schema of database {database!r}: TEST_DATABASE_URL must point to a *_test database",
            pytrace=False,
        )
    eng = create_engine(url)
    with eng.begin() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")
    yield eng
    eng.dispose()


@pytest.fixture
def session(engine):
    conn = engine.connect()
    trans = conn.begin()
    db = Session(bind=conn, join_transaction_mode="create_savepoint")
    yield db
    db.close()
    trans.rollback()
    conn.close()


@pytest.fixture
def client(session):
    app = create_app()
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def edit_settings(monkeypatch):
    monkeypatch.setenv("EDIT_PASSWORD", "tajne")
    monkeypatch.setenv("SECRET_KEY", "klucz-testowy")
    get_settings.cache_clear()
    yield get_settings()
    get_settings.cache_clear()


@pytest.fixture
def editor(client, edit_settings):
    login_limiter.clear()
    response = client.post("/api/auth/login", json={"password": "tajne", "nick": "ania"})
    assert response.status_code == 200
    yield client
    login_limiter.clear()
