# Plan 1: szkielet, baza danych i API odczytu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Działający szkielet projektu w Docker Compose: Postgres z PostGIS, FastAPI z modelem danych ze specu, migracją Alembic, widokiem `area_geom` i publicznym API odczytu dla mapy, obszarów i skał.

**Architecture:** Backend w kontenerze (`ghcr.io/astral-sh/uv:python3.12-bookworm-slim`), kod montowany z `./api`, zależności w `/opt/venv` zarządzane przez uv. Baza `postgis/postgis:16-3.4` z osobną bazą testową `topo_test`. Testy pytest uruchamiane w kontenerze `api` na prawdziwym PostGIS; każdy test działa w transakcji wycofywanej po teście.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, GeoAlchemy2, Alembic, psycopg 3, pydantic-settings, python-slugify, pytest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-08-topo-design.md`

## Mapa planów (kamienie milowe ze specu, §11)

| Plan | Zakres | Status |
|---|---|---|
| **1** | **Szkielet, baza, migracje, API odczytu** | ten dokument |
| 2 | Importer Portalu Górskiego + weryfikacja na prawdziwych danych | po planie 1 |
| 3 | Front: rozmowa o designie + mockupy (spec §6.0), szkielet React, mapa z trzema poziomami | po planie 2 |
| 4 | Strona skały: widok 2D i lista dróg | |
| 5 | Mapy głębi (GPU, CLI) i widok 2.5D | |
| 6 | Hasło, edycja tekstu, historia zmian (SQLAlchemy-Continuum) | |
| 7 | Edytor topo i wgrywanie zdjęć z kolejką głębi | |
| 8 | Wyszukiwarka, strony obszarów, ostatnie zmiany | |
| 9 | Importer wspinanie.pl, eksport, wdrożenie | |

## Global Constraints

- Python **3.12**; obraz bazowy API: `ghcr.io/astral-sh/uv:python3.12-bookworm-slim`.
- Baza: `postgis/postgis:16-3.4`, `shared_buffers=64MB`, osobny wolumen `db-data`.
- Współrzędne punktów linii: `x`, `y` jako float w zakresie **0–1** względem zdjęcia (wymuszone w bazie).
- Każda tabela treści (`area`, `crag`, `wall`, `route`, `route_line`, `line_point`) ma `source` (domyślnie `manual`), `source_id`, `source_url` i unikalny klucz `(source, source_id)`.
- Wartości enumów: `area.kind` ∈ {obszar, region, sektor}; `wall.depth_status` ∈ {pending, ready, failed}; `line_point.kind` ∈ {start, ring, hak, ucho, stanowisko, przelot}; `depth_job.status` ∈ {queued, running, done, failed}.
- Błędy API zawsze w formacie `{"code": ..., "message": ...}`; komunikaty dla użytkownika po polsku.
- Adresy (`PUBLIC_URL`, `MEDIA_URL`), ścieżki i połączenia z bazą tylko w zmiennych środowiskowych.
- **Zasada testów (preferencja autora):** testy pisane razem z kodem w każdym zadaniu, ale **uruchamiane raz, na końcu zadania** — nie po każdym kroku. Jeśli coś nie przechodzi, poprawiamy i uruchamiamy ponownie.
- Komendy podane dla PowerShell (główna powłoka autora, Windows 11). Wymagany uruchomiony Docker Desktop.

## Review Focus

1. **Skała przypięta bezpośrednio do regionu (bez sektora)** — musi liczyć się w agregatach regionu i obszaru, a na mapie mieć `in_sector=false` (front pokaże ją już na poziomie sektorów). Testy: Task 3 (`test_area_geom_aggregates_descendant_crags`), Task 4 (`test_map_crags_with_grade_bands`).
2. **Obszar bez żadnej skały** — nie pojawia się na mapie, a jego strona zwraca `center=null`, `bbox=null` zamiast błędu 500. Testy: Task 3, Task 4 (`test_map_sectors_as_hulls_skip_empty`), Task 5 (`test_empty_area_detail_has_no_geometry`).
3. **Powtarzające się nazwy skał** (np. „Kapliczka” w kilku dolinach) — slugi muszą być unikalne i czytelne (najpierw z nazwą doliny, potem z numerem). Test: Task 3 (`test_unique_slug_uses_context_then_number`).
4. **Nietypowe zapisy wycen** (małe litery, spacje, przecinek zamiast kropki, półpauza, wyceny łamane „VI.1+/2”, wyceny francuskie, „A0”, pusty tekst) — poprawna wartość sortująca albo `None`, nigdy wyjątek. Testy: Task 2.
5. **Ściana bez zdjęcia lub z głębią w przygotowaniu oraz linia bez przypisanej drogi (wariant)** — API zwraca `null` w URL-ach i nadal zwraca linie. Test: Task 5 (`test_crag_without_photos`, `test_crag_detail_full`).

---

## Struktura plików

```
topo/
├── .gitignore, .gitattributes, .env.example, README.md
├── docker-compose.yml
├── db/init/01-test-db.sql            tworzy bazę topo_test
└── api/
    ├── Dockerfile, pyproject.toml, uv.lock
    ├── alembic.ini
    ├── alembic/env.py, script.py.mako
    ├── alembic/versions/0001_initial.py   tabele + widok area_geom
    ├── topo/
    │   ├── config.py      Settings (zmienne środowiskowe)
    │   ├── db.py          engine, get_session, refresh_area_geom
    │   ├── grades.py      wyceny: normalizacja, grade_sort, pasma, odpowiedniki francuskie
    │   ├── slugs.py       make_slug, unique_slug
    │   ├── queries.py     crag_summaries (wspólne zapytanie: liczby dróg i pasma wycen)
    │   ├── schemas.py     modele odpowiedzi Pydantic
    │   ├── main.py        app = create_app()
    │   ├── models/        base, area, crag, wall, route (Route, RouteLine, LinePoint), depth_job
    │   └── api/           app (create_app), errors, common, map, areas, crags
    └── tests/
        ├── conftest.py    engine (reset schematu + migracje), session (transakcja), client
        ├── factories.py   area, crag, route, wall, line
        ├── test_health.py, test_grades.py, test_models.py
        └── test_api_map.py, test_api_areas.py, test_api_crags.py
```

---

### Task 1: Szkielet repozytorium, Docker Compose i endpoint zdrowia

**Files:**
- Create: `.gitignore`, `.gitattributes`, `.env.example`, `README.md`, `docker-compose.yml`, `db/init/01-test-db.sql`
- Create: `api/Dockerfile`, `api/pyproject.toml`, `api/uv.lock` (generowany)
- Create: `api/topo/__init__.py`, `api/topo/config.py`, `api/topo/main.py`, `api/topo/api/__init__.py`, `api/topo/api/app.py`
- Test: `api/tests/__init__.py`, `api/tests/test_health.py`

**Interfaces:**
- Produces: `topo.config.Settings` (pola: `database_url`, `test_database_url`, `media_url`, `media_root`, `public_url`), `topo.config.get_settings() -> Settings` (cache), `topo.api.app.create_app() -> FastAPI`, `GET /api/health -> {"status": "ok"}`, serwis `api` i `db` w compose.

- [ ] **Step 0: Upewnij się, że Docker Desktop działa**

Run: `docker info --format "{{.ServerVersion}}"`
Expected: numer wersji (a nie błąd `failed to connect to the docker API`). Jeśli błąd — uruchom Docker Desktop i poczekaj, aż wystartuje.

- [ ] **Step 1: Pliki repozytorium**

`.gitignore`:
```gitignore
.env
__pycache__/
*.pyc
.pytest_cache/
.venv/
node_modules/
/cache/
/media/
/out/
```

`.gitattributes`:
```gitattributes
* text=auto eol=lf
*.png binary
*.jpg binary
*.webp binary
```

`.env.example`:
```dotenv
# Skopiuj do .env i zmień w razie potrzeby
DATABASE_URL=postgresql+psycopg://topo:topo@db:5432/topo
TEST_DATABASE_URL=postgresql+psycopg://topo:topo@db:5432/topo_test
PUBLIC_URL=http://localhost:5173
MEDIA_URL=/media
MEDIA_ROOT=/data/media
```

`db/init/01-test-db.sql`:
```sql
CREATE DATABASE topo_test;
```

`docker-compose.yml`:
```yaml
services:
  db:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_USER: topo
      POSTGRES_PASSWORD: topo
      POSTGRES_DB: topo
    command: ["postgres", "-c", "shared_buffers=64MB"]
    volumes:
      - db-data:/var/lib/postgresql/data
      - ./db/init/01-test-db.sql:/docker-entrypoint-initdb.d/01-test-db.sql:ro
    ports:
      - "127.0.0.1:5433:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U topo -d topo"]
      interval: 5s
      timeout: 3s
      retries: 20

  api:
    build: ./api
    env_file:
      - path: .env
        required: false
    environment:
      DATABASE_URL: ${DATABASE_URL:-postgresql+psycopg://topo:topo@db:5432/topo}
      TEST_DATABASE_URL: ${TEST_DATABASE_URL:-postgresql+psycopg://topo:topo@db:5432/topo_test}
    command: ["uvicorn", "topo.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
    volumes:
      - ./api:/app
      - media:/data/media
    ports:
      - "127.0.0.1:8000:8000"
    depends_on:
      db:
        condition: service_healthy

volumes:
  db-data:
  media:
```

`README.md`:
````markdown
# Topo

Wiki topo dróg wspinaczkowych. Spec: `docs/superpowers/specs/2026-10-08-topo-design.md`.

## Uruchomienie (dev)

```powershell
docker compose up -d db
docker compose up api          # API na http://localhost:8000, dokumentacja: /docs
```

## Testy

```powershell
docker compose run --rm api pytest
```

## Zależności Pythona

Po zmianie `api/pyproject.toml`:

```powershell
docker run --rm -v "${PWD}/api:/app" -w /app ghcr.io/astral-sh/uv:python3.12-bookworm-slim uv lock
docker compose build api
```
````

- [ ] **Step 2: Projekt Pythona i obraz**

`api/pyproject.toml`:
```toml
[project]
name = "topo"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "sqlalchemy>=2.0.30",
    "geoalchemy2[shapely]>=0.15",
    "alembic>=1.13",
    "psycopg[binary]>=3.2",
    "pydantic-settings>=2.4",
    "python-slugify>=8.0",
]

[dependency-groups]
dev = [
    "pytest>=8",
    "httpx>=0.27",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["topo"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

`api/Dockerfile`:
```dockerfile
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project
COPY . .
RUN uv sync --frozen

EXPOSE 8000
CMD ["uvicorn", "topo.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Wygeneruj lock (z katalogu głównego repo, PowerShell):
```powershell
docker run --rm -v "${PWD}/api:/app" -w /app ghcr.io/astral-sh/uv:python3.12-bookworm-slim uv lock
```
Expected: powstaje `api/uv.lock`.

- [ ] **Step 3: Test zdrowia**

`api/tests/__init__.py`: pusty plik.

`api/tests/test_health.py`:
```python
from fastapi.testclient import TestClient

from topo.api.app import create_app


def test_health_returns_ok():
    client = TestClient(create_app())
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 4: Konfiguracja i aplikacja**

`api/topo/__init__.py`: pusty plik. `api/topo/api/__init__.py`: pusty plik.

`api/topo/config.py`:
```python
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://topo:topo@db:5432/topo"
    test_database_url: str = "postgresql+psycopg://topo:topo@db:5432/topo_test"
    public_url: str = "http://localhost:5173"
    media_url: str = "/media"
    media_root: str = "/data/media"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

`api/topo/api/app.py`:
```python
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from topo.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Topo API")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.mount(settings.media_url, StaticFiles(directory=settings.media_root, check_dir=False), name="media")
    return app
```

`api/topo/main.py`:
```python
from topo.api.app import create_app

app = create_app()
```

- [ ] **Step 5: Zbuduj, uruchom testy i sprawdź ręcznie**

```powershell
docker compose up -d db
docker compose build api
docker compose run --rm api pytest
```
Expected: `1 passed`.

```powershell
docker compose up -d api
curl.exe http://localhost:8000/api/health
docker compose exec db psql -U topo -c "\l"
```
Expected: `{"status":"ok"}`; lista baz zawiera `topo` i `topo_test`.

- [ ] **Step 6: Commit**

```powershell
git add .gitignore .gitattributes .env.example README.md docker-compose.yml db api
git commit -m "feat: szkielet projektu (compose, FastAPI, PostGIS)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Wyceny i slugi (czyste funkcje)

**Files:**
- Create: `api/topo/grades.py`, `api/topo/slugs.py` (na razie tylko `make_slug`)
- Test: `api/tests/test_grades.py`, `api/tests/test_slugs.py`

**Interfaces:**
- Produces:
  - `normalize_grade(raw: str) -> str`
  - `grade_sort(raw: str | None) -> int | None` — skala: indeks bazy × 20, „+” = +6, „-” = −6, wycena łamana = średnia całkowita obu części
  - `BAND_LIMITS: tuple[int, int, int] = (94, 140, 200)` — granice pasm: `VI-`, `VI.2`, `VI.5`
  - `grade_band(sort: int | None) -> int | None` — 0: ≤ V+, 1: VI- … VI.1+/2, 2: VI.2 … VI.4+/5, 3: ≥ VI.5
  - `to_french(raw: str | None) -> str | None`
  - `make_slug(text: str) -> str` (pusty wynik → `"bez-nazwy"`)

- [ ] **Step 1: Testy**

`api/tests/test_grades.py`:
```python
import pytest

from topo.grades import BAND_LIMITS, grade_band, grade_sort, normalize_grade, to_french

ORDERED = [
    "I", "II", "III", "III+", "IV-", "IV", "IV+", "V-", "V", "V+",
    "VI-", "VI", "VI+", "VI+/1", "VI.1-", "VI.1", "VI.1/1+", "VI.1+", "VI.1+/2",
    "VI.2", "VI.2+", "VI.3", "VI.4+/5", "VI.5", "VI.5+/6", "VI.6", "VI.8", "VI.9",
]


def test_grade_sort_is_strictly_increasing():
    values = [grade_sort(g) for g in ORDERED]
    assert None not in values
    assert values == sorted(values)
    assert len(set(values)) == len(values)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (" vi.1+ ", "VI.1+"),
        ("VI,2", "VI.2"),
        ("VI.1 + / 2", "VI.1+/2"),
        ("V–", "V-"),
    ],
)
def test_normalize_grade(raw, expected):
    assert normalize_grade(raw) == expected


def test_messy_input_sorts_like_clean_input():
    assert grade_sort(" vi.1 + / 2 ") == grade_sort("VI.1+/2")


@pytest.mark.parametrize("raw", [None, "", "6a", "A0", "VI.10", "VII", "VI/V", "abc"])
def test_unknown_grades_return_none(raw):
    assert grade_sort(raw) is None


def test_band_limits_match_grades():
    assert BAND_LIMITS == (grade_sort("VI-"), grade_sort("VI.2"), grade_sort("VI.5"))


@pytest.mark.parametrize(
    ("grade", "band"),
    [("V+", 0), ("VI-", 1), ("VI.1+/2", 1), ("VI.2", 2), ("VI.4+/5", 2), ("VI.5", 3), ("6a", None)],
)
def test_grade_band(grade, band):
    assert grade_band(grade_sort(grade)) == band


@pytest.mark.parametrize(
    ("grade", "french"),
    [("III", "3"), ("V", "5a"), ("VI.1+", "6b+"), ("VI.3", "7a"), ("VI.1+/2", "6b+/6c"), ("6a", None), (None, None)],
)
def test_to_french(grade, french):
    assert to_french(grade) == french
```

`api/tests/test_slugs.py`:
```python
from topo.slugs import make_slug


def test_make_slug_transliterates_polish():
    assert make_slug("Żabi Koń") == "zabi-kon"
    assert make_slug("Łysa Skała – Ściana Północna") == "lysa-skala-sciana-polnocna"


def test_make_slug_never_empty():
    assert make_slug("!!!") == "bez-nazwy"
```

- [ ] **Step 2: Implementacja**

`api/topo/grades.py`:
```python
"""Polish (Kraków) climbing grades: normalisation, sort keys, bands and French equivalents."""

import re
from bisect import bisect_right

_BASES = ["I", "II", "III", "IV", "V", "VI"] + [f"VI.{n}" for n in range(1, 10)]
_INDEX = {base: i for i, base in enumerate(_BASES)}
_SINGLE = re.compile(r"^(VI\.[1-9]|VI|V|IV|III|II|I)([+-]?)$")
_STEP = 20
_MODIFIER = {"": 0, "+": 6, "-": -6}
_DASHES = ("‐", "‑", "‒", "–", "—", "−")

# Upper-exclusive limits of bands 0..2: VI-, VI.2, VI.5
BAND_LIMITS: tuple[int, int, int] = (94, 140, 200)

_FRENCH = {
    "I": "1", "II": "2", "III": "3", "III+": "3+", "IV": "4a", "IV+": "4b",
    "V-": "4c", "V": "5a", "V+": "5b", "VI-": "5c", "VI": "6a", "VI+": "6a+",
    "VI.1": "6b", "VI.1+": "6b+", "VI.2": "6c", "VI.2+": "6c+",
    "VI.3": "7a", "VI.3+": "7a+", "VI.4": "7b", "VI.4+": "7b+",
    "VI.5": "7c", "VI.5+": "7c+", "VI.6": "8a", "VI.6+": "8a+",
    "VI.7": "8b", "VI.7+": "8b+", "VI.8": "8c", "VI.8+": "8c+", "VI.9": "9a",
}


def normalize_grade(raw: str) -> str:
    grade = raw.strip().upper()
    for dash in _DASHES:
        grade = grade.replace(dash, "-")
    return grade.replace(",", ".").replace(" ", "")


def _split(grade: str) -> tuple[str, str | None]:
    if "/" not in grade:
        return grade, None
    left, right = grade.split("/", 1)
    if right[:1].isdigit():
        right = f"VI.{right}"
    return left, right


def _single_sort(grade: str) -> int | None:
    match = _SINGLE.match(grade)
    if match is None:
        return None
    base, modifier = match.groups()
    return _INDEX[base] * _STEP + _MODIFIER[modifier]


def grade_sort(raw: str | None) -> int | None:
    if not raw:
        return None
    left, right = _split(normalize_grade(raw))
    low = _single_sort(left)
    if low is None:
        return None
    if right is None:
        return low
    high = _single_sort(right)
    if high is None or high <= low:
        return None
    return (low + high) // 2


def grade_band(sort: int | None) -> int | None:
    if sort is None:
        return None
    return bisect_right(BAND_LIMITS, sort)


def to_french(raw: str | None) -> str | None:
    if not raw:
        return None
    left, right = _split(normalize_grade(raw))
    french_left = _FRENCH.get(left)
    if french_left is None:
        return None
    if right is None:
        return french_left
    french_right = _FRENCH.get(right)
    return f"{french_left}/{french_right}" if french_right else None
```

`api/topo/slugs.py`:
```python
from slugify import slugify


def make_slug(text: str) -> str:
    return slugify(text, max_length=200) or "bez-nazwy"
```

- [ ] **Step 3: Uruchom testy**

Run: `docker compose run --rm api pytest tests/test_grades.py tests/test_slugs.py -v`
Expected: wszystkie PASS.

- [ ] **Step 4: Commit**

```powershell
git add api/topo/grades.py api/topo/slugs.py api/tests/test_grades.py api/tests/test_slugs.py
git commit -m "feat: wyceny (sortowanie, pasma, francuskie) i slugi" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Modele, migracja 0001, widok `area_geom`, fikstury testowe

**Files:**
- Create: `api/topo/db.py`, `api/topo/models/__init__.py`, `api/topo/models/base.py`, `api/topo/models/area.py`, `api/topo/models/crag.py`, `api/topo/models/wall.py`, `api/topo/models/route.py`, `api/topo/models/depth_job.py`
- Create: `api/alembic.ini`, `api/alembic/env.py`, `api/alembic/script.py.mako`, `api/alembic/versions/0001_initial.py`
- Modify: `api/topo/slugs.py` (dodaj `unique_slug`), `docker-compose.yml` (komenda `api` uruchamia migracje)
- Test: `api/tests/conftest.py`, `api/tests/factories.py`, `api/tests/test_models.py`

**Interfaces:**
- Consumes: `get_settings()` (Task 1), `grade_sort`, `make_slug` (Task 2).
- Produces:
  - Modele: `Area`, `Crag`, `Wall`, `Route`, `RouteLine`, `LinePoint`, `DepthJob`, `Base` z `topo.models`. Relacje: `Area.parent`, `Area.children`, `Area.crags`, `Crag.area`, `Crag.walls` (po `sort_order`), `Crag.routes` (po `number`), `Wall.crag`, `Wall.lines` (po `sort_order`), `RouteLine.wall`, `RouteLine.route`, `RouteLine.points` (po `sort_order`), `LinePoint.line`.
  - `topo.db.engine`, `topo.db.SessionLocal`, `topo.db.get_session() -> Iterator[Session]`, `topo.db.refresh_area_geom(session: Session) -> None`
  - `topo.slugs.unique_slug(session: Session, model: type, name: str, context: Sequence[str] = ()) -> str`
  - Widok `area_geom(area_id, crag_count, route_count, center geometry(Point), hull geometry(Polygon))`
  - Fikstury pytest: `engine`, `session`, `client`; fabryki w `tests/factories.py`: `area(session, name, kind="region", parent=None, **kw) -> Area`, `crag(session, area, name, lng=19.75, lat=50.15, **kw) -> Crag`, `route(session, crag, name, grade=None, **kw) -> Route`, `wall(session, crag, name="Ściana", **kw) -> Wall`, `line(session, wall, route=None, points=DEFAULT_POINTS, sort_order=0, **kw) -> RouteLine`

- [ ] **Step 1: Fikstury i fabryki**

`api/tests/conftest.py`:
```python
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from topo.api.app import create_app
from topo.config import get_settings
from topo.db import get_session

API_DIR = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session")
def engine():
    url = get_settings().test_database_url
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
```

`api/tests/factories.py`:
```python
from geoalchemy2 import WKTElement

from topo.grades import grade_sort
from topo.models import Area, Crag, LinePoint, Route, RouteLine, Wall
from topo.slugs import make_slug

DEFAULT_POINTS = ((0.5, 0.9, "start"), (0.5, 0.5, "ring"), (0.5, 0.1, "stanowisko"))


def area(session, name, kind="region", parent=None, **kw) -> Area:
    kw.setdefault("slug", make_slug(name))
    obj = Area(name=name, kind=kind, parent=parent, **kw)
    session.add(obj)
    session.flush()
    return obj


def crag(session, area, name, lng=19.75, lat=50.15, **kw) -> Crag:
    kw.setdefault("slug", make_slug(name))
    obj = Crag(area=area, name=name, location=WKTElement(f"POINT({lng} {lat})", srid=4326), **kw)
    session.add(obj)
    session.flush()
    return obj


def route(session, crag, name, grade=None, **kw) -> Route:
    obj = Route(crag=crag, name=name, grade=grade, grade_sort=grade_sort(grade), **kw)
    session.add(obj)
    session.flush()
    return obj


def wall(session, crag, name="Ściana", **kw) -> Wall:
    obj = Wall(crag=crag, name=name, **kw)
    session.add(obj)
    session.flush()
    return obj


def line(session, wall, route=None, points=DEFAULT_POINTS, sort_order=0, **kw) -> RouteLine:
    obj = RouteLine(wall=wall, route=route, sort_order=sort_order, **kw)
    obj.points = [
        LinePoint(sort_order=i, x=x, y=y, kind=kind, visible=kind != "start")
        for i, (x, y, kind) in enumerate(points)
    ]
    session.add(obj)
    session.flush()
    return obj
```

- [ ] **Step 2: Testy modeli**

`api/tests/test_models.py`:
```python
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests import factories as f
from topo.db import refresh_area_geom
from topo.grades import grade_sort
from topo.models import Area, Crag, LinePoint
from topo.slugs import unique_slug


def test_crag_roundtrip_with_walls_lines_points(session):
    region = f.area(session, "Dolina Kobylańska")
    crag = f.crag(session, region, "Żabi Koń", aspects=["W", "NW"], formations=["filar"])
    route = f.route(session, crag, "Lewy kant", grade="V+", number=1)
    wall = f.wall(session, crag)
    f.line(session, wall, route=route)
    session.expire_all()

    loaded = session.get(Crag, crag.id)
    assert loaded.aspects == ["W", "NW"]
    assert loaded.area.name == "Dolina Kobylańska"
    assert loaded.routes[0].grade_sort == grade_sort("V+")
    line = loaded.walls[0].lines[0]
    assert line.route.name == "Lewy kant"
    assert [p.kind for p in line.points] == ["start", "ring", "stanowisko"]
    assert loaded.walls[0].depth_status == "pending"
    assert loaded.walls[0].version == 1
    assert loaded.source == "manual"


def test_point_outside_unit_square_is_rejected(session):
    region = f.area(session, "R")
    line = f.line(session, f.wall(session, f.crag(session, region, "C")))
    session.add(LinePoint(line_id=line.id, sort_order=9, x=1.2, y=0.5, kind="ring"))
    with pytest.raises(IntegrityError):
        session.flush()


def test_point_kind_is_checked(session):
    region = f.area(session, "R")
    line = f.line(session, f.wall(session, f.crag(session, region, "C")))
    session.add(LinePoint(line_id=line.id, sort_order=9, x=0.2, y=0.5, kind="spit"))
    with pytest.raises(IntegrityError):
        session.flush()


def test_area_kind_is_checked(session):
    session.add(Area(name="X", slug="x", kind="dolina"))
    with pytest.raises(IntegrityError):
        session.flush()


def test_source_id_is_unique_per_source(session):
    f.area(session, "A", source="portalgorski", source_id="34", slug="a")
    with pytest.raises(IntegrityError):
        f.area(session, "B", source="portalgorski", source_id="34", slug="b")


def test_manual_records_may_share_empty_source_id(session):
    f.area(session, "A", slug="a")
    f.area(session, "B", slug="b")


def test_area_geom_aggregates_descendant_crags(session):
    jura = f.area(session, "Jura", kind="obszar")
    region = f.area(session, "Dolina Będkowska", parent=jura)
    sektor = f.area(session, "Sektor Zbędowych Skał", kind="sektor", parent=region)
    kolkowa = f.crag(session, sektor, "Kołkowa Skała", lng=19.70, lat=50.17)
    f.route(session, kolkowa, "A", grade="VI")
    f.route(session, kolkowa, "B", grade="VI.1")
    dupeczka = f.crag(session, region, "Dupeczka", lng=19.72, lat=50.18)  # bez sektora
    f.route(session, dupeczka, "C", grade="V")
    empty = f.area(session, "Pusty Sektor", kind="sektor", parent=region)
    refresh_area_geom(session)

    rows = {
        r.area_id: r
        for r in session.execute(
            text("SELECT area_id, crag_count, route_count, ST_GeometryType(hull) AS hull_type FROM area_geom")
        )
    }
    assert (rows[region.id].crag_count, rows[region.id].route_count) == (2, 3)
    assert (rows[jura.id].crag_count, rows[jura.id].route_count) == (2, 3)
    assert rows[sektor.id].crag_count == 1
    assert rows[sektor.id].hull_type == "ST_Polygon"
    assert rows[region.id].hull_type == "ST_Polygon"
    assert empty.id not in rows


def test_unique_slug_uses_context_then_number(session):
    region = f.area(session, "Dolina Będkowska")
    f.crag(session, region, "Kapliczka", slug="kapliczka")
    assert unique_slug(session, Crag, "Kapliczka", ["Dolina Kobylańska"]) == "kapliczka-dolina-kobylanska"

    f.crag(session, region, "Kapliczka (2)", slug="kapliczka-dolina-kobylanska")
    assert unique_slug(session, Crag, "Kapliczka", ["Dolina Kobylańska"]) == "kapliczka-2"
    assert unique_slug(session, Crag, "Żabi Koń") == "zabi-kon"
```

- [ ] **Step 3: Baza modeli i sesja**

`api/topo/models/base.py`:
```python
from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class SourceMixin:
    """Where a record came from; (source, source_id) lets imports upsert without duplicates."""

    source: Mapped[str] = mapped_column(String(32), default="manual", server_default="manual")
    source_id: Mapped[str | None] = mapped_column(String(64))
    source_url: Mapped[str | None] = mapped_column(String(1024))


def source_constraint(table: str) -> UniqueConstraint:
    return UniqueConstraint("source", "source_id", name=f"uq_{table}_source")
```

`api/topo/models/area.py`:
```python
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from topo.models.base import Base, SourceMixin, source_constraint

if TYPE_CHECKING:
    from topo.models.crag import Crag


class Area(SourceMixin, Base):
    __tablename__ = "area"
    __table_args__ = (
        source_constraint("area"),
        CheckConstraint("kind IN ('obszar', 'region', 'sektor')", name="ck_area_kind"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("area.id", ondelete="RESTRICT"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(220), unique=True)
    description: Mapped[str | None] = mapped_column(Text)

    parent: Mapped["Area | None"] = relationship(remote_side="Area.id", back_populates="children")
    children: Mapped[list["Area"]] = relationship(back_populates="parent", order_by="Area.name")
    crags: Mapped[list["Crag"]] = relationship(back_populates="area", order_by="Crag.name")
```

`api/topo/models/crag.py`:
```python
from typing import TYPE_CHECKING

from geoalchemy2 import Geometry, WKBElement
from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from topo.models.base import Base, SourceMixin, source_constraint

if TYPE_CHECKING:
    from topo.models.area import Area
    from topo.models.route import Route
    from topo.models.wall import Wall


class Crag(SourceMixin, Base):
    __tablename__ = "crag"
    __table_args__ = (
        source_constraint("crag"),
        Index("ix_crag_location", "location", postgresql_using="gist"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("area.id", ondelete="RESTRICT"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(220), unique=True)
    location: Mapped[WKBElement] = mapped_column(Geometry("POINT", srid=4326, spatial_index=False))
    rock_type: Mapped[str | None] = mapped_column(String(64))
    height_min: Mapped[float | None]
    height_max: Mapped[float | None]
    aspects: Mapped[list[str]] = mapped_column(ARRAY(String(3)), default=list, server_default="{}")
    formations: Mapped[list[str]] = mapped_column(ARRAY(String(32)), default=list, server_default="{}")
    approach_minutes: Mapped[int | None]
    description: Mapped[str | None] = mapped_column(Text)
    approach_description: Mapped[str | None] = mapped_column(Text)

    area: Mapped["Area"] = relationship(back_populates="crags")
    walls: Mapped[list["Wall"]] = relationship(
        back_populates="crag", order_by="Wall.sort_order", cascade="all, delete-orphan"
    )
    routes: Mapped[list["Route"]] = relationship(
        back_populates="crag", order_by="Route.number", cascade="all, delete-orphan"
    )
```

`api/topo/models/wall.py`:
```python
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from topo.models.base import Base, SourceMixin, source_constraint

if TYPE_CHECKING:
    from topo.models.crag import Crag
    from topo.models.route import RouteLine


class Wall(SourceMixin, Base):
    __tablename__ = "wall"
    __table_args__ = (
        source_constraint("wall"),
        CheckConstraint("depth_status IN ('pending', 'ready', 'failed')", name="ck_wall_depth_status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    crag_id: Mapped[int] = mapped_column(ForeignKey("crag.id", ondelete="CASCADE"), index=True)
    name: Mapped[str | None] = mapped_column(String(200))
    sort_order: Mapped[int] = mapped_column(default=0, server_default="0")
    version: Mapped[int] = mapped_column(default=1, server_default="1")
    image_original_path: Mapped[str | None] = mapped_column(String(500))
    image_path: Mapped[str | None] = mapped_column(String(500))
    thumb_path: Mapped[str | None] = mapped_column(String(500))
    image_width: Mapped[int | None]
    image_height: Mapped[int | None]
    depth_path: Mapped[str | None] = mapped_column(String(500))
    depth_status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")
    depth_model: Mapped[str | None] = mapped_column(String(64))

    crag: Mapped["Crag"] = relationship(back_populates="walls")
    lines: Mapped[list["RouteLine"]] = relationship(
        back_populates="wall", order_by="RouteLine.sort_order", cascade="all, delete-orphan"
    )
```

`api/topo/models/route.py`:
```python
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from topo.models.base import Base, SourceMixin, source_constraint

if TYPE_CHECKING:
    from topo.models.crag import Crag
    from topo.models.wall import Wall


class Route(SourceMixin, Base):
    __tablename__ = "route"
    __table_args__ = (source_constraint("route"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    crag_id: Mapped[int] = mapped_column(ForeignKey("crag.id", ondelete="CASCADE"), index=True)
    number: Mapped[int | None]
    name: Mapped[str] = mapped_column(String(300))
    grade: Mapped[str | None] = mapped_column(String(32))
    grade_sort: Mapped[int | None] = mapped_column(index=True)
    length_m: Mapped[float | None]
    protection: Mapped[str | None] = mapped_column(String(100))
    first_ascent: Mapped[str | None] = mapped_column(String(300))
    year: Mapped[int | None]
    description: Mapped[str | None] = mapped_column(Text)

    crag: Mapped["Crag"] = relationship(back_populates="routes")


class RouteLine(SourceMixin, Base):
    __tablename__ = "route_line"
    __table_args__ = (source_constraint("route_line"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    wall_id: Mapped[int] = mapped_column(ForeignKey("wall.id", ondelete="CASCADE"), index=True)
    route_id: Mapped[int | None] = mapped_column(ForeignKey("route.id", ondelete="SET NULL"), index=True)
    color: Mapped[str] = mapped_column(String(16), default="#e11d48", server_default="#e11d48")
    sort_order: Mapped[int] = mapped_column(default=0, server_default="0")
    parent_line_id: Mapped[int | None] = mapped_column(ForeignKey("route_line.id", ondelete="SET NULL"))
    parent_point_id: Mapped[int | None] = mapped_column(
        ForeignKey("line_point.id", ondelete="SET NULL", use_alter=True, name="fk_route_line_parent_point_id")
    )

    wall: Mapped["Wall"] = relationship(back_populates="lines")
    route: Mapped["Route | None"] = relationship()
    points: Mapped[list["LinePoint"]] = relationship(
        back_populates="line",
        foreign_keys="LinePoint.line_id",
        order_by="LinePoint.sort_order",
        cascade="all, delete-orphan",
    )


class LinePoint(SourceMixin, Base):
    __tablename__ = "line_point"
    __table_args__ = (
        source_constraint("line_point"),
        CheckConstraint(
            "kind IN ('start', 'ring', 'hak', 'ucho', 'stanowisko', 'przelot')", name="ck_line_point_kind"
        ),
        CheckConstraint("x >= 0 AND x <= 1 AND y >= 0 AND y <= 1", name="ck_line_point_xy"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    line_id: Mapped[int] = mapped_column(ForeignKey("route_line.id", ondelete="CASCADE"), index=True)
    sort_order: Mapped[int]
    x: Mapped[float]
    y: Mapped[float]
    kind: Mapped[str] = mapped_column(String(16))
    visible: Mapped[bool] = mapped_column(default=True, server_default="true")

    line: Mapped["RouteLine"] = relationship(back_populates="points", foreign_keys=[line_id])
```

`api/topo/models/depth_job.py`:
```python
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from topo.models.base import Base


class DepthJob(Base):
    __tablename__ = "depth_job"
    __table_args__ = (
        CheckConstraint("status IN ('queued', 'running', 'done', 'failed')", name="ck_depth_job_status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    wall_id: Mapped[int] = mapped_column(ForeignKey("wall.id", ondelete="CASCADE"), index=True)
    model: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default="queued", server_default="queued", index=True)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

`api/topo/models/__init__.py`:
```python
from topo.models.area import Area
from topo.models.base import Base
from topo.models.crag import Crag
from topo.models.depth_job import DepthJob
from topo.models.route import LinePoint, Route, RouteLine
from topo.models.wall import Wall

__all__ = ["Area", "Base", "Crag", "DepthJob", "LinePoint", "Route", "RouteLine", "Wall"]
```

`api/topo/db.py`:
```python
from collections.abc import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from topo.config import get_settings

engine = create_engine(get_settings().database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


def refresh_area_geom(session: Session) -> None:
    session.execute(text("REFRESH MATERIALIZED VIEW area_geom"))
```

`api/topo/slugs.py` (cały plik):
```python
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
```

- [ ] **Step 4: Alembic i migracja 0001**

`api/alembic.ini`:
```ini
[alembic]
script_location = alembic
prepend_sys_path = .

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
```

`api/alembic/env.py`:
```python
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

from topo.config import get_settings
from topo.models import Base

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def include_object(obj, name, type_, reflected, compare_to):
    # PostGIS's own table is not part of our schema
    return not (type_ == "table" and name == "spatial_ref_sys")


def run_migrations_online() -> None:
    url = config.get_main_option("sqlalchemy.url") or get_settings().database_url
    engine = create_engine(url)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, include_object=include_object)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


run_migrations_online()
```

`api/alembic/script.py.mako`:
```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
"""
from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

`api/alembic/versions/0001_initial.py`:
```python
"""initial schema: areas, crags, walls, routes, lines, points, depth jobs, area_geom view

Revision ID: 0001
Revises:
Create Date: 2026-10-08
"""
import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

AREA_GEOM_SQL = """
CREATE MATERIALIZED VIEW area_geom AS
WITH RECURSIVE tree(root_id, area_id) AS (
    SELECT id, id FROM area
    UNION ALL
    SELECT t.root_id, a.id FROM area a JOIN tree t ON a.parent_id = t.area_id
),
crag_routes AS (
    SELECT c.id, c.area_id, c.location, count(r.id) AS route_count
    FROM crag c
    LEFT JOIN route r ON r.crag_id = c.id
    GROUP BY c.id
)
SELECT t.root_id AS area_id,
       count(cr.id)::int AS crag_count,
       coalesce(sum(cr.route_count), 0)::int AS route_count,
       ST_Centroid(ST_Collect(cr.location)) AS center,
       ST_Buffer(ST_ConvexHull(ST_Collect(cr.location))::geography, 50)::geometry AS hull
FROM tree t
JOIN crag_routes cr ON cr.area_id = t.area_id
GROUP BY t.root_id
"""


def _source_columns() -> list[sa.Column]:
    return [
        sa.Column("source", sa.String(32), nullable=False, server_default="manual"),
        sa.Column("source_id", sa.String(64)),
        sa.Column("source_url", sa.String(1024)),
    ]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    op.create_table(
        "area",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("parent_id", sa.Integer, sa.ForeignKey("area.id", ondelete="RESTRICT")),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(220), nullable=False, unique=True),
        sa.Column("description", sa.Text),
        *_source_columns(),
        sa.CheckConstraint("kind IN ('obszar', 'region', 'sektor')", name="ck_area_kind"),
        sa.UniqueConstraint("source", "source_id", name="uq_area_source"),
    )
    op.create_index("ix_area_parent_id", "area", ["parent_id"])

    op.create_table(
        "crag",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("area_id", sa.Integer, sa.ForeignKey("area.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(220), nullable=False, unique=True),
        sa.Column("location", Geometry("POINT", srid=4326, spatial_index=False), nullable=False),
        sa.Column("rock_type", sa.String(64)),
        sa.Column("height_min", sa.Float),
        sa.Column("height_max", sa.Float),
        sa.Column("aspects", postgresql.ARRAY(sa.String(3)), nullable=False, server_default="{}"),
        sa.Column("formations", postgresql.ARRAY(sa.String(32)), nullable=False, server_default="{}"),
        sa.Column("approach_minutes", sa.Integer),
        sa.Column("description", sa.Text),
        sa.Column("approach_description", sa.Text),
        *_source_columns(),
        sa.UniqueConstraint("source", "source_id", name="uq_crag_source"),
    )
    op.create_index("ix_crag_area_id", "crag", ["area_id"])
    op.create_index("ix_crag_location", "crag", ["location"], postgresql_using="gist")

    op.create_table(
        "wall",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("crag_id", sa.Integer, sa.ForeignKey("crag.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200)),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("image_original_path", sa.String(500)),
        sa.Column("image_path", sa.String(500)),
        sa.Column("thumb_path", sa.String(500)),
        sa.Column("image_width", sa.Integer),
        sa.Column("image_height", sa.Integer),
        sa.Column("depth_path", sa.String(500)),
        sa.Column("depth_status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("depth_model", sa.String(64)),
        *_source_columns(),
        sa.CheckConstraint("depth_status IN ('pending', 'ready', 'failed')", name="ck_wall_depth_status"),
        sa.UniqueConstraint("source", "source_id", name="uq_wall_source"),
    )
    op.create_index("ix_wall_crag_id", "wall", ["crag_id"])

    op.create_table(
        "route",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("crag_id", sa.Integer, sa.ForeignKey("crag.id", ondelete="CASCADE"), nullable=False),
        sa.Column("number", sa.Integer),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("grade", sa.String(32)),
        sa.Column("grade_sort", sa.Integer),
        sa.Column("length_m", sa.Float),
        sa.Column("protection", sa.String(100)),
        sa.Column("first_ascent", sa.String(300)),
        sa.Column("year", sa.Integer),
        sa.Column("description", sa.Text),
        *_source_columns(),
        sa.UniqueConstraint("source", "source_id", name="uq_route_source"),
    )
    op.create_index("ix_route_crag_id", "route", ["crag_id"])
    op.create_index("ix_route_grade_sort", "route", ["grade_sort"])

    op.create_table(
        "route_line",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("wall_id", sa.Integer, sa.ForeignKey("wall.id", ondelete="CASCADE"), nullable=False),
        sa.Column("route_id", sa.Integer, sa.ForeignKey("route.id", ondelete="SET NULL")),
        sa.Column("color", sa.String(16), nullable=False, server_default="#e11d48"),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("parent_line_id", sa.Integer, sa.ForeignKey("route_line.id", ondelete="SET NULL")),
        sa.Column("parent_point_id", sa.Integer),
        *_source_columns(),
        sa.UniqueConstraint("source", "source_id", name="uq_route_line_source"),
    )
    op.create_index("ix_route_line_wall_id", "route_line", ["wall_id"])
    op.create_index("ix_route_line_route_id", "route_line", ["route_id"])

    op.create_table(
        "line_point",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("line_id", sa.Integer, sa.ForeignKey("route_line.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False),
        sa.Column("x", sa.Float, nullable=False),
        sa.Column("y", sa.Float, nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("visible", sa.Boolean, nullable=False, server_default=sa.true()),
        *_source_columns(),
        sa.CheckConstraint(
            "kind IN ('start', 'ring', 'hak', 'ucho', 'stanowisko', 'przelot')", name="ck_line_point_kind"
        ),
        sa.CheckConstraint("x >= 0 AND x <= 1 AND y >= 0 AND y <= 1", name="ck_line_point_xy"),
        sa.UniqueConstraint("source", "source_id", name="uq_line_point_source"),
    )
    op.create_index("ix_line_point_line_id", "line_point", ["line_id"])
    op.create_foreign_key(
        "fk_route_line_parent_point_id", "route_line", "line_point", ["parent_point_id"], ["id"], ondelete="SET NULL"
    )

    op.create_table(
        "depth_job",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("wall_id", sa.Integer, sa.ForeignKey("wall.id", ondelete="CASCADE"), nullable=False),
        sa.Column("model", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
        sa.Column("error", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('queued', 'running', 'done', 'failed')", name="ck_depth_job_status"),
    )
    op.create_index("ix_depth_job_wall_id", "depth_job", ["wall_id"])
    op.create_index("ix_depth_job_status", "depth_job", ["status"])

    op.execute(AREA_GEOM_SQL)
    op.execute("CREATE UNIQUE INDEX ix_area_geom_area_id ON area_geom (area_id)")


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS area_geom")
    op.drop_table("depth_job")
    op.drop_constraint("fk_route_line_parent_point_id", "route_line", type_="foreignkey")
    op.drop_table("line_point")
    op.drop_table("route_line")
    op.drop_table("route")
    op.drop_table("wall")
    op.drop_table("crag")
    op.drop_table("area")
```

W `docker-compose.yml` zmień komendę serwisu `api`, żeby migracje szły przy starcie:
```yaml
    command: ["sh", "-c", "alembic upgrade head && uvicorn topo.main:app --host 0.0.0.0 --port 8000 --reload"]
```

- [ ] **Step 5: Uruchom testy i sprawdź migrację na bazie dev**

Run: `docker compose run --rm api pytest -v`
Expected: wszystkie PASS (health, grades, slugs, models).

Run:
```powershell
docker compose run --rm api alembic upgrade head
docker compose run --rm api alembic downgrade base
docker compose run --rm api alembic upgrade head
docker compose exec db psql -U topo -c "\dt" -c "\dm"
```
Expected: migracja w górę, w dół i znów w górę bez błędów; tabele `area, crag, wall, route, route_line, line_point, depth_job, alembic_version` i widok zmaterializowany `area_geom`.

- [ ] **Step 6: Commit**

```powershell
git add api docker-compose.yml
git commit -m "feat: model danych, migracja 0001 i widok area_geom" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Format błędów i API mapy

**Files:**
- Create: `api/topo/api/errors.py`, `api/topo/api/map.py`, `api/topo/queries.py`
- Modify: `api/topo/api/app.py` (cały plik poniżej)
- Test: `api/tests/test_api_map.py`

**Interfaces:**
- Consumes: modele, `get_session`, `refresh_area_geom` (Task 3), `BAND_LIMITS` (Task 2).
- Produces:
  - `topo.api.errors.ApiError(status: int, code: str, message: str)`, `not_found(what: str) -> ApiError` (komunikat `"Nie znaleziono: {what}"`), `install_error_handlers(app: FastAPI) -> None`
  - `topo.queries.crag_summaries(session: Session, area_id: int | None = None) -> list[dict]` — klucze: `id, name, slug, area_id, in_sector, lng, lat, route_count, grade_bands: [int, int, int, int]`
  - `GET /api/map/areas?kind=obszar|region|sektor&geometry=center|hull` → GeoJSON FeatureCollection; `properties`: `id, name, slug, kind, parent_id, crag_count, route_count, center: [lng, lat], bbox: [minx, miny, maxx, maxy]`
  - `GET /api/map/crags` → GeoJSON FeatureCollection punktów; `properties`: `id, name, slug, area_id, in_sector, route_count, grade_bands`
  - Błędy: 404 `{"code": "not_found", ...}`, 422 `{"code": "validation_error", "message": "Nieprawidłowe dane w zapytaniu", "details": [...]}`

- [ ] **Step 1: Testy**

`api/tests/test_api_map.py`:
```python
import pytest

from tests import factories as f
from topo.db import refresh_area_geom


def seed(session):
    jura = f.area(session, "Jura Krakowsko-Częstochowska", kind="obszar")
    region = f.area(session, "Dolina Kobylańska", parent=jura)
    sektor = f.area(session, "Grupa Żabiego Konia", kind="sektor", parent=region)
    zabi = f.crag(session, sektor, "Żabi Koń", lng=19.756, lat=50.156)
    for name, grade in [("A", "V+"), ("B", "VI.1"), ("C", "VI.5"), ("D", None)]:
        f.route(session, zabi, name, grade=grade)
    lone = f.crag(session, region, "Samotna", lng=19.76, lat=50.16)
    f.route(session, lone, "E", grade="IV")
    f.area(session, "Pusty", kind="sektor", parent=region)
    refresh_area_geom(session)


def test_map_regions_as_center_points(client, session):
    seed(session)
    data = client.get("/api/map/areas", params={"kind": "region"}).json()

    assert data["type"] == "FeatureCollection"
    [feature] = data["features"]
    assert feature["geometry"]["type"] == "Point"
    props = feature["properties"]
    assert props["name"] == "Dolina Kobylańska"
    assert (props["crag_count"], props["route_count"]) == (2, 5)
    minx, miny, maxx, maxy = props["bbox"]
    assert minx < 19.756 < maxx and miny < 50.156 < maxy
    assert props["center"] == pytest.approx(feature["geometry"]["coordinates"])


def test_map_sectors_as_hulls_skip_empty(client, session):
    seed(session)
    data = client.get("/api/map/areas", params={"kind": "sektor", "geometry": "hull"}).json()

    assert [feat["properties"]["name"] for feat in data["features"]] == ["Grupa Żabiego Konia"]
    assert data["features"][0]["geometry"]["type"] == "Polygon"


def test_map_crags_with_grade_bands(client, session):
    seed(session)
    data = client.get("/api/map/crags").json()
    by_name = {feat["properties"]["name"]: feat for feat in data["features"]}

    zabi = by_name["Żabi Koń"]
    assert zabi["geometry"]["coordinates"] == pytest.approx([19.756, 50.156])
    assert zabi["properties"]["route_count"] == 4
    assert zabi["properties"]["grade_bands"] == [1, 1, 0, 1]
    assert zabi["properties"]["in_sector"] is True
    assert by_name["Samotna"]["properties"]["in_sector"] is False


def test_map_areas_rejects_unknown_kind(client):
    response = client.get("/api/map/areas", params={"kind": "dolina"})
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "validation_error"
    assert body["message"] == "Nieprawidłowe dane w zapytaniu"


def test_unknown_api_path_uses_error_format(client):
    response = client.get("/api/nie-ma-takiej-strony")
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
```

- [ ] **Step 2: Implementacja**

`api/topo/api/errors.py`:
```python
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def not_found(what: str) -> ApiError:
    return ApiError(404, "not_found", f"Nie znaleziono: {what}")


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse({"code": exc.code, "message": exc.message}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def handle_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            {
                "code": "validation_error",
                "message": "Nieprawidłowe dane w zapytaniu",
                "details": jsonable_encoder(exc.errors()),
            },
            status_code=422,
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 404:
            return JSONResponse({"code": "not_found", "message": "Nie znaleziono"}, status_code=404)
        return JSONResponse({"code": "http_error", "message": str(exc.detail)}, status_code=exc.status_code)
```

`api/topo/queries.py`:
```python
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from topo.grades import BAND_LIMITS


def crag_summaries(session: Session, area_id: int | None = None) -> list[dict[str, Any]]:
    """Crags with route counts and route counts per grade band (see topo.grades.grade_band)."""
    b1, b2, b3 = BAND_LIMITS
    params: dict[str, Any] = {"b1": b1, "b2": b2, "b3": b3}
    where = ""
    if area_id is not None:
        where = "WHERE c.area_id = :area_id"
        params["area_id"] = area_id
    rows = session.execute(
        text(f"""
            SELECT c.id, c.name, c.slug, c.area_id, a.kind = 'sektor' AS in_sector,
                   ST_X(c.location) AS lng, ST_Y(c.location) AS lat,
                   count(r.id)::int AS route_count,
                   count(r.id) FILTER (WHERE r.grade_sort < :b1)::int AS band0,
                   count(r.id) FILTER (WHERE r.grade_sort >= :b1 AND r.grade_sort < :b2)::int AS band1,
                   count(r.id) FILTER (WHERE r.grade_sort >= :b2 AND r.grade_sort < :b3)::int AS band2,
                   count(r.id) FILTER (WHERE r.grade_sort >= :b3)::int AS band3
            FROM crag c
            JOIN area a ON a.id = c.area_id
            LEFT JOIN route r ON r.crag_id = c.id
            {where}
            GROUP BY c.id, a.kind
            ORDER BY c.name
        """),
        params,
    ).mappings()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "slug": r["slug"],
            "area_id": r["area_id"],
            "in_sector": r["in_sector"],
            "lng": r["lng"],
            "lat": r["lat"],
            "route_count": r["route_count"],
            "grade_bands": [r["band0"], r["band1"], r["band2"], r["band3"]],
        }
        for r in rows
    ]
```

`api/topo/api/map.py`:
```python
from typing import Any, Literal

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from topo.db import get_session
from topo.queries import crag_summaries

router = APIRouter(tags=["map"])

_AREA_GEOMETRY = {"center": "g.center", "hull": "g.hull"}


def _feature(geometry: dict[str, Any], properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "Feature", "geometry": geometry, "properties": properties}


def _collection(features: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "FeatureCollection", "features": features}


@router.get("/areas")
def map_areas(
    kind: Literal["obszar", "region", "sektor"],
    geometry: Literal["center", "hull"] = "center",
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    rows = session.execute(
        text(f"""
            SELECT a.id, a.name, a.slug, a.kind, a.parent_id, g.crag_count, g.route_count,
                   ST_AsGeoJSON({_AREA_GEOMETRY[geometry]}, 6)::json AS geom,
                   ST_X(g.center) AS lng, ST_Y(g.center) AS lat,
                   ST_XMin(g.hull) AS xmin, ST_YMin(g.hull) AS ymin,
                   ST_XMax(g.hull) AS xmax, ST_YMax(g.hull) AS ymax
            FROM area a
            JOIN area_geom g ON g.area_id = a.id
            WHERE a.kind = :kind
            ORDER BY a.name
        """),
        {"kind": kind},
    ).mappings()
    return _collection(
        [
            _feature(
                r["geom"],
                {
                    "id": r["id"],
                    "name": r["name"],
                    "slug": r["slug"],
                    "kind": r["kind"],
                    "parent_id": r["parent_id"],
                    "crag_count": r["crag_count"],
                    "route_count": r["route_count"],
                    "center": [round(r["lng"], 6), round(r["lat"], 6)],
                    "bbox": [r["xmin"], r["ymin"], r["xmax"], r["ymax"]],
                },
            )
            for r in rows
        ]
    )


@router.get("/crags")
def map_crags(session: Session = Depends(get_session)) -> dict[str, Any]:
    return _collection(
        [
            _feature(
                {"type": "Point", "coordinates": [round(c["lng"], 6), round(c["lat"], 6)]},
                {key: c[key] for key in ("id", "name", "slug", "area_id", "in_sector", "route_count", "grade_bands")},
            )
            for c in crag_summaries(session)
        ]
    )
```

`api/topo/api/app.py` (cały plik):
```python
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from topo.api import map as map_api
from topo.api.errors import install_error_handlers
from topo.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Topo API")
    install_error_handlers(app)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(map_api.router, prefix="/api/map")
    app.mount(settings.media_url, StaticFiles(directory=settings.media_root, check_dir=False), name="media")
    return app
```

- [ ] **Step 3: Uruchom testy**

Run: `docker compose run --rm api pytest -v`
Expected: wszystkie PASS.

- [ ] **Step 4: Commit**

```powershell
git add api
git commit -m "feat: API mapy (obszary, skały) i wspólny format błędów" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: API szczegółów obszaru i skały

**Files:**
- Create: `api/topo/schemas.py`, `api/topo/api/common.py`, `api/topo/api/areas.py`, `api/topo/api/crags.py`
- Modify: `api/topo/api/app.py` (cały plik poniżej)
- Test: `api/tests/test_api_crags.py`, `api/tests/test_api_areas.py`

**Interfaces:**
- Consumes: modele (Task 3), `crag_summaries`, `not_found` (Task 4), `to_french` (Task 2), `get_settings().media_url` (Task 1).
- Produces:
  - `topo.api.common.media_url(path: str | None) -> str | None`, `area_path(area: Area | None) -> list[AreaRef]` (od korzenia do `area` włącznie)
  - Schematy w `topo.schemas`: `AreaRef, PointOut, LineOut, WallOut, RouteOut, CragOut, CragSummary, AreaChild, AreaOut` (pola poniżej)
  - `GET /api/crags/{slug}` → `CragOut`; `GET /api/areas/{slug}` → `AreaOut`
  - `WallOut.depth_url` jest `null`, dopóki `depth_status != "ready"`

- [ ] **Step 1: Testy**

`api/tests/test_api_crags.py`:
```python
import pytest

from tests import factories as f


def make_crag(session):
    jura = f.area(session, "Jura Krakowsko-Częstochowska", kind="obszar")
    region = f.area(session, "Dolina Kobylańska", parent=jura)
    sektor = f.area(session, "Grupa Żabiego Konia", kind="sektor", parent=region)
    return f.crag(
        session, sektor, "Żabi Koń", lng=19.75617, lat=50.15599,
        rock_type="wapień", aspects=["W", "NW"], height_min=10, height_max=40, approach_minutes=10,
        source="portalgorski", source_id="111", source_url="https://topo.portalgorski.pl/x,skala,111",
    )


def test_crag_detail_full(client, session):
    crag = make_crag(session)
    kant = f.route(session, crag, "Lewy kant Żabiego Konia", grade="V+", number=1, protection="9r + ST")
    wall = f.wall(
        session, crag, name="Żabi Koń",
        image_path="walls/1/display.webp", thumb_path="walls/1/thumb.webp",
        image_width=1063, image_height=1600, depth_path="walls/1/depth.png", depth_status="ready",
    )
    main = f.line(session, wall, route=kant, sort_order=1)
    f.line(
        session, wall, route=None, sort_order=2,
        parent_line_id=main.id, parent_point_id=main.points[1].id,
        points=((0.5, 0.5, "start"), (0.6, 0.3, "stanowisko")),
    )

    response = client.get(f"/api/crags/{crag.slug}")
    assert response.status_code == 200
    body = response.json()

    assert [p["name"] for p in body["path"]] == [
        "Jura Krakowsko-Częstochowska", "Dolina Kobylańska", "Grupa Żabiego Konia",
    ]
    assert (body["lng"], body["lat"]) == pytest.approx((19.75617, 50.15599))
    assert body["aspects"] == ["W", "NW"]
    assert body["source_url"] == "https://topo.portalgorski.pl/x,skala,111"

    [wall_out] = body["walls"]
    assert wall_out["image_url"] == "/media/walls/1/display.webp"
    assert wall_out["thumb_url"] == "/media/walls/1/thumb.webp"
    assert wall_out["depth_url"] == "/media/walls/1/depth.png"
    first, variant = wall_out["lines"]
    assert first["route_id"] == kant.id
    assert [p["kind"] for p in first["points"]] == ["start", "ring", "stanowisko"]
    assert first["points"][0]["visible"] is False
    assert variant["route_id"] is None
    assert variant["parent_point_id"] == first["points"][1]["id"]

    [route_out] = body["routes"]
    assert route_out["grade"] == "V+"
    assert route_out["grade_fr"] == "5b"
    assert route_out["protection"] == "9r + ST"


def test_crag_without_photos(client, session):
    crag = make_crag(session)
    f.wall(session, crag, name="Nowa ściana")

    [wall_out] = client.get(f"/api/crags/{crag.slug}").json()["walls"]
    assert wall_out["image_url"] is None
    assert wall_out["thumb_url"] is None
    assert wall_out["depth_url"] is None
    assert wall_out["depth_status"] == "pending"
    assert wall_out["lines"] == []


def test_depth_url_hidden_until_ready(client, session):
    crag = make_crag(session)
    f.wall(session, crag, image_path="walls/2/display.webp", depth_path="walls/2/depth.png", depth_status="failed")

    [wall_out] = client.get(f"/api/crags/{crag.slug}").json()["walls"]
    assert wall_out["depth_url"] is None


def test_crag_not_found(client):
    response = client.get("/api/crags/nie-ma")
    assert response.status_code == 404
    assert response.json() == {"code": "not_found", "message": "Nie znaleziono: skała"}
```

`api/tests/test_api_areas.py`:
```python
from tests import factories as f
from topo.db import refresh_area_geom


def seed(session):
    jura = f.area(session, "Jura Krakowsko-Częstochowska", kind="obszar")
    region = f.area(session, "Dolina Kobylańska", parent=jura)
    sektor = f.area(session, "Grupa Żabiego Konia", kind="sektor", parent=region)
    zabi = f.crag(session, sektor, "Żabi Koń", lng=19.756, lat=50.156)
    f.route(session, zabi, "A", grade="VI.2")
    lone = f.crag(session, region, "Samotna", lng=19.76, lat=50.16)
    f.route(session, lone, "B", grade="IV")
    f.route(session, lone, "C", grade="VI.5")
    empty = f.area(session, "Pusty", kind="sektor", parent=region)
    refresh_area_geom(session)
    return region, empty


def test_area_detail(client, session):
    region, _ = seed(session)
    body = client.get(f"/api/areas/{region.slug}").json()

    assert body["kind"] == "region"
    assert [p["name"] for p in body["path"]] == ["Jura Krakowsko-Częstochowska"]
    children = {c["name"]: c for c in body["children"]}
    assert (children["Grupa Żabiego Konia"]["crag_count"], children["Grupa Żabiego Konia"]["route_count"]) == (1, 1)
    assert (children["Pusty"]["crag_count"], children["Pusty"]["route_count"]) == (0, 0)
    [crag] = body["crags"]
    assert crag["name"] == "Samotna"
    assert crag["route_count"] == 2
    assert crag["grade_bands"] == [1, 0, 0, 1]
    assert len(body["center"]) == 2
    assert len(body["bbox"]) == 4


def test_empty_area_detail_has_no_geometry(client, session):
    _, empty = seed(session)
    body = client.get(f"/api/areas/{empty.slug}").json()

    assert body["center"] is None
    assert body["bbox"] is None
    assert body["crags"] == []
    assert [p["name"] for p in body["path"]] == ["Jura Krakowsko-Częstochowska", "Dolina Kobylańska"]


def test_area_not_found(client):
    response = client.get("/api/areas/nie-ma")
    assert response.status_code == 404
    assert response.json()["message"] == "Nie znaleziono: obszar"
```

- [ ] **Step 2: Implementacja**

`api/topo/schemas.py`:
```python
from pydantic import BaseModel, ConfigDict


class AreaRef(BaseModel):
    id: int
    name: str
    slug: str
    kind: str


class PointOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sort_order: int
    x: float
    y: float
    kind: str
    visible: bool


class LineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    route_id: int | None
    color: str
    sort_order: int
    parent_line_id: int | None
    parent_point_id: int | None
    points: list[PointOut]


class WallOut(BaseModel):
    id: int
    name: str | None
    sort_order: int
    version: int
    image_url: str | None
    thumb_url: str | None
    image_width: int | None
    image_height: int | None
    depth_url: str | None
    depth_status: str
    depth_model: str | None
    lines: list[LineOut]


class RouteOut(BaseModel):
    id: int
    number: int | None
    name: str
    grade: str | None
    grade_fr: str | None
    grade_sort: int | None
    length_m: float | None
    protection: str | None
    first_ascent: str | None
    year: int | None
    description: str | None


class CragOut(BaseModel):
    id: int
    name: str
    slug: str
    path: list[AreaRef]
    lng: float
    lat: float
    rock_type: str | None
    height_min: float | None
    height_max: float | None
    aspects: list[str]
    formations: list[str]
    approach_minutes: int | None
    description: str | None
    approach_description: str | None
    source: str
    source_url: str | None
    walls: list[WallOut]
    routes: list[RouteOut]


class CragSummary(BaseModel):
    id: int
    name: str
    slug: str
    route_count: int
    grade_bands: list[int]


class AreaChild(BaseModel):
    id: int
    name: str
    slug: str
    kind: str
    crag_count: int
    route_count: int


class AreaOut(BaseModel):
    id: int
    name: str
    slug: str
    kind: str
    description: str | None
    path: list[AreaRef]
    children: list[AreaChild]
    crags: list[CragSummary]
    center: list[float] | None
    bbox: list[float] | None
```

`api/topo/api/common.py`:
```python
from topo.config import get_settings
from topo.models import Area
from topo.schemas import AreaRef


def media_url(path: str | None) -> str | None:
    if not path:
        return None
    return f"{get_settings().media_url.rstrip('/')}/{path}"


def area_path(area: Area | None) -> list[AreaRef]:
    """Breadcrumbs from the top-level area down to (and including) `area`."""
    chain: list[AreaRef] = []
    while area is not None:
        chain.append(AreaRef(id=area.id, name=area.name, slug=area.slug, kind=area.kind))
        area = area.parent
    return list(reversed(chain))
```

`api/topo/api/crags.py`:
```python
from fastapi import APIRouter, Depends
from geoalchemy2.shape import to_shape
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from topo.api.common import area_path, media_url
from topo.api.errors import not_found
from topo.db import get_session
from topo.grades import to_french
from topo.models import Crag, Route, RouteLine, Wall
from topo.schemas import CragOut, LineOut, RouteOut, WallOut

router = APIRouter(tags=["crags"])


def _wall_out(wall: Wall) -> WallOut:
    return WallOut(
        id=wall.id,
        name=wall.name,
        sort_order=wall.sort_order,
        version=wall.version,
        image_url=media_url(wall.image_path),
        thumb_url=media_url(wall.thumb_path),
        image_width=wall.image_width,
        image_height=wall.image_height,
        depth_url=media_url(wall.depth_path) if wall.depth_status == "ready" else None,
        depth_status=wall.depth_status,
        depth_model=wall.depth_model,
        lines=[LineOut.model_validate(line) for line in wall.lines],
    )


def _route_out(route: Route) -> RouteOut:
    return RouteOut(
        id=route.id,
        number=route.number,
        name=route.name,
        grade=route.grade,
        grade_fr=to_french(route.grade),
        grade_sort=route.grade_sort,
        length_m=route.length_m,
        protection=route.protection,
        first_ascent=route.first_ascent,
        year=route.year,
        description=route.description,
    )


@router.get("/{slug}", response_model=CragOut)
def get_crag(slug: str, session: Session = Depends(get_session)) -> CragOut:
    crag = session.scalar(
        select(Crag)
        .where(Crag.slug == slug)
        .options(
            selectinload(Crag.walls).selectinload(Wall.lines).selectinload(RouteLine.points),
            selectinload(Crag.routes),
        )
    )
    if crag is None:
        raise not_found("skała")
    point = to_shape(crag.location)
    return CragOut(
        id=crag.id,
        name=crag.name,
        slug=crag.slug,
        path=area_path(crag.area),
        lng=point.x,
        lat=point.y,
        rock_type=crag.rock_type,
        height_min=crag.height_min,
        height_max=crag.height_max,
        aspects=crag.aspects,
        formations=crag.formations,
        approach_minutes=crag.approach_minutes,
        description=crag.description,
        approach_description=crag.approach_description,
        source=crag.source,
        source_url=crag.source_url,
        walls=[_wall_out(wall) for wall in crag.walls],
        routes=[_route_out(route) for route in crag.routes],
    )
```

`api/topo/api/areas.py`:
```python
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select, text
from sqlalchemy.orm import Session, selectinload

from topo.api.common import area_path
from topo.api.errors import not_found
from topo.db import get_session
from topo.models import Area
from topo.queries import crag_summaries
from topo.schemas import AreaChild, AreaOut, CragSummary

router = APIRouter(tags=["areas"])


def _area_stats(session: Session, ids: list[int]) -> dict[int, dict[str, Any]]:
    rows = session.execute(
        text("""
            SELECT area_id, crag_count, route_count,
                   ST_X(center) AS lng, ST_Y(center) AS lat,
                   ST_XMin(hull) AS xmin, ST_YMin(hull) AS ymin,
                   ST_XMax(hull) AS xmax, ST_YMax(hull) AS ymax
            FROM area_geom
            WHERE area_id = ANY(:ids)
        """),
        {"ids": ids},
    ).mappings()
    return {
        r["area_id"]: {
            "crag_count": r["crag_count"],
            "route_count": r["route_count"],
            "center": [r["lng"], r["lat"]],
            "bbox": [r["xmin"], r["ymin"], r["xmax"], r["ymax"]],
        }
        for r in rows
    }


@router.get("/{slug}", response_model=AreaOut)
def get_area(slug: str, session: Session = Depends(get_session)) -> AreaOut:
    area = session.scalar(select(Area).where(Area.slug == slug).options(selectinload(Area.children)))
    if area is None:
        raise not_found("obszar")
    stats = _area_stats(session, [area.id, *(child.id for child in area.children)])
    own = stats.get(area.id)
    return AreaOut(
        id=area.id,
        name=area.name,
        slug=area.slug,
        kind=area.kind,
        description=area.description,
        path=area_path(area.parent),
        children=[
            AreaChild(
                id=child.id,
                name=child.name,
                slug=child.slug,
                kind=child.kind,
                crag_count=stats.get(child.id, {}).get("crag_count", 0),
                route_count=stats.get(child.id, {}).get("route_count", 0),
            )
            for child in area.children
        ],
        crags=[CragSummary(**summary) for summary in crag_summaries(session, area.id)],
        center=own["center"] if own else None,
        bbox=own["bbox"] if own else None,
    )
```

`api/topo/api/app.py` (cały plik):
```python
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from topo.api import areas as areas_api
from topo.api import crags as crags_api
from topo.api import map as map_api
from topo.api.errors import install_error_handlers
from topo.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Topo API")
    install_error_handlers(app)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(map_api.router, prefix="/api/map")
    app.include_router(areas_api.router, prefix="/api/areas")
    app.include_router(crags_api.router, prefix="/api/crags")
    app.mount(settings.media_url, StaticFiles(directory=settings.media_root, check_dir=False), name="media")
    return app
```

- [ ] **Step 3: Uruchom cały zestaw testów i sprawdź ręcznie**

Run: `docker compose run --rm api pytest -v`
Expected: wszystkie PASS.

Ręczny dymny test na bazie dev:
```powershell
docker compose up -d api
docker compose exec db psql -U topo -d topo -c "INSERT INTO area (kind, name, slug) VALUES ('region', 'Test', 'test'); INSERT INTO crag (area_id, name, slug, location) SELECT id, 'Skała testowa', 'skala-testowa', ST_SetSRID(ST_MakePoint(19.75, 50.15), 4326) FROM area WHERE slug = 'test'; REFRESH MATERIALIZED VIEW area_geom;"
curl.exe "http://localhost:8000/api/map/areas?kind=region"
curl.exe http://localhost:8000/api/crags/skala-testowa
curl.exe http://localhost:8000/api/areas/test
docker compose exec db psql -U topo -d topo -c "DELETE FROM crag WHERE slug = 'skala-testowa'; DELETE FROM area WHERE slug = 'test'; REFRESH MATERIALIZED VIEW area_geom;"
```
Expected: poprawne JSON-y z obszarem „Test” i skałą; dokumentacja na http://localhost:8000/docs pokazuje 5 endpointów `/api/...`.

- [ ] **Step 4: Commit**

```powershell
git add api
git commit -m "feat: API szczegółów obszaru i skały" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Po zakończeniu planu 1

- Wszystkie testy przechodzą: `docker compose run --rm api pytest`.
- API odczytu zwraca dane w kształcie, którego potrzebuje importer (plan 2) i front (plany 3–4).
- Odchylenie od specu: testy używają bazy `topo_test` w kontenerze `db` z compose zamiast testcontainers (backend działa w kontenerze, więc testcontainers wymagałby montowania gniazda Dockera; efekt jest ten sam — prawdziwy PostGIS).
- Następny krok: plan 2 (importer Portalu Górskiego), pisany po zakończeniu planu 1.
