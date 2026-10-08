# Plan 2: historia zmian i importer Portalu Górskiego — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Włączyć historię zmian (SQLAlchemy-Continuum) i zaimportować do bazy skały, ściany, zdjęcia, drogi i linie z wpinkami z topo.portalgorski.pl — powtarzalnie, z cache i bez nadpisywania ręcznych poprawek.

**Architecture:** Historia: Continuum wersjonuje 6 tabel treści, a tabela `transaction` ma kolumny `author` i `comment` wypełniane z `session.info`. Importer to pakiet `topo.importer` z czterema niezależnymi warstwami: pobieranie z cache (`fetch.py`), czyste parsery stron i JSON-ów (`portalgorski/parse.py`), zapis zdjęć (`topo/media.py`) i zapis do bazy z upsertami (`portalgorski/store.py`). Orkiestracja (`portalgorski/run.py`) i komendy CLI (`topo/cli.py`, Typer). Każda skała zapisywana w osobnej transakcji podpisanej `import:portalgorski`.

**Tech Stack:** SQLAlchemy-Continuum 1.8, httpx, selectolax, Pillow, Typer; reszta jak w planie 1.

**Spec:** `docs/superpowers/specs/2026-10-08-topo-design.md` (§2.1, §4, §7, §8, §10)

## Zebrane fakty o Portalu Górskim (sprawdzone 2026-10-08)

- `GET /topo/json/start` → `{"results": [{lat, lng, title, description, type: "rock", url, img}, ...]}`: 638 wpisów, 635 z poprawnym adresem `…,skala,<id>`; 3 mają w adresie dosłownie `([0-9]+)` zamiast id — pomijamy i raportujemy.
- Strona skały (`url` z listy): `#treeMenu ul.tree li.leafmenu a` to ścieżka obszar → [region] → [sektor] → skała; rodzaj i id w końcówce adresu `,(obszar|region|sektor|skala),<id>`. W Beskidach skała wisi bezpośrednio pod obszarem.
- `table.tblData tr`: ikona `div.itemIcon <kod>` + wartość w drugiej komórce. Kody: `pGPS` (w `span.dataSm` „lat , lng”), `pRT` rodzaj skały, `pR` liczba dróg, `pH` „min. 10.00m - max. 40.00m”, `pWF` wystawa (obrazki z `alt` = W, NW…), `pRF` formacje rozdzielone `&nbsp;`, `pT` „10 min”, `pCF` przyjazna dzieciom TAK/NIE, `pRL` otoczenie.
- Opis skały: `div.box` z `<h3>Opis i dojście</h3>` i `<span class="desc">` (HTML z encjami; często pusty).
- Ściany: `<h5>nazwa</h5><div><div class="description darker">opis</div><div><div class="topoEditor…" id="topoEditor_<id>">`, a zdjęcie w skrypcie `new TopoEditorFactory({ id:<id>, imageMain: '/images/original/…' })`.
- `POST /topo/topoEditor/loadPaths` z `imageId=<id>&pathId=0` → `{"status":1, "data":[path…], "pathsListBottom": "<table…>"}`.
  - path: `pathId`, `order` (numer drogi na topo), `branchOrder` (>0 = wariant), `color`, `parentPathId` (wariant), `points[]`.
  - punkt: `pointId`, `x`, `y` **w pikselach oryginalnego zdjęcia** (sprawdzone na 7 ścianach: zawsze mieszczą się w wymiarach obrazka), `typeId` (1 = punkt pomocniczy/niewidoczny, 2 = wpinka), `kindName` (`ring`, ` hak`, `ucho skalne`, `stanowisko zjazdowe`, `dwa ringi zjazdowe`, `ogranicznik`), `parentPointId` (pierwszy punkt wariantu).
  - `pathsListBottom`: wiersze `tr.pathLiBottom#pathLiBottom_<pathId>` z kolumnami: numer („1.” lub „a)” dla wariantu), nazwa, asekuracja („9r + ST”), wycena, rating, autor, rok, długość („25 m”).
- Zdjęcia: JPEG ~1600 px na dłuższym boku, ~1–1,5 MB.

## Global Constraints

- Python **3.12**, obraz `ghcr.io/astral-sh/uv:python3.12-bookworm-slim`, baza `postgis/postgis:16-3.4`.
- Współrzędne punktów `x`, `y` w zakresie **0–1** względem zdjęcia (ograniczenie w bazie).
- Tabele treści mają `source`, `source_id`, `source_url`, unikalne `(source, source_id)`. Importer używa `source = "portalgorski"`; `source_id` obszaru to `"<rodzaj>:<id>"` (np. `"region:100"`), skały/ściany/drogi/linii/punktu — samo id jako tekst.
- Typy punktów (`line_point.kind`): `start, ring, hak, ucho, stanowisko, ogranicznik, przelot` (`ogranicznik` dodawany w tym planie).
- Transakcje importu podpisane autorem **`import:portalgorski`**; każda zmiana z autorem spoza prefiksu `import:` (albo bez autora) to „ręczna zmiana”, której import nie nadpisuje.
- Grzeczne pobieranie: domyślnie **1,5 s** przerwy między zapytaniami, 3 próby z rosnącą przerwą, nagłówek User-Agent projektu; surowe odpowiedzi w cache na dysku (`/data/cache/portalgorski`, na hoście `./cache/`).
- Pliki ścian: `media/walls/<wall_id>/original.<ext>`, `display.webp` (≤1600 px, q80), `thumb.webp` (≤400 px, q75); na hoście `./media/` (bind mount, żeby dało się zrobić rsync na serwer).
- Komunikaty dla użytkownika i raport importu po polsku.
- **Zasada testów:** testy pisane razem z kodem, uruchamiane raz na końcu zadania.
- Komendy uruchamiane z katalogu repo: `docker compose run --rm api …`. Na hoście nie ma Pythona 3.12.

## Review Focus

1. **Ponowny import po ręcznej poprawce znajomego** — poprawka zostaje, raport wymienia pominięty rekord. Test: Task 5 `test_reimport_keeps_manual_route_edit`.
2. **Ponowny import bez zmian w źródle** — brak duplikatów, te same slugi i ID, brak nowych wersji w historii. Test: Task 6 `test_reimport_is_idempotent`.
3. **Linie, których punkty wychodzą poza zdjęcie** (inna skala niż zakładana) — linia pominięta z wpisem w raporcie, reszta ściany zaimportowana. Test: Task 5 `test_line_outside_image_is_skipped`.
4. **Błąd sieci przy jednej skale** — import idzie dalej, błąd jest w raporcie, ponowne uruchomienie korzysta z cache. Testy: Task 2 (ponawianie, cache), Task 6 `test_fetch_error_for_one_rock_does_not_stop_import`.
5. **Nieznana wycena lub typ punktu** — droga zapisana z `grade_sort = NULL`, punkt jako `przelot`, oba przypadki w raporcie. Test: Task 5 `test_unknown_grade_and_point_kind_are_reported`.

---

## Struktura plików

```
api/
├── pyproject.toml                 + zależności, skrypt `topo`
├── alembic/env.py                 + geoalchemy2.alembic_helpers
├── alembic/versions/0002_historia.py           (autogenerate) transaction + *_version
├── alembic/versions/0003_dane_portalu.py       (autogenerate) nowe kolumny, typ „ogranicznik”
├── topo/
│   ├── history.py                 enable_versioning, set_author, is_manually_edited
│   ├── media.py                   store_wall_image, StoredImage, InvalidImage
│   ├── cli.py                     Typer: `topo import portalgorski`, `topo draw-wall`
│   ├── config.py                  + cache_dir
│   ├── models/…                   + __versioned__, nowe kolumny
│   ├── schemas.py, api/crags.py   + nowe pola w odpowiedzi skały
│   └── importer/
│       ├── __init__.py
│       ├── fetch.py               CachedFetcher, FetchError, CacheMiss
│       ├── preview.py             render_wall_preview (podgląd linii na zdjęciu)
│       └── portalgorski/
│           ├── __init__.py
│           ├── types.py           dataclassy wyników parsowania
│           ├── parse.py           parse_start, parse_rock_page, parse_paths, map_point
│           ├── store.py           store_rock, ImportReport, WallInput
│           └── run.py             import_portalgorski, format_report
└── tests/
    ├── fixtures/portalgorski/     start.json, skala111.html, skala955.html, paths46.json, paths2533.json
    ├── test_history.py, test_fetch.py, test_parse_portalgorski.py, test_media.py
    ├── test_store_portalgorski.py, test_import_run.py, test_cli.py
docker-compose.yml                 + ./cache i ./media jako bind mount
```

---

### Task 1: Zależności i historia zmian (SQLAlchemy-Continuum)

**Files:**
- Modify: `api/pyproject.toml`, `api/uv.lock` (regenerowany), `api/alembic/env.py`, `api/topo/models/base.py`, `api/topo/models/__init__.py`, `api/topo/models/area.py`, `api/topo/models/crag.py`, `api/topo/models/wall.py`, `api/topo/models/route.py`
- Create: `api/topo/history.py`, `api/alembic/versions/0002_historia.py` (autogenerate)
- Test: `api/tests/test_history.py`

**Interfaces:**
- Produces:
  - `topo.history.IMPORT_AUTHOR_PREFIX = "import:"`
  - `topo.history.enable_versioning() -> None` (wołane raz, przed definicją modeli)
  - `topo.history.set_author(session: Session, author: str, comment: str | None = None) -> None`
  - `topo.history.transaction_class() -> type` (klasa ORM tabeli `transaction`: `id`, `issued_at`, `author`, `comment`)
  - `topo.history.is_manually_edited(session: Session, model: type, ids: Iterable[int]) -> bool`
  - `sqlalchemy_continuum.version_class(Model)` działa dla `Area, Crag, Wall, Route, RouteLine, LinePoint`
  - Zależności zainstalowane dla całego planu: `sqlalchemy-continuum`, `httpx`, `selectolax`, `pillow`, `typer`; skrypt `topo` w kontenerze.

- [ ] **Step 1: Zależności**

W `api/pyproject.toml`:
- do `[project] dependencies` dopisz:
```toml
    "sqlalchemy-continuum>=1.8",
    "httpx>=0.27",
    "selectolax>=0.3.21",
    "pillow>=10.4",
    "typer>=0.12",
```
- usuń `"httpx>=0.27"` z grupy `dev` (jest już w głównych),
- dodaj sekcję:
```toml
[project.scripts]
topo = "topo.cli:app"
```

Utwórz tymczasowy `api/topo/cli.py` (pełna wersja w Task 6), żeby skrypt się instalował:
```python
import typer

app = typer.Typer(help="Narzędzia projektu Topo", no_args_is_help=True)
```

Potem (PowerShell, katalog repo):
```powershell
docker run --rm -v "${PWD}/api:/app" -w /app ghcr.io/astral-sh/uv:python3.12-bookworm-slim uv lock
docker compose build api
```

- [ ] **Step 2: Testy historii**

`api/tests/test_history.py`:
```python
from sqlalchemy import func, select
from sqlalchemy_continuum import version_class

from tests import factories as f
from topo.history import IMPORT_AUTHOR_PREFIX, is_manually_edited, set_author, transaction_class
from topo.models import Area, Crag, LinePoint, Route, RouteLine, Wall


def test_insert_records_version_with_author(session):
    set_author(session, "Paweł", "dodanie obszaru")
    region = f.area(session, "Dolina")

    AreaVersion = version_class(Area)
    [version] = session.scalars(select(AreaVersion).where(AreaVersion.id == region.id)).all()
    assert version.operation_type == 0
    assert version.name == "Dolina"
    tx = session.get(transaction_class(), version.transaction_id)
    assert (tx.author, tx.comment) == ("Paweł", "dodanie obszaru")


def test_update_in_next_transaction_adds_version(session):
    set_author(session, IMPORT_AUTHOR_PREFIX + "portalgorski")
    region = f.area(session, "Dolina")
    session.commit()

    set_author(session, "Ola", "poprawka nazwy")
    region.name = "Dolina Kobylańska"
    session.commit()

    AreaVersion = version_class(Area)
    versions = session.scalars(
        select(AreaVersion).where(AreaVersion.id == region.id).order_by(AreaVersion.transaction_id)
    ).all()
    assert [v.name for v in versions] == ["Dolina", "Dolina Kobylańska"]
    assert [v.operation_type for v in versions] == [0, 1]
    assert session.get(transaction_class(), versions[1].transaction_id).author == "Ola"


def test_is_manually_edited(session):
    set_author(session, IMPORT_AUTHOR_PREFIX + "portalgorski")
    crag = f.crag(session, f.area(session, "Dolina"), "Skała")
    session.commit()
    assert not is_manually_edited(session, Crag, [crag.id])

    set_author(session, "Ola")
    crag.rock_type = "wapień"
    session.commit()
    assert is_manually_edited(session, Crag, [crag.id])
    assert not is_manually_edited(session, Crag, [])


def test_change_without_author_counts_as_manual(session):
    crag = f.crag(session, f.area(session, "Dolina"), "Skała")
    session.commit()
    assert is_manually_edited(session, Crag, [crag.id])


def test_all_content_models_are_versioned(session):
    set_author(session, "Paweł")
    crag = f.crag(session, f.area(session, "Dolina"), "Skała")
    route = f.route(session, crag, "Droga", grade="VI")
    f.line(session, f.wall(session, crag), route=route)

    for model, expected in [(Area, 1), (Crag, 1), (Wall, 1), (Route, 1), (RouteLine, 1), (LinePoint, 3)]:
        version = version_class(model)
        assert session.scalar(select(func.count()).select_from(version)) == expected, model.__name__
```

- [ ] **Step 3: Moduł historii**

`api/topo/history.py`:
```python
"""Change history (SQLAlchemy-Continuum): every write is a versioned transaction with an author."""

from collections.abc import Iterable

import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy_continuum import make_versioned, version_class, versioning_manager
from sqlalchemy_continuum.plugins.base import Plugin
from sqlalchemy_continuum.transaction import TransactionFactory

IMPORT_AUTHOR_PREFIX = "import:"


class _TopoTransactionFactory(TransactionFactory):
    """Continuum's Transaction table extended with who made the change and why."""

    def create_class(self, manager):
        transaction = super().create_class(manager)
        transaction.author = sa.Column(sa.String(100))
        transaction.comment = sa.Column(sa.String(500))
        return transaction


class _AuthorPlugin(Plugin):
    def transaction_args(self, uow, session):
        return {"author": session.info.get("author"), "comment": session.info.get("comment")}


def enable_versioning() -> None:
    versioning_manager.transaction_cls = _TopoTransactionFactory(remote_addr=False)
    make_versioned(user_cls=None, plugins=[_AuthorPlugin()])


def set_author(session: Session, author: str, comment: str | None = None) -> None:
    session.info["author"] = author
    session.info["comment"] = comment


def transaction_class() -> type:
    return versioning_manager.transaction_cls


def is_manually_edited(session: Session, model: type, ids: Iterable[int]) -> bool:
    """True if any version of the given rows was written by someone other than an importer."""
    ids = list(ids)
    if not ids:
        return False
    version = version_class(model)
    transaction = transaction_class()
    manual = sa.or_(transaction.author.is_(None), sa.not_(transaction.author.startswith(IMPORT_AUTHOR_PREFIX)))
    stmt = sa.select(
        sa.exists().where(version.id.in_(ids), version.transaction_id == transaction.id, manual)
    )
    return bool(session.scalar(stmt))
```

Na górze `api/topo/models/base.py` (przed `class Base`), dopisz:
```python
from topo.history import enable_versioning

enable_versioning()
```

W klasach `Area`, `Crag`, `Wall`, `Route`, `RouteLine`, `LinePoint` dodaj jako pierwszy atrybut klasy:
```python
    __versioned__ = {}
```

Na końcu `api/topo/models/__init__.py` (po importach, przed `__all__`):
```python
from sqlalchemy.orm import configure_mappers

configure_mappers()
```

W `api/alembic/env.py` dodaj import `from geoalchemy2 import alembic_helpers` i w `context.configure(...)` dopisz argumenty `process_revision_directives=alembic_helpers.writer, render_item=alembic_helpers.render_item` (pozostałe argumenty i istniejący `include_object` bez zmian).

- [ ] **Step 4: Migracja 0002 (autogenerate)**

```powershell
docker compose run --rm api alembic upgrade head
docker compose run --rm api alembic revision --autogenerate -m "historia zmian" --rev-id 0002
```
Zmień nazwę wygenerowanego pliku na `api/alembic/versions/0002_historia.py` i przejrzyj go:
- tworzy tabelę `transaction` (`id` BigInteger PK, `issued_at`, `author` String(100), `comment` String(500)) i tabele `area_version`, `crag_version`, `wall_version`, `route_version`, `route_line_version`, `line_point_version` (kolumny modelu + `transaction_id`, `end_transaction_id`, `operation_type`, PK `(id, transaction_id)`, indeksy);
- **sekwencja `transaction_id_seq`**: Continuum pobiera id z tej sekwencji. Jeśli autogenerate jej nie utworzył, dopisz na początku `upgrade()`: `op.execute(sa.schema.CreateSequence(sa.Sequence("transaction_id_seq")))`, a na końcu `downgrade()`: `op.execute(sa.schema.DropSequence(sa.Sequence("transaction_id_seq")))`;
- nie rusza tabel z migracji 0001 ani tabel rozszerzeń PostGIS (jeśli rusza — usuń te operacje i popraw `include_object`, nie migrację 0001).

Sprawdź: `docker compose run --rm api alembic upgrade head`, `alembic downgrade 0001`, `alembic upgrade head`, `alembic check` (bez zmian do wygenerowania).

- [ ] **Step 5: Uruchom testy**

Run: `docker compose run --rm api pytest -v`
Expected: wszystkie PASS (62 z planu 1 + 5 nowych).

Jeśli `test_update_in_next_transaction_adds_version` nie widzi drugiej wersji, sprawdź, czy `session.commit()` w trybie `join_transaction_mode="create_savepoint"` kończy transakcję Continuum; jeśli nie — w teście zamiast `session.commit()` użyj `session.flush(); session.commit()` lub opisz problem w raporcie (nie zmieniaj oczekiwań testu).

- [ ] **Step 6: Commit**

```powershell
git add api
git commit -m "feat: historia zmian (SQLAlchemy-Continuum) z autorem i komentarzem" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pobieranie z cache (`CachedFetcher`)

**Files:**
- Create: `api/topo/importer/__init__.py` (pusty), `api/topo/importer/fetch.py`
- Test: `api/tests/test_fetch.py`

**Interfaces:**
- Produces:
  - `topo.importer.fetch.FetchError(Exception)`, `CacheMiss(FetchError)`
  - `CachedFetcher(cache_dir: Path, *, delay: float = 1.5, retries: int = 3, offline: bool = False, user_agent: str = DEFAULT_USER_AGENT, client: httpx.Client | None = None, sleep: Callable[[float], None] = time.sleep)`
  - `CachedFetcher.get(url: str) -> bytes`, `CachedFetcher.post(url: str, data: Mapping[str, str]) -> bytes`, `CachedFetcher.cache_path(method: str, url: str, data: Mapping[str, str] | None = None) -> Path`

- [ ] **Step 1: Testy**

`api/tests/test_fetch.py`:
```python
import httpx
import pytest

from topo.importer.fetch import CacheMiss, CachedFetcher, FetchError


def make_fetcher(tmp_path, handler, **kw):
    sleeps = []
    client = httpx.Client(transport=httpx.MockTransport(handler))
    fetcher = CachedFetcher(tmp_path, client=client, sleep=sleeps.append, **kw)
    return fetcher, sleeps


def test_get_downloads_once_then_uses_cache(tmp_path):
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(200, content=b"tresc")

    fetcher, _ = make_fetcher(tmp_path, handler)
    assert fetcher.get("https://example.org/a") == b"tresc"
    assert fetcher.get("https://example.org/a") == b"tresc"
    assert len(calls) == 1
    assert fetcher.cache_path("GET", "https://example.org/a").read_bytes() == b"tresc"


def test_post_cache_key_includes_form_data(tmp_path):
    def handler(request):
        return httpx.Response(200, content=request.content)

    fetcher, _ = make_fetcher(tmp_path, handler)
    first = fetcher.post("https://example.org/p", {"imageId": "1", "pathId": "0"})
    second = fetcher.post("https://example.org/p", {"imageId": "2", "pathId": "0"})
    assert first != second
    assert b"imageId=1" in first


def test_delay_between_network_requests_only(tmp_path):
    fetcher, sleeps = make_fetcher(tmp_path, lambda r: httpx.Response(200, content=b"x"), delay=1.5)
    fetcher.get("https://example.org/1")
    fetcher.get("https://example.org/2")
    fetcher.get("https://example.org/1")  # z cache, bez czekania
    assert sleeps == [1.5]


def test_retries_server_errors_then_succeeds(tmp_path):
    responses = iter([httpx.Response(503), httpx.Response(200, content=b"ok")])
    fetcher, sleeps = make_fetcher(tmp_path, lambda r: next(responses), delay=1.0)
    assert fetcher.get("https://example.org/a") == b"ok"
    assert sleeps == [2.0]


def test_gives_up_after_retries(tmp_path):
    def handler(request):
        raise httpx.ConnectError("brak sieci")

    fetcher, _ = make_fetcher(tmp_path, handler, retries=3, delay=0)
    with pytest.raises(FetchError):
        fetcher.get("https://example.org/a")
    assert not fetcher.cache_path("GET", "https://example.org/a").exists()


def test_client_error_is_not_retried_or_cached(tmp_path):
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(404)

    fetcher, _ = make_fetcher(tmp_path, handler)
    with pytest.raises(FetchError, match="404"):
        fetcher.get("https://example.org/brak")
    assert len(calls) == 1


def test_offline_mode_raises_cache_miss(tmp_path):
    fetcher, _ = make_fetcher(tmp_path, lambda r: httpx.Response(200), offline=True)
    with pytest.raises(CacheMiss):
        fetcher.get("https://example.org/a")
```

- [ ] **Step 2: Implementacja**

`api/topo/importer/fetch.py`:
```python
"""HTTP fetching with an on-disk cache, polite delays between requests and retries."""

import hashlib
import time
from collections.abc import Callable, Mapping
from pathlib import Path

import httpx

DEFAULT_USER_AGENT = "topo-importer/0.1 (prywatne, niekomercyjne wiki topo)"


class FetchError(Exception):
    pass


class CacheMiss(FetchError):
    pass


class CachedFetcher:
    def __init__(
        self,
        cache_dir: Path,
        *,
        delay: float = 1.5,
        retries: int = 3,
        offline: bool = False,
        user_agent: str = DEFAULT_USER_AGENT,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.cache_dir = Path(cache_dir)
        self.delay = delay
        self.retries = retries
        self.offline = offline
        self.client = client or httpx.Client(timeout=60, follow_redirects=True)
        self.client.headers["User-Agent"] = user_agent
        self.sleep = sleep
        self._requested = False

    def get(self, url: str) -> bytes:
        return self._fetch("GET", url, None)

    def post(self, url: str, data: Mapping[str, str]) -> bytes:
        return self._fetch("POST", url, data)

    def cache_path(self, method: str, url: str, data: Mapping[str, str] | None = None) -> Path:
        key = f"{method} {url}"
        if data:
            key += "?" + "&".join(f"{name}={value}" for name, value in sorted(data.items()))
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return self.cache_dir / digest[:2] / digest

    def _fetch(self, method: str, url: str, data: Mapping[str, str] | None) -> bytes:
        path = self.cache_path(method, url, data)
        if path.exists():
            return path.read_bytes()
        if self.offline:
            raise CacheMiss(f"Brak w cache: {method} {url}")
        body = self._download(method, url, data)
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_suffix(".part")
        partial.write_bytes(body)
        partial.replace(path)
        return body

    def _download(self, method: str, url: str, data: Mapping[str, str] | None) -> bytes:
        error = FetchError(f"Nie udało się pobrać: {method} {url}")
        for attempt in range(self.retries):
            if self._requested:
                self.sleep(self.delay)
            self._requested = True
            try:
                response = self.client.request(method, url, data=data)
            except httpx.TransportError as exc:
                error = FetchError(f"Błąd sieci: {method} {url}: {exc}")
            else:
                if response.status_code < 400:
                    return response.content
                if response.status_code < 500:
                    raise FetchError(f"HTTP {response.status_code}: {method} {url}")
                error = FetchError(f"HTTP {response.status_code}: {method} {url}")
            if attempt + 1 < self.retries:
                self.sleep(self.delay * 2 ** (attempt + 1))
                self._requested = False
        raise error
```

- [ ] **Step 3: Uruchom testy**

Run: `docker compose run --rm api pytest tests/test_fetch.py -v`
Expected: 7 PASS.

- [ ] **Step 4: Commit**

```powershell
git add api/topo/importer api/tests/test_fetch.py
git commit -m "feat: pobieranie z cache, przerwami i ponawianiem" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Parsery Portalu Górskiego

**Files:**
- Create: `api/topo/importer/portalgorski/__init__.py` (pusty), `api/topo/importer/portalgorski/types.py`, `api/topo/importer/portalgorski/parse.py`
- Create (dane): `api/tests/fixtures/portalgorski/start.json`, `skala111.html`, `skala955.html`, `paths46.json`, `paths2533.json`
- Test: `api/tests/test_parse_portalgorski.py`

**Interfaces:**
- Produces (`topo.importer.portalgorski.types`, wszystkie `@dataclass(frozen=True)`):
  - `TrailItem(kind: str, source_id: int, name: str, url: str)` — `kind` ∈ obszar/region/sektor/skala
  - `RockRef(source_id: int, name: str, url: str, lat: float, lng: float)`
  - `StartList(rocks: list[RockRef], invalid_urls: list[str])`
  - `WallRef(source_id: int, name: str | None, description: str | None, image_url: str | None)`
  - `RockPage(source_id: int, name: str, url: str, path: list[TrailItem], lat: float | None, lng: float | None, rock_type: str | None, height_min: float | None, height_max: float | None, aspects: list[str], formations: list[str], approach_minutes: int | None, child_friendly: bool | None, surroundings: str | None, description: str | None, walls: list[WallRef])` — `path` to obszary nad skałą (bez samej skały)
  - `PointData(source_id: int, x: float, y: float, kind: str, visible: bool, raw_kind: str)` — `x`, `y` w pikselach zdjęcia
  - `LineData(source_id: int, order: int, branch_order: int, color: str, parent_source_id: int | None, parent_point_source_id: int | None, points: list[PointData])`
  - `RouteData(source_id: int, name: str, protection: str | None, grade: str | None, first_ascent: str | None, year: int | None, length_m: float | None)`
  - `WallTopo(lines: list[LineData], routes: list[RouteData])`
- Produces (`topo.importer.portalgorski.parse`): `BASE_URL`, `START_URL`, `PATHS_URL`, `KNOWN_POINT_KINDS: frozenset[str]`, `map_point(kind_name: str, type_id: int | None, index: int) -> tuple[str, bool]`, `parse_start(raw: bytes) -> StartList`, `parse_rock_page(raw: bytes) -> RockPage`, `parse_paths(raw: bytes) -> WallTopo`

- [ ] **Step 1: Zapisz prawdziwe odpowiedzi jako fixtures**

W Git Bash, z katalogu repo (jednorazowo, z przerwami):
```bash
F=api/tests/fixtures/portalgorski; mkdir -p $F; UA="topo-importer/0.1 (prywatne, niekomercyjne wiki topo)"; B=https://topo.portalgorski.pl
curl -s -A "$UA" "$B/topo/json/start" -o $F/start.json; sleep 2
curl -s -A "$UA" "$B/Żabi-Koń,Grupa-Żabiego-Konia,Dolina-Kobylańska,Jura-Krakowsko-Częstochowska,skala,111" -o $F/skala111.html; sleep 2
curl -s -A "$UA" "$B/Szczyrzyc,Beskidy,skala,955" -o $F/skala955.html; sleep 2
curl -s -A "$UA" -X POST -d "imageId=46&pathId=0" "$B/topo/topoEditor/loadPaths" -o $F/paths46.json; sleep 2
curl -s -A "$UA" -X POST -d "imageId=2533&pathId=0" "$B/topo/topoEditor/loadPaths" -o $F/paths2533.json
ls -la $F
```
Expected: 5 niepustych plików (start.json ~380 KB).

- [ ] **Step 2: Testy**

`api/tests/test_parse_portalgorski.py`:
```python
from pathlib import Path

import pytest

from topo.importer.portalgorski.parse import BASE_URL, map_point, parse_paths, parse_rock_page, parse_start

FIXTURES = Path(__file__).parent / "fixtures" / "portalgorski"


def load(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def test_parse_start_lists_rocks_and_invalid_urls():
    start = parse_start(load("start.json"))
    assert len(start.rocks) == 635
    assert len(start.invalid_urls) == 3
    zabi = next(r for r in start.rocks if r.source_id == 111)
    assert zabi.name == "Żabi Koń"
    assert zabi.url == BASE_URL + "/Żabi-Koń,Grupa-Żabiego-Konia,Dolina-Kobylańska,Jura-Krakowsko-Częstochowska,skala,111"
    assert (zabi.lat, zabi.lng) == pytest.approx((50.15598612, 19.75617396))


def test_parse_rock_page_details_and_path():
    page = parse_rock_page(load("skala111.html"))
    assert (page.source_id, page.name) == (111, "Żabi Koń")
    assert [(p.kind, p.source_id, p.name) for p in page.path] == [
        ("obszar", 34, "Jura Krakowsko Częstochowska"),
        ("region", 100, "Dolina Kobylańska"),
        ("sektor", 102, "Grupa Żabiego Konia"),
    ]
    assert (page.lat, page.lng) == pytest.approx((50.15598612, 19.75617396))
    assert page.rock_type == "wapień"
    assert (page.height_min, page.height_max) == (10.0, 40.0)
    assert page.aspects == ["W", "NW"]
    assert page.formations == ["filar", "pion", "połóg", "przewieszenie", "zacięcie"]
    assert page.approach_minutes == 10
    assert page.child_friendly is True
    assert page.surroundings == "Otwarta przestrzeń"
    assert page.description is None


def test_parse_rock_page_walls():
    page = parse_rock_page(load("skala111.html"))
    assert [(w.source_id, w.name) for w in page.walls] == [
        (45, "Mur przy Żabim Koniu"), (46, "Żabi Koń"), (2531, "Kapliczka"),
    ]
    assert page.walls[1].image_url == BASE_URL + "/images/original/100/9ef/a98/9ef8a98_zabi_kon_1_JPG"
    assert page.walls[1].description is None


def test_parse_rock_directly_under_area_with_description():
    page = parse_rock_page(load("skala955.html"))
    assert [(p.kind, p.source_id) for p in page.path] == [("obszar", 737)]
    assert page.rock_type == "piaskowiec"
    assert page.aspects == ["W", "NW", "NE"]
    assert page.approach_minutes == 4
    assert page.description.startswith("Diabli Kamień koło Szczyrzyca to spory, piaskowcowy mur skalny.")
    assert "zarówno" in page.description
    assert "\nSkała znajduje sięna wzgórzu" in page.description
    assert [w.source_id for w in page.walls] == [2533, 2534, 2535, 2536]


def test_parse_paths_lines_and_variant():
    topo = parse_paths(load("paths46.json"))
    assert [line.source_id for line in topo.lines] == [287, 13489, 288, 289, 290, 291, 292, 293, 13490]
    first = topo.lines[0]
    assert (first.order, first.branch_order, first.color, len(first.points)) == (1, 0, "#00BFFF", 11)
    assert (first.points[0].x, first.points[0].y) == (312.0, 711.0)
    assert (first.points[0].kind, first.points[0].visible) == ("start", False)
    assert (first.points[1].kind, first.points[1].visible) == ("ring", True)

    variant = next(line for line in topo.lines if line.source_id == 291)
    assert (variant.order, variant.branch_order) == (5, 1)
    assert (variant.parent_source_id, variant.parent_point_source_id) == (290, 2022)
    assert (variant.points[0].kind, variant.points[0].visible) == ("ring", True)
    assert (variant.points[1].kind, variant.points[1].visible) == ("przelot", False)

    kinds = {p.kind for line in topo.lines for p in line.points}
    assert {"hak", "stanowisko", "ucho"} <= kinds


def test_parse_paths_route_table():
    topo = parse_paths(load("paths46.json"))
    assert len(topo.routes) == 9
    kant = topo.routes[0]
    assert (kant.source_id, kant.name, kant.protection, kant.grade) == (287, "Lewy kant Żabiego Konia", "9r + ST", "V+")
    assert (kant.first_ascent, kant.year, kant.length_m) == ("R. Malczyk, W. Sas-Nowosielski", 1972, 25.0)
    superdir = next(r for r in topo.routes if r.source_id == 288)
    assert superdir.year is None
    trawers = next(r for r in topo.routes if r.source_id == 291)
    assert (trawers.name, trawers.first_ascent) == ("Górny trawers Żabiego Konia", None)


def test_parse_paths_ogranicznik():
    topo = parse_paths(load("paths2533.json"))
    [line] = topo.lines
    assert line.source_id == 13565
    assert [p.kind for p in line.points] == [
        "start", "przelot", "ring", "ogranicznik", "ring", "ring", "ring", "ring", "ring", "stanowisko",
    ]
    [route] = topo.routes
    assert (route.source_id, route.name, route.grade, route.length_m) == (13565, "Droga krzyżowa", "VI.3+", 11.0)


def test_parse_paths_failed_status_is_empty():
    topo = parse_paths(b'{"status": 0, "message": "brak"}')
    assert topo.lines == [] and topo.routes == []


@pytest.mark.parametrize(
    ("kind_name", "type_id", "index", "expected"),
    [
        ("ring", 1, 0, ("start", False)),
        ("ring", 1, 3, ("przelot", False)),
        (" hak", 2, 3, ("hak", True)),
        ("dwa ringi zjazdowe", 2, 5, ("stanowisko", True)),
        ("stanowisko zjazdowe", 1, 5, ("stanowisko", False)),
        ("spit", 2, 2, ("przelot", True)),
    ],
)
def test_map_point(kind_name, type_id, index, expected):
    assert map_point(kind_name, type_id, index) == expected
```

- [ ] **Step 3: Implementacja**

`api/topo/importer/portalgorski/types.py`:
```python
"""Plain data parsed from Portal Górski; no database or network here."""

from dataclasses import dataclass


@dataclass(frozen=True)
class TrailItem:
    kind: str
    source_id: int
    name: str
    url: str


@dataclass(frozen=True)
class RockRef:
    source_id: int
    name: str
    url: str
    lat: float
    lng: float


@dataclass(frozen=True)
class StartList:
    rocks: list[RockRef]
    invalid_urls: list[str]


@dataclass(frozen=True)
class WallRef:
    source_id: int
    name: str | None
    description: str | None
    image_url: str | None


@dataclass(frozen=True)
class RockPage:
    source_id: int
    name: str
    url: str
    path: list[TrailItem]
    lat: float | None
    lng: float | None
    rock_type: str | None
    height_min: float | None
    height_max: float | None
    aspects: list[str]
    formations: list[str]
    approach_minutes: int | None
    child_friendly: bool | None
    surroundings: str | None
    description: str | None
    walls: list[WallRef]


@dataclass(frozen=True)
class PointData:
    source_id: int
    x: float
    y: float
    kind: str
    visible: bool
    raw_kind: str


@dataclass(frozen=True)
class LineData:
    source_id: int
    order: int
    branch_order: int
    color: str
    parent_source_id: int | None
    parent_point_source_id: int | None
    points: list[PointData]


@dataclass(frozen=True)
class RouteData:
    source_id: int
    name: str
    protection: str | None
    grade: str | None
    first_ascent: str | None
    year: int | None
    length_m: float | None


@dataclass(frozen=True)
class WallTopo:
    lines: list[LineData]
    routes: list[RouteData]
```

`api/topo/importer/portalgorski/parse.py`:
```python
"""Parsers for topo.portalgorski.pl pages and JSON responses."""

import html
import json
import re
from typing import Any

from selectolax.parser import HTMLParser

from topo.importer.portalgorski.types import (
    LineData,
    PointData,
    RockPage,
    RockRef,
    RouteData,
    StartList,
    TrailItem,
    WallRef,
    WallTopo,
)

BASE_URL = "https://topo.portalgorski.pl"
START_URL = f"{BASE_URL}/topo/json/start"
PATHS_URL = f"{BASE_URL}/topo/topoEditor/loadPaths"

_OBJECT_URL = re.compile(r",(obszar|region|sektor|skala),(\d+)$")
_WALL = re.compile(
    r'<h5>(?P<name>[^<]*)</h5>\s*<div>\s*<div class="description darker">(?P<desc>.*?)</div>\s*'
    r'<div>\s*<div class="topoEditor[^"]*" id="topoEditor_(?P<id>\d+)"',
    re.S,
)
_WALL_IMAGE = re.compile(r"TopoEditorFactory\(\{\s*id:\s*(?P<id>\d+),\s*imageMain:\s*'(?P<image>[^']+)'")
_HEIGHT = re.compile(r"min\.\s*([\d.]+)\s*m.*?max\.\s*([\d.]+)\s*m", re.S)
_MINUTES = re.compile(r"(\d+)\s*min")
_HOURS = re.compile(r"(\d+)\s*h")
_LENGTH = re.compile(r"([\d.,]+)\s*m")
_ROUTE_ROW = re.compile(r"pathLiBottom_(\d+)")

_POINT_KINDS = {
    "ring": "ring",
    "hak": "hak",
    "ucho skalne": "ucho",
    "stanowisko": "stanowisko",
    "stanowisko zjazdowe": "stanowisko",
    "dwa ringi zjazdowe": "stanowisko",
    "ogranicznik": "ogranicznik",
}
KNOWN_POINT_KINDS = frozenset(_POINT_KINDS)


def map_point(kind_name: str, type_id: int | None, index: int) -> tuple[str, bool]:
    """Portal point → (our kind, visible). typeId 1 marks a helper point that is not a bolt."""
    name = kind_name.strip().lower()
    if type_id == 1:
        if index == 0:
            return "start", False
        if name == "ring":
            return "przelot", False
        return _POINT_KINDS.get(name, "przelot"), False
    return _POINT_KINDS.get(name, "przelot"), True


def parse_start(raw: bytes) -> StartList:
    rocks: dict[int, RockRef] = {}
    invalid: list[str] = []
    for item in json.loads(raw)["results"]:
        if item.get("type") != "rock":
            continue
        match = _OBJECT_URL.search(item.get("url", ""))
        if match is None or match.group(1) != "skala":
            invalid.append(item.get("url", ""))
            continue
        source_id = int(match.group(2))
        rocks.setdefault(
            source_id,
            RockRef(
                source_id=source_id,
                name=html.unescape(item["title"]).strip(),
                url=BASE_URL + item["url"],
                lat=float(item["lat"]),
                lng=float(item["lng"]),
            ),
        )
    return StartList(rocks=list(rocks.values()), invalid_urls=invalid)


def parse_rock_page(raw: bytes) -> RockPage:
    text = raw.decode("utf-8")
    tree = HTMLParser(text)
    trail = _trail(tree)
    if not trail or trail[-1].kind != "skala":
        raise ValueError("Nie rozpoznano strony skały")
    rock = trail[-1]
    images = {int(m["id"]): BASE_URL + m["image"] for m in _WALL_IMAGE.finditer(text)}
    walls = [
        WallRef(
            source_id=int(m["id"]),
            name=_clean(html.unescape(m["name"])) or None,
            description=_html_to_text(m["desc"]),
            image_url=images.get(int(m["id"])),
        )
        for m in _WALL.finditer(text)
    ]
    return RockPage(
        source_id=rock.source_id,
        name=rock.name,
        url=rock.url,
        path=trail[:-1],
        description=_description(tree),
        walls=walls,
        **_details(tree),
    )


def parse_paths(raw: bytes) -> WallTopo:
    data = json.loads(raw)
    if data.get("status") != 1:
        return WallTopo(lines=[], routes=[])
    lines = []
    for path in data.get("data") or []:
        raw_points = path.get("points") or []
        points = []
        for index, point in enumerate(raw_points):
            kind, visible = map_point(point.get("kindName", ""), point.get("typeId"), index)
            points.append(
                PointData(
                    source_id=int(point["pointId"]),
                    x=float(point["x"]),
                    y=float(point["y"]),
                    kind=kind,
                    visible=visible,
                    raw_kind=point.get("kindName", "").strip(),
                )
            )
        parent_point = next((p["parentPointId"] for p in raw_points if p.get("parentPointId")), None)
        lines.append(
            LineData(
                source_id=int(path["pathId"]),
                order=int(path.get("order") or 0),
                branch_order=int(path.get("branchOrder") or 0),
                color=path.get("color") or "#e11d48",
                parent_source_id=_int_or_none(path.get("parentPathId")),
                parent_point_source_id=_int_or_none(parent_point),
                points=points,
            )
        )
    return WallTopo(lines=lines, routes=_route_table(data.get("pathsListBottom") or ""))


def _route_table(fragment: str) -> list[RouteData]:
    routes = []
    for row in HTMLParser(fragment).css("tr.pathLiBottom"):
        match = _ROUTE_ROW.fullmatch(row.attributes.get("id") or "")
        cells = [_clean(cell.text()) for cell in row.css("td")]
        if match is None or len(cells) < 8:
            continue
        _number, name, protection, grade, _rating, author, year, length = cells[:8]
        length_match = _LENGTH.search(length)
        routes.append(
            RouteData(
                source_id=int(match.group(1)),
                name=name,
                protection=protection or None,
                grade=grade or None,
                first_ascent=author or None,
                year=int(year) if year.isdigit() else None,
                length_m=float(length_match.group(1).replace(",", ".")) if length_match else None,
            )
        )
    return routes


def _trail(tree: HTMLParser) -> list[TrailItem]:
    menu = tree.css_first("#treeMenu")
    if menu is None:
        return []
    items = []
    for link in menu.css("ul.tree li.leafmenu a"):
        href = link.attributes.get("href") or ""
        match = _OBJECT_URL.search(href)
        if match:
            items.append(
                TrailItem(kind=match.group(1), source_id=int(match.group(2)), name=_clean(link.text()), url=BASE_URL + href)
            )
    return items


def _details(tree: HTMLParser) -> dict[str, Any]:
    details: dict[str, Any] = {
        "lat": None, "lng": None, "rock_type": None, "height_min": None, "height_max": None,
        "aspects": [], "formations": [], "approach_minutes": None, "child_friendly": None, "surroundings": None,
    }
    for row in tree.css("table.tblData tr"):
        icon = row.css_first("div.itemIcon")
        cells = row.css("td")
        if icon is None or len(cells) < 2:
            continue
        code = next((c for c in (icon.attributes.get("class") or "").split() if c != "itemIcon"), "")
        cell = cells[1]
        value = _clean(cell.text())
        if code == "pGPS":
            small = cell.css_first("span.dataSm")
            if small is not None:
                lat, lng = small.text().split(",")
                details["lat"], details["lng"] = float(lat), float(lng)
        elif code == "pRT":
            details["rock_type"] = value or None
        elif code == "pH":
            match = _HEIGHT.search(value)
            if match:
                details["height_min"], details["height_max"] = float(match.group(1)), float(match.group(2))
        elif code == "pWF":
            details["aspects"] = [img.attributes["alt"] for img in cell.css("img") if img.attributes.get("alt")]
        elif code == "pRF":
            details["formations"] = [part.strip() for part in cell.text().split("\xa0") if part.strip()]
        elif code == "pT":
            details["approach_minutes"] = _minutes(value)
        elif code == "pCF":
            details["child_friendly"] = {"TAK": True, "NIE": False}.get(value.upper())
        elif code == "pRL":
            details["surroundings"] = value or None
    return details


def _description(tree: HTMLParser) -> str | None:
    for box in tree.css("div.box"):
        title = box.css_first("h3")
        if title is not None and _clean(title.text()) == "Opis i dojście":
            desc = box.css_first("span.desc")
            return _html_to_text(desc.html or "") if desc is not None else None
    return None


def _minutes(value: str) -> int | None:
    hours = _HOURS.search(value)
    minutes = _MINUTES.search(value)
    if hours is None and minutes is None:
        return None
    return (int(hours.group(1)) * 60 if hours else 0) + (int(minutes.group(1)) if minutes else 0)


def _html_to_text(fragment: str) -> str | None:
    fragment = re.sub(r"(?i)<br\s*/?>|</p>", "\n", fragment)
    text = HTMLParser(fragment).text().replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    joined = "\n".join(line for line in lines if line)
    return joined or None


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def _int_or_none(value: Any) -> int | None:
    return int(value) if value not in (None, "", 0) else None
```

- [ ] **Step 4: Uruchom testy**

Run: `docker compose run --rm api pytest tests/test_parse_portalgorski.py -v`
Expected: wszystkie PASS. Jeśli któraś wartość z testu różni się od świeżo pobranego fixture (portal zmienił dane), nie poprawiaj testu po cichu — opisz różnicę w raporcie.

- [ ] **Step 5: Commit**

```powershell
git add api/topo/importer/portalgorski api/tests/fixtures api/tests/test_parse_portalgorski.py
git commit -m "feat: parsery Portalu Górskiego (skały, ściany, linie, drogi)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Zapis zdjęć ścian (`topo.media`)

**Files:**
- Create: `api/topo/media.py`
- Test: `api/tests/test_media.py`

**Interfaces:**
- Produces:
  - `topo.media.InvalidImage(Exception)`
  - `topo.media.StoredImage(original_path: str, image_path: str, thumb_path: str, width: int, height: int)` (frozen dataclass; ścieżki względne do `media_root`, z `/`)
  - `topo.media.store_wall_image(media_root: Path, wall_id: int, data: bytes) -> StoredImage` — `width`/`height` to wymiary oryginału po obrocie z EXIF

- [ ] **Step 1: Testy**

`api/tests/test_media.py`:
```python
import io

import pytest
from PIL import Image

from topo.media import InvalidImage, store_wall_image


def jpeg(width, height, orientation=None) -> bytes:
    buffer = io.BytesIO()
    image = Image.new("RGB", (width, height), (120, 90, 60))
    if orientation is None:
        image.save(buffer, "JPEG")
    else:
        exif = Image.Exif()
        exif[0x0112] = orientation
        image.save(buffer, "JPEG", exif=exif)
    return buffer.getvalue()


def test_store_creates_original_display_and_thumb(tmp_path):
    data = jpeg(2000, 1000)
    stored = store_wall_image(tmp_path, 7, data)

    assert stored.original_path == "walls/7/original.jpg"
    assert stored.image_path == "walls/7/display.webp"
    assert stored.thumb_path == "walls/7/thumb.webp"
    assert (stored.width, stored.height) == (2000, 1000)
    assert (tmp_path / stored.original_path).read_bytes() == data
    with Image.open(tmp_path / stored.image_path) as display:
        assert (display.format, display.size) == ("WEBP", (1600, 800))
    with Image.open(tmp_path / stored.thumb_path) as thumb:
        assert thumb.size == (400, 200)


def test_small_image_is_not_upscaled(tmp_path):
    stored = store_wall_image(tmp_path, 1, jpeg(800, 600))
    with Image.open(tmp_path / stored.image_path) as display:
        assert display.size == (800, 600)


def test_exif_rotation_is_applied(tmp_path):
    stored = store_wall_image(tmp_path, 2, jpeg(200, 100, orientation=6))
    assert (stored.width, stored.height) == (100, 200)


def test_invalid_data_raises(tmp_path):
    with pytest.raises(InvalidImage):
        store_wall_image(tmp_path, 3, b"to nie jest obrazek")
```

- [ ] **Step 2: Implementacja**

`api/topo/media.py`:
```python
"""Wall photo storage: original file plus WebP display and thumbnail versions."""

import io
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

DISPLAY_MAX = 1600
THUMB_MAX = 400


class InvalidImage(Exception):
    pass


@dataclass(frozen=True)
class StoredImage:
    original_path: str
    image_path: str
    thumb_path: str
    width: int
    height: int


def store_wall_image(media_root: Path, wall_id: int, data: bytes) -> StoredImage:
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise InvalidImage("Nieprawidłowy plik obrazu") from exc
    extension = {"JPEG": "jpg"}.get(image.format or "", (image.format or "img").lower())
    image = ImageOps.exif_transpose(image).convert("RGB")

    relative = Path("walls") / str(wall_id)
    target = Path(media_root) / relative
    target.mkdir(parents=True, exist_ok=True)

    original = relative / f"original.{extension}"
    (Path(media_root) / original).write_bytes(data)
    display = image.copy()
    display.thumbnail((DISPLAY_MAX, DISPLAY_MAX))
    display.save(target / "display.webp", "WEBP", quality=80)
    thumb = image.copy()
    thumb.thumbnail((THUMB_MAX, THUMB_MAX))
    thumb.save(target / "thumb.webp", "WEBP", quality=75)

    return StoredImage(
        original_path=original.as_posix(),
        image_path=(relative / "display.webp").as_posix(),
        thumb_path=(relative / "thumb.webp").as_posix(),
        width=image.width,
        height=image.height,
    )
```

- [ ] **Step 3: Uruchom testy**

Run: `docker compose run --rm api pytest tests/test_media.py -v`
Expected: 4 PASS.

- [ ] **Step 4: Commit**

```powershell
git add api/topo/media.py api/tests/test_media.py
git commit -m "feat: zapis zdjęć ścian (oryginał, WebP, miniatura)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Zapis importu do bazy + nowe pola modelu

**Files:**
- Modify: `api/topo/models/crag.py` (`child_friendly`, `surroundings`), `api/topo/models/wall.py` (`description`), `api/topo/models/route.py` (CHECK typu punktu z `ogranicznik`), `api/topo/schemas.py` (`CragOut.child_friendly`, `CragOut.surroundings`, `WallOut.description`), `api/topo/api/crags.py` (przekazanie nowych pól), `api/tests/test_api_crags.py` (asercje nowych pól)
- Create: `api/alembic/versions/0003_dane_portalu.py` (autogenerate), `api/topo/importer/portalgorski/store.py`
- Test: `api/tests/test_store_portalgorski.py`

**Interfaces:**
- Consumes: `is_manually_edited`, `set_author`, `IMPORT_AUTHOR_PREFIX` (Task 1); typy i `KNOWN_POINT_KINDS`, `parse_rock_page`, `parse_paths` (Task 3); `store_wall_image`, `InvalidImage` (Task 4); `unique_slug` (plan 1); `grade_sort` (plan 1); relacje `RouteLine.parent_line`, `RouteLine.parent_point` (plan 1, poprawka `ed86853`).
- Produces:
  - Kolumny: `crag.child_friendly: bool | None`, `crag.surroundings: str(100) | None`, `wall.description: Text | None`; `line_point.kind` dopuszcza `ogranicznik` (CHECK `ck_line_point_kind`).
  - `topo.importer.portalgorski.store.SOURCE = "portalgorski"`, `IMPORT_AUTHOR = "import:portalgorski"`, `EDGE_TOLERANCE = 0.01`
  - `WallInput(ref: WallRef, topo: WallTopo, image: bytes | None)` (dataclass)
  - `ImportReport` (dataclass, pola: `crags_created, crags_updated, walls, routes, lines, points: int`; `invalid_urls, skipped_manual, unknown_grades, unknown_point_kinds, bad_lines, errors: list[str]`)
  - `store_rock(session: Session, media_root: Path, page: RockPage, walls: list[WallInput], report: ImportReport) -> Crag` — nie commituje; rzuca `ValueError` dla skały bez współrzędnych lub bez obszaru

- [ ] **Step 1: Model, schemat API i migracja 0003**

`Crag` (po `approach_minutes`):
```python
    child_friendly: Mapped[bool | None]
    surroundings: Mapped[str | None] = mapped_column(String(100))
```
`Wall` (po `name`):
```python
    description: Mapped[str | None] = mapped_column(Text)
```
(dodaj import `Text` w `wall.py`). W `LinePoint.__table_args__` zmień CHECK `ck_line_point_kind` na:
```python
        CheckConstraint(
            "kind IN ('start', 'ring', 'hak', 'ucho', 'stanowisko', 'ogranicznik', 'przelot')",
            name="ck_line_point_kind",
        ),
```
`schemas.py`: w `CragOut` po `approach_minutes` dodaj `child_friendly: bool | None` i `surroundings: str | None`; w `WallOut` po `name` dodaj `description: str | None`. `api/crags.py`: przekaż `child_friendly=crag.child_friendly, surroundings=crag.surroundings` do `CragOut` i `description=wall.description` do `WallOut`. W `tests/test_api_crags.py::test_crag_detail_full` dopisz do tworzenia skały `child_friendly=True, surroundings="Otwarta przestrzeń"`, do ściany `description="Lewa część"` i asercje:
```python
    assert (body["child_friendly"], body["surroundings"]) == (True, "Otwarta przestrzeń")
    assert wall_out["description"] == "Lewa część"
```

Migracja:
```powershell
docker compose run --rm api alembic revision --autogenerate -m "dane portalu" --rev-id 0003
```
Zmień nazwę pliku na `0003_dane_portalu.py`. Autogenerate nie wykrywa zmian w CHECK — dopisz ręcznie w `upgrade()`:
```python
    op.drop_constraint("ck_line_point_kind", "line_point", type_="check")
    op.create_check_constraint(
        "ck_line_point_kind", "line_point",
        "kind IN ('start', 'ring', 'hak', 'ucho', 'stanowisko', 'ogranicznik', 'przelot')",
    )
```
i odwrotność w `downgrade()` (stara lista bez `ogranicznik`). Sprawdź, że migracja dodaje kolumny także do `crag_version` i `wall_version`. Potem `alembic upgrade head`, `downgrade 0002`, `upgrade head`, `alembic check`.

- [ ] **Step 2: Testy zapisu**

`api/tests/test_store_portalgorski.py`:
```python
import io
from pathlib import Path

import pytest
from PIL import Image
from sqlalchemy import func, select

from topo.history import set_author
from topo.importer.portalgorski.parse import parse_paths, parse_rock_page
from topo.importer.portalgorski.store import IMPORT_AUTHOR, ImportReport, WallInput, store_rock
from topo.importer.portalgorski.types import WallTopo
from topo.models import Area, Crag, LinePoint, Route, RouteLine, Wall

FIXTURES = Path(__file__).parent / "fixtures" / "portalgorski"
SIZES = {45: (1600, 1063), 46: (1063, 1600), 2531: (1600, 1143), 2533: (1008, 1600), 2534: (1600, 990), 2535: (996, 1600), 2536: (1600, 1082)}


def jpeg(size) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (90, 90, 90)).save(buffer, "JPEG")
    return buffer.getvalue()


def load(name):
    return (FIXTURES / name).read_bytes()


def wall_inputs(page, paths=None, sizes=SIZES):
    paths = paths or {}
    return [
        WallInput(ref=ref, topo=paths.get(ref.source_id, WallTopo(lines=[], routes=[])), image=jpeg(sizes[ref.source_id]))
        for ref in page.walls
    ]


def import_zabi(session, tmp_path, report=None, paths46=None, sizes=SIZES):
    page = parse_rock_page(load("skala111.html"))
    report = report or ImportReport()
    set_author(session, IMPORT_AUTHOR)
    crag = store_rock(session, tmp_path, page, wall_inputs(page, {46: paths46 or parse_paths(load("paths46.json"))}, sizes), report)
    session.commit()
    return crag, report


def test_store_rock_creates_hierarchy_crag_walls(session, tmp_path):
    crag, report = import_zabi(session, tmp_path)

    assert [(a.kind, a.name, a.source_id) for a in _chain(crag.area)] == [
        ("obszar", "Jura Krakowsko Częstochowska", "obszar:34"),
        ("region", "Dolina Kobylańska", "region:100"),
        ("sektor", "Grupa Żabiego Konia", "sektor:102"),
    ]
    assert (crag.name, crag.slug, crag.source, crag.source_id) == ("Żabi Koń", "zabi-kon", "portalgorski", "111")
    assert (crag.child_friendly, crag.surroundings, crag.aspects) == (True, "Otwarta przestrzeń", ["W", "NW"])
    assert [w.source_id for w in crag.walls] == ["45", "46", "2531"]
    wall46 = crag.walls[1]
    assert (wall46.image_width, wall46.image_height, wall46.depth_status) == (1063, 1600, "pending")
    assert (tmp_path / wall46.image_path).exists()
    assert report.crags_created == 1 and report.errors == []


def test_store_rock_routes_lines_points(session, tmp_path):
    crag, report = import_zabi(session, tmp_path)
    routes = {r.source_id: r for r in crag.routes}
    assert len(routes) == 9
    kant = routes["287"]
    assert (kant.number, kant.name, kant.grade, kant.protection, kant.year, kant.length_m) == (
        1, "Lewy kant Żabiego Konia", "V+", "9r + ST", 1972, 25.0,
    )
    assert kant.grade_sort is not None

    wall46 = crag.walls[1]
    lines = {line.source_id: line for line in wall46.lines}
    assert len(lines) == 9
    first = lines["287"]
    assert first.route is kant
    assert first.sort_order == 10
    assert (first.points[0].x, first.points[0].y) == pytest.approx((312 / 1063, 711 / 1600))
    assert first.points[0].kind == "start"

    variant = lines["291"]
    assert variant.parent_line is lines["290"]
    assert variant.parent_point.source_id == "2022"
    assert report.lines == 9 and report.routes == 9


def test_reimport_keeps_manual_route_edit(session, tmp_path):
    crag, _ = import_zabi(session, tmp_path)
    route = next(r for r in crag.routes if r.source_id == "287")
    set_author(session, "Ola", "poprawka nazwy")
    route.name = "Lewy kant (poprawiony)"
    session.commit()

    _, report = import_zabi(session, tmp_path)
    session.refresh(route)
    assert route.name == "Lewy kant (poprawiony)"
    assert any("Lewy kant (poprawiony)" in item for item in report.skipped_manual)


def test_line_outside_image_is_skipped(session, tmp_path):
    sizes = {**SIZES, 46: (500, 500)}
    crag, report = import_zabi(session, tmp_path, sizes=sizes)
    assert crag.walls[1].lines == []
    assert len(report.bad_lines) == 9
    assert len(crag.routes) == 9  # drogi zostają, nawet gdy linie są pominięte


def test_unknown_grade_and_point_kind_are_reported(session, tmp_path):
    raw = load("paths2533.json").replace(b"VI.3+", b"6a+").replace(b"ogranicznik", b"spit")
    page = parse_rock_page(load("skala955.html"))
    report = ImportReport()
    set_author(session, IMPORT_AUTHOR)
    crag = store_rock(session, tmp_path, page, wall_inputs(page, {2533: parse_paths(raw)}), report)
    session.commit()

    [route] = crag.routes
    assert (route.grade, route.grade_sort) == ("6a+", None)
    assert report.unknown_grades == ["Szczyrzyc / Droga krzyżowa: 6a+"]
    kinds = [p.kind for p in crag.walls[0].lines[0].points]
    assert kinds[3] == "przelot"
    assert len(report.unknown_point_kinds) == 1


def test_rock_directly_under_area(session, tmp_path):
    page = parse_rock_page(load("skala955.html"))
    set_author(session, IMPORT_AUTHOR)
    crag = store_rock(session, tmp_path, page, wall_inputs(page), ImportReport())
    session.commit()
    assert (crag.area.kind, crag.area.name) == ("obszar", "Beskidy")
    assert session.scalar(select(func.count()).select_from(Area)) == 1


def _chain(area):
    chain = []
    while area is not None:
        chain.append(area)
        area = area.parent
    return list(reversed(chain))
```

- [ ] **Step 3: Implementacja**

`api/topo/importer/portalgorski/store.py`:
```python
"""Write parsed Portal Górski data to the database: idempotent upserts that never overwrite manual edits."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from geoalchemy2 import WKTElement
from geoalchemy2.shape import to_shape
from sqlalchemy import select
from sqlalchemy.orm import Session

from topo.grades import grade_sort
from topo.history import is_manually_edited
from topo.importer.portalgorski.parse import KNOWN_POINT_KINDS
from topo.importer.portalgorski.types import LineData, RockPage, WallRef, WallTopo
from topo.media import InvalidImage, store_wall_image
from topo.models import Area, Crag, LinePoint, Route, RouteLine, Wall
from topo.slugs import unique_slug

SOURCE = "portalgorski"
IMPORT_AUTHOR = "import:portalgorski"
EDGE_TOLERANCE = 0.01


@dataclass
class WallInput:
    ref: WallRef
    topo: WallTopo
    image: bytes | None


@dataclass
class ImportReport:
    crags_created: int = 0
    crags_updated: int = 0
    walls: int = 0
    routes: int = 0
    lines: int = 0
    points: int = 0
    invalid_urls: list[str] = field(default_factory=list)
    skipped_manual: list[str] = field(default_factory=list)
    unknown_grades: list[str] = field(default_factory=list)
    unknown_point_kinds: list[str] = field(default_factory=list)
    bad_lines: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def store_rock(session: Session, media_root: Path, page: RockPage, walls: list[WallInput], report: ImportReport) -> Crag:
    area = _store_areas(session, page)
    crag = _store_crag(session, page, area, report)
    for index, wall_input in enumerate(walls):
        _store_wall(session, Path(media_root), crag, index, wall_input, report)
    session.flush()
    return crag


def _find(session: Session, model: type, source_id: str) -> Any:
    return session.scalar(select(model).where(model.source == SOURCE, model.source_id == source_id))


def _assign(obj: Any, **fields: Any) -> bool:
    changed = False
    for name, value in fields.items():
        if getattr(obj, name) != value:
            setattr(obj, name, value)
            changed = True
    return changed


def _store_areas(session: Session, page: RockPage) -> Area:
    parent: Area | None = None
    for item in page.path:
        source_id = f"{item.kind}:{item.source_id}"
        area = _find(session, Area, source_id)
        if area is None:
            context = [parent.name] if parent is not None else []
            area = Area(
                source=SOURCE, source_id=source_id, kind=item.kind, name=item.name,
                slug=unique_slug(session, Area, item.name, context), source_url=item.url, parent=parent,
            )
            session.add(area)
            session.flush()
        elif not is_manually_edited(session, Area, [area.id]):
            _assign(area, name=item.name, source_url=item.url, parent_id=parent.id if parent else None)
        parent = area
    if parent is None:
        raise ValueError(f"Skała {page.name} nie ma obszaru w ścieżce")
    return parent


def _store_crag(session: Session, page: RockPage, area: Area, report: ImportReport) -> Crag:
    if page.lat is None or page.lng is None:
        raise ValueError(f"Skała {page.name} nie ma współrzędnych")
    fields = dict(
        area_id=area.id, name=page.name, source_url=page.url, rock_type=page.rock_type,
        height_min=page.height_min, height_max=page.height_max, aspects=page.aspects,
        formations=page.formations, approach_minutes=page.approach_minutes,
        child_friendly=page.child_friendly, surroundings=page.surroundings, description=page.description,
    )
    crag = _find(session, Crag, str(page.source_id))
    if crag is None:
        context = [item.name for item in reversed(page.path)]
        crag = Crag(
            source=SOURCE, source_id=str(page.source_id), slug=unique_slug(session, Crag, page.name, context),
            location=_location(page), **fields,
        )
        session.add(crag)
        session.flush()
        report.crags_created += 1
        return crag
    if is_manually_edited(session, Crag, [crag.id]):
        report.skipped_manual.append(f"skała {crag.name}")
        return crag
    changed = _assign(crag, **fields)
    current = to_shape(crag.location)
    if abs(current.x - page.lng) > 1e-9 or abs(current.y - page.lat) > 1e-9:
        crag.location = _location(page)
        changed = True
    if changed:
        report.crags_updated += 1
    return crag


def _location(page: RockPage) -> WKTElement:
    return WKTElement(f"POINT({page.lng} {page.lat})", srid=4326)


def _store_wall(session: Session, media_root: Path, crag: Crag, index: int, wall_input: WallInput, report: ImportReport) -> None:
    ref = wall_input.ref
    label = f"{crag.name} / {ref.name or ref.source_id}"
    fields = dict(crag_id=crag.id, name=ref.name, description=ref.description, sort_order=index, source_url=ref.image_url)
    wall = _find(session, Wall, str(ref.source_id))
    if wall is None:
        wall = Wall(source=SOURCE, source_id=str(ref.source_id), **fields)
        session.add(wall)
        session.flush()
    elif is_manually_edited(session, Wall, [wall.id]):
        report.skipped_manual.append(f"ściana {label}")
    else:
        _assign(wall, **fields)
    report.walls += 1

    if wall.image_path is None and wall_input.image is not None:
        try:
            stored = store_wall_image(media_root, wall.id, wall_input.image)
        except InvalidImage:
            report.errors.append(f"{label}: nieprawidłowe zdjęcie")
        else:
            _assign(
                wall, image_original_path=stored.original_path, image_path=stored.image_path,
                thumb_path=stored.thumb_path, image_width=stored.width, image_height=stored.height,
            )

    routes = _store_routes(session, crag, wall_input.topo, report)
    if wall.image_width and wall.image_height:
        _store_lines(session, label, wall, wall_input.topo, routes, report)
    elif wall_input.topo.lines:
        report.bad_lines.append(f"{label}: brak zdjęcia, pominięto {len(wall_input.topo.lines)} linii")


def _store_routes(session: Session, crag: Crag, topo: WallTopo, report: ImportReport) -> dict[int, Route]:
    numbers = {line.source_id: line.order for line in topo.lines}
    routes: dict[int, Route] = {}
    for data in topo.routes:
        sort = grade_sort(data.grade)
        if data.grade and sort is None:
            report.unknown_grades.append(f"{crag.name} / {data.name}: {data.grade}")
        fields = dict(
            crag_id=crag.id, number=numbers.get(data.source_id), name=data.name, grade=data.grade,
            grade_sort=sort, protection=data.protection, first_ascent=data.first_ascent,
            year=data.year, length_m=data.length_m,
        )
        route = _find(session, Route, str(data.source_id))
        if route is None:
            route = Route(source=SOURCE, source_id=str(data.source_id), **fields)
            session.add(route)
        elif is_manually_edited(session, Route, [route.id]):
            report.skipped_manual.append(f"droga {route.name} ({crag.name})")
        else:
            _assign(route, **fields)
        routes[data.source_id] = route
        report.routes += 1
    session.flush()
    return routes


def _store_lines(session: Session, label: str, wall: Wall, topo: WallTopo, routes: dict[int, Route], report: ImportReport) -> None:
    existing = session.scalars(select(RouteLine).where(RouteLine.wall_id == wall.id)).all()
    point_ids = [point.id for line in existing for point in line.points]
    if is_manually_edited(session, RouteLine, [line.id for line in existing]) or is_manually_edited(
        session, LinePoint, point_ids
    ):
        report.skipped_manual.append(f"topo ściany {label}")
        return

    lines: dict[int, RouteLine] = {}
    points: dict[int, LinePoint] = {}
    for data in topo.lines:
        normalized = _normalize(data, wall.image_width, wall.image_height)
        if normalized is None:
            report.bad_lines.append(f"{label}: linia {data.source_id} wychodzi poza zdjęcie")
            continue
        line = _find(session, RouteLine, str(data.source_id))
        if line is None:
            line = RouteLine(source=SOURCE, source_id=str(data.source_id))
            session.add(line)
        _assign(
            line, wall_id=wall.id, route=routes.get(data.source_id), color=data.color,
            sort_order=data.order * 10 + data.branch_order,
        )
        keep: set[str] = set()
        for index, (point_data, (x, y)) in enumerate(zip(data.points, normalized)):
            if point_data.raw_kind and point_data.raw_kind.lower() not in KNOWN_POINT_KINDS:
                report.unknown_point_kinds.append(f"{label}: {point_data.raw_kind}")
            point = _find(session, LinePoint, str(point_data.source_id))
            if point is None:
                point = LinePoint(source=SOURCE, source_id=str(point_data.source_id))
            _assign(point, line=line, sort_order=index, x=x, y=y, kind=point_data.kind, visible=point_data.visible)
            points[point_data.source_id] = point
            keep.add(str(point_data.source_id))
        for stale in [p for p in line.points if p.source == SOURCE and p.source_id not in keep]:
            line.points.remove(stale)
        lines[data.source_id] = line
        report.lines += 1
        report.points += len(data.points)
    session.flush()

    for data in topo.lines:
        line = lines.get(data.source_id)
        if line is None:
            continue
        parent_line = lines.get(data.parent_source_id) if data.parent_source_id else None
        parent_point = points.get(data.parent_point_source_id) if data.parent_point_source_id else None
        if parent_line is None or parent_point is None or parent_point.line is not parent_line:
            parent_line, parent_point = None, None
        _assign(line, parent_line=parent_line, parent_point=parent_point)

    present = {str(data.source_id) for data in topo.lines}
    for stale in existing:
        if stale.source == SOURCE and stale.source_id not in present:
            session.delete(stale)
    session.flush()


def _normalize(data: LineData, width: int, height: int) -> list[tuple[float, float]] | None:
    result = []
    for point in data.points:
        x, y = point.x / width, point.y / height
        low, high = -EDGE_TOLERANCE, 1 + EDGE_TOLERANCE
        if not (low <= x <= high and low <= y <= high):
            return None
        result.append((min(max(x, 0.0), 1.0), min(max(y, 0.0), 1.0)))
    return result
```

- [ ] **Step 4: Uruchom testy**

Run: `docker compose run --rm api pytest -v`
Expected: wszystkie PASS.

- [ ] **Step 5: Commit**

```powershell
git add api
git commit -m "feat: zapis importu Portalu Górskiego do bazy z ochroną ręcznych zmian" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Orkiestracja importu, CLI i podgląd linii

**Files:**
- Create: `api/topo/importer/portalgorski/run.py`, `api/topo/importer/preview.py`
- Modify: `api/topo/cli.py` (pełna wersja), `api/topo/config.py` (`cache_dir`), `docker-compose.yml` (wolumeny `./cache` i `./media`), `README.md` (sekcja „Import”)
- Test: `api/tests/test_import_run.py`, `api/tests/test_cli.py`

**Interfaces:**
- Consumes: `CachedFetcher`, `FetchError` (Task 2); `parse_*`, `START_URL`, `PATHS_URL` (Task 3); `store_rock`, `ImportReport`, `WallInput`, `IMPORT_AUTHOR` (Task 5); `set_author` (Task 1); `refresh_area_geom`, `SessionLocal` (plan 1); `slugify` z pakietu python-slugify.
- Produces:
  - `topo.importer.portalgorski.run.import_portalgorski(session_factory: Callable[[], ContextManager[Session]], fetcher: Fetcher, media_root: Path, *, only_area: str | None = None, limit: int | None = None, log: Callable[[str], None] = print) -> ImportReport`, gdzie `Fetcher` to dowolny obiekt z `get(url) -> bytes` i `post(url, data) -> bytes`
  - `topo.importer.portalgorski.run.format_report(report: ImportReport) -> str`
  - `topo.importer.preview.render_wall_preview(wall: Wall, media_root: Path) -> PIL.Image.Image`
  - `Settings.cache_dir: str = "/data/cache"`
  - CLI: `topo import portalgorski [--only-area TEKST] [--limit N] [--offline] [--delay S]`, `topo draw-wall WALL_ID OUTPUT`

- [ ] **Step 1: Konfiguracja i compose**

`config.py`: dodaj pole `cache_dir: str = "/data/cache"`.

`docker-compose.yml`, serwis `api`, sekcja `volumes` ma być:
```yaml
    volumes:
      - ./api:/app
      - ./media:/data/media
      - ./cache:/data/cache
```
i usuń nazwany wolumen `media:` z sekcji `volumes:` na dole pliku (zostaje `db-data:`).

- [ ] **Step 2: Testy**

`api/tests/test_import_run.py`:
```python
import io
import json
from contextlib import contextmanager
from pathlib import Path

from PIL import Image
from sqlalchemy import func, select, text
from sqlalchemy_continuum import version_class

from topo.importer.fetch import FetchError
from topo.importer.portalgorski.parse import BASE_URL, PATHS_URL, START_URL
from topo.importer.portalgorski.run import format_report, import_portalgorski
from topo.models import Area, Crag, Route, RouteLine

FIXTURES = Path(__file__).parent / "fixtures" / "portalgorski"
ZABI_URL = BASE_URL + "/Żabi-Koń,Grupa-Żabiego-Konia,Dolina-Kobylańska,Jura-Krakowsko-Częstochowska,skala,111"
SZCZYRZYC_URL = BASE_URL + "/Szczyrzyc,Beskidy,skala,955"
SIZES = {"zabi_kon_3": (1600, 1063), "zabi_kon_1": (1063, 1600), "kapliczka": (1600, 1143),
         "szcz_1": (1008, 1600), "szcz_2": (1600, 990), "szcz_3": (996, 1600), "szcz_4": (1600, 1082)}
EMPTY_PATHS = json.dumps({"status": 1, "data": [], "pathsListBottom": ""}).encode()


class FakeFetcher:
    def __init__(self, failing: set[str] = frozenset()):
        self.failing = failing
        self.requests: list[str] = []

    def get(self, url):
        self.requests.append(url)
        if url in self.failing:
            raise FetchError(f"HTTP 503: GET {url}")
        if url == START_URL:
            return json.dumps({"results": [
                {"lat": "50.15598612", "lng": "19.75617396", "title": "Żabi Koń", "type": "rock", "url": ZABI_URL[len(BASE_URL):]},
                {"lat": "49.802559", "lng": "20.169329", "title": "Szczyrzyc", "type": "rock", "url": SZCZYRZYC_URL[len(BASE_URL):]},
                {"lat": "50.1", "lng": "19.8", "title": "Zła", "type": "rock", "url": "/Zla,skala,([0-9]+)"},
            ]}).encode()
        if url == ZABI_URL:
            return (FIXTURES / "skala111.html").read_bytes()
        if url == SZCZYRZYC_URL:
            return (FIXTURES / "skala955.html").read_bytes()
        for key, size in SIZES.items():
            if key in url:
                buffer = io.BytesIO()
                Image.new("RGB", size, (80, 80, 80)).save(buffer, "JPEG")
                return buffer.getvalue()
        raise AssertionError(f"nieoczekiwany adres {url}")

    def post(self, url, data):
        assert url == PATHS_URL
        name = {"46": "paths46.json", "2533": "paths2533.json"}.get(data["imageId"])
        return (FIXTURES / name).read_bytes() if name else EMPTY_PATHS


def factory_for(session):
    @contextmanager
    def factory():
        yield session

    return factory


def run(session, tmp_path, fetcher=None, **kw):
    return import_portalgorski(factory_for(session), fetcher or FakeFetcher(), tmp_path, log=lambda _: None, **kw)


def count(session, model):
    return session.scalar(select(func.count()).select_from(model))


def test_import_two_rocks(session, tmp_path):
    report = run(session, tmp_path)

    assert count(session, Crag) == 2
    assert count(session, Area) == 4
    assert count(session, Route) == 10
    assert count(session, RouteLine) == 10
    assert report.invalid_urls == ["/Zla,skala,([0-9]+)"]
    assert report.errors == []
    region = session.scalar(select(Area).where(Area.source_id == "region:100"))
    crag_count = session.scalar(text("SELECT crag_count FROM area_geom WHERE area_id = :id"), {"id": region.id})
    assert crag_count == 1


def test_reimport_is_idempotent(session, tmp_path):
    run(session, tmp_path)
    slugs = sorted(session.scalars(select(Crag.slug)).all())
    route_ids = sorted(session.scalars(select(Route.id)).all())
    versions = count(session, version_class(Route))

    report = run(session, tmp_path)

    assert sorted(session.scalars(select(Crag.slug)).all()) == slugs
    assert sorted(session.scalars(select(Route.id)).all()) == route_ids
    assert count(session, version_class(Route)) == versions
    assert (report.crags_created, report.crags_updated) == (0, 0)


def test_fetch_error_for_one_rock_does_not_stop_import(session, tmp_path):
    report = run(session, tmp_path, FakeFetcher(failing={SZCZYRZYC_URL}))
    assert count(session, Crag) == 1
    assert len(report.errors) == 1 and "Szczyrzyc" in report.errors[0]


def test_only_area_and_limit(session, tmp_path):
    run(session, tmp_path, only_area="Dolina Kobylańska")
    assert session.scalars(select(Crag.name)).all() == ["Żabi Koń"]

    run(session, tmp_path, limit=1)
    assert count(session, Crag) == 1


def test_format_report_is_polish(session, tmp_path):
    text = format_report(run(session, tmp_path))
    assert "Skały: 2 nowych" in text
    assert "Pominięte błędne adresy z listy skał (1)" in text
```

`api/tests/test_cli.py`:
```python
import io

from PIL import Image
from typer.testing import CliRunner

from tests import factories as f
from topo.cli import app
from topo.importer.preview import render_wall_preview


def test_cli_help_lists_commands():
    result = CliRunner().invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "import" in result.output and "draw-wall" in result.output


def test_render_wall_preview_draws_line(session, tmp_path):
    (tmp_path / "walls" / "1").mkdir(parents=True)
    Image.new("RGB", (100, 200), (0, 0, 0)).save(tmp_path / "walls" / "1" / "display.webp", "WEBP")
    wall = f.wall(session, f.crag(session, f.area(session, "R"), "C"), image_path="walls/1/display.webp")
    f.line(session, wall, color="#ff0000", points=((0.5, 0.9, "start"), (0.5, 0.1, "stanowisko")))

    image = render_wall_preview(wall, tmp_path)
    assert image.size == (100, 200)
    red, green, blue = image.getpixel((50, 100))
    assert red > 200 and green < 60 and blue < 60
```

- [ ] **Step 3: Implementacja**

`api/topo/importer/portalgorski/run.py`:
```python
"""Portal Górski import: list → rock pages → walls (topo + photo) → database, one transaction per rock."""

from collections.abc import Callable, Mapping
from contextlib import AbstractContextManager
from pathlib import Path
from typing import Protocol

from slugify import slugify
from sqlalchemy.orm import Session

from topo.db import refresh_area_geom
from topo.history import set_author
from topo.importer.fetch import FetchError
from topo.importer.portalgorski.parse import PATHS_URL, START_URL, parse_paths, parse_rock_page, parse_start
from topo.importer.portalgorski.store import IMPORT_AUTHOR, ImportReport, WallInput, store_rock
from topo.importer.portalgorski.types import RockRef


class Fetcher(Protocol):
    def get(self, url: str) -> bytes: ...

    def post(self, url: str, data: Mapping[str, str]) -> bytes: ...


def import_portalgorski(
    session_factory: Callable[[], AbstractContextManager[Session]],
    fetcher: Fetcher,
    media_root: Path,
    *,
    only_area: str | None = None,
    limit: int | None = None,
    log: Callable[[str], None] = print,
) -> ImportReport:
    report = ImportReport()
    start = parse_start(fetcher.get(START_URL))
    report.invalid_urls.extend(start.invalid_urls)
    rocks = _select(start.rocks, only_area, limit)

    for number, rock in enumerate(rocks, 1):
        log(f"[{number}/{len(rocks)}] {rock.name}")
        try:
            page = parse_rock_page(fetcher.get(rock.url))
        except (FetchError, ValueError) as exc:
            report.errors.append(f"{rock.name}: {exc}")
            continue
        walls = [_fetch_wall(fetcher, rock, ref, report) for ref in page.walls]
        with session_factory() as session:
            set_author(session, IMPORT_AUTHOR)
            try:
                store_rock(session, media_root, page, walls, report)
                session.commit()
            except Exception as exc:  # one broken rock must not stop the whole import
                session.rollback()
                report.errors.append(f"{rock.name}: {exc}")

    with session_factory() as session:
        refresh_area_geom(session)
        session.commit()
    return report


def _select(rocks: list[RockRef], only_area: str | None, limit: int | None) -> list[RockRef]:
    if only_area:
        needle = slugify(only_area)
        rocks = [rock for rock in rocks if needle in slugify(rock.url)]
    return rocks[:limit] if limit else rocks


def _fetch_wall(fetcher: Fetcher, rock: RockRef, ref, report: ImportReport) -> WallInput:
    label = f"{rock.name} / {ref.name or ref.source_id}"
    try:
        topo = parse_paths(fetcher.post(PATHS_URL, {"imageId": str(ref.source_id), "pathId": "0"}))
    except (FetchError, ValueError) as exc:
        report.errors.append(f"{label}: topo: {exc}")
        topo = parse_paths(b'{"status": 0}')
    image = None
    if ref.image_url:
        try:
            image = fetcher.get(ref.image_url)
        except FetchError as exc:
            report.errors.append(f"{label}: zdjęcie: {exc}")
    return WallInput(ref=ref, topo=topo, image=image)


def format_report(report: ImportReport) -> str:
    lines = [
        f"Skały: {report.crags_created} nowych, {report.crags_updated} zaktualizowanych",
        f"Ściany: {report.walls}, drogi: {report.routes}, linie: {report.lines}, punkty: {report.points}",
    ]
    sections = [
        ("Pominięte błędne adresy z listy skał", report.invalid_urls),
        ("Nie nadpisano (ręczne zmiany)", report.skipped_manual),
        ("Nieznane wyceny", report.unknown_grades),
        ("Nieznane typy punktów", report.unknown_point_kinds),
        ("Linie poza zdjęciem lub bez zdjęcia", report.bad_lines),
        ("Błędy", report.errors),
    ]
    for title, items in sections:
        if items:
            lines.append(f"{title} ({len(items)}):")
            lines.extend(f"  - {item}" for item in items)
    return "\n".join(lines)
```

`api/topo/importer/preview.py`:
```python
"""Draw a wall's lines and bolts on its photo — a quick visual check of imported topo."""

from pathlib import Path

from PIL import Image, ImageDraw

from topo.models import Wall


def render_wall_preview(wall: Wall, media_root: Path) -> Image.Image:
    image = Image.open(Path(media_root) / wall.image_path).convert("RGB")
    draw = ImageDraw.Draw(image)
    for line in wall.lines:
        xy = [(point.x * image.width, point.y * image.height) for point in line.points]
        if len(xy) > 1:
            draw.line(xy, fill=line.color, width=3)
        for point, (x, y) in zip(line.points, xy):
            if point.visible:
                draw.ellipse((x - 5, y - 5, x + 5, y + 5), outline="yellow", width=2)
    return image
```

`api/topo/cli.py` (cały plik):
```python
from pathlib import Path

import typer

from topo.config import get_settings
from topo.db import SessionLocal
from topo.importer.fetch import CachedFetcher
from topo.importer.portalgorski.run import format_report, import_portalgorski
from topo.importer.preview import render_wall_preview
from topo.models import Wall

app = typer.Typer(help="Narzędzia projektu Topo", no_args_is_help=True)
import_app = typer.Typer(help="Import danych z zewnętrznych portali", no_args_is_help=True)
app.add_typer(import_app, name="import")


@import_app.command("portalgorski")
def import_portalgorski_command(
    only_area: str | None = typer.Option(None, "--only-area", help="Tylko skały, których adres zawiera ten obszar"),
    limit: int | None = typer.Option(None, "--limit", help="Najwyżej tyle skał"),
    offline: bool = typer.Option(False, "--offline", help="Tylko z cache, bez sieci"),
    delay: float = typer.Option(1.5, "--delay", help="Przerwa między zapytaniami [s]"),
) -> None:
    """Importuje skały, ściany, zdjęcia i drogi z topo.portalgorski.pl."""
    settings = get_settings()
    fetcher = CachedFetcher(Path(settings.cache_dir) / "portalgorski", delay=delay, offline=offline)
    report = import_portalgorski(
        SessionLocal, fetcher, Path(settings.media_root), only_area=only_area, limit=limit, log=typer.echo
    )
    typer.echo(format_report(report))


@app.command("draw-wall")
def draw_wall_command(wall_id: int, output: Path) -> None:
    """Zapisuje zdjęcie ściany z narysowanymi liniami i wpinkami (do sprawdzenia importu)."""
    settings = get_settings()
    with SessionLocal() as session:
        wall = session.get(Wall, wall_id)
        if wall is None or wall.image_path is None:
            raise typer.BadParameter("Nie ma takiej ściany albo nie ma zdjęcia")
        render_wall_preview(wall, Path(settings.media_root)).save(output)
    typer.echo(f"Zapisano {output}")
```

`README.md` — dopisz sekcję:
````markdown
## Import z Portalu Górskiego

```powershell
docker compose run --rm api topo import portalgorski --only-area "Dolina Kobylańska"   # próbnie
docker compose run --rm api topo import portalgorski                                   # całość, ok. 2–3 h
docker compose run --rm api topo draw-wall 1 /data/cache/podglad-1.png                  # podgląd linii → ./cache/
```

Surowe odpowiedzi trafiają do `./cache/`, zdjęcia do `./media/`. Ponowne uruchomienie korzysta z cache i nie nadpisuje ręcznych poprawek.
````

- [ ] **Step 4: Uruchom testy**

Run: `docker compose run --rm api pytest -v`
Expected: wszystkie PASS.

- [ ] **Step 5: Commit**

```powershell
git add api docker-compose.yml README.md
git commit -m "feat: komenda importu z Portalu Górskiego i podgląd linii" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Próbny import na prawdziwych danych

**Files:**
- Modify (tylko jeśli import wykaże błąd): pliki z Task 3/5/6 + test odtwarzający problem
- Create: `docs/superpowers/plans/2026-10-08-plan-2-raport-importu.md` (raport z próbnego importu)

**Interfaces:**
- Consumes: CLI z Task 6.
- Produces: wypełniona baza dla regionu Dolina Kobylańska, raport z liczbami i obserwacjami.

- [ ] **Step 1: Import jednego regionu**

```powershell
docker compose up -d db
docker compose run --rm api alembic upgrade head
docker compose run --rm api topo import portalgorski --only-area "Dolina Kobylańska"
```
Expected: przebieg skała po skale, na końcu raport. Zapisz pełny raport (ostatnie linie wyjścia).

- [ ] **Step 2: Sprawdź dane przez API**

```powershell
docker compose up -d api
curl.exe "http://localhost:8000/api/map/areas?kind=region"
curl.exe http://localhost:8000/api/crags/zabi-kon
```
Expected: region „Dolina Kobylańska” z liczbą skał i dróg; skała z 3 ścianami, 9 liniami na ścianie „Żabi Koń”, adresami `/media/walls/...`.

- [ ] **Step 3: Podgląd linii na zdjęciach**

Wybierz id trzech ścian (ściana „Żabi Koń” i dwie inne z liniami):
```powershell
docker compose exec db psql -U topo -d topo -c "SELECT w.id, c.name, w.name, count(l.id) FROM wall w JOIN crag c ON c.id = w.crag_id LEFT JOIN route_line l ON l.wall_id = w.id GROUP BY w.id, c.name, w.name ORDER BY count(l.id) DESC LIMIT 10;"
docker compose run --rm api topo draw-wall <ID> /data/cache/podglad-<ID>.png
```
Expected: pliki `./cache/podglad-<ID>.png`. Obejrzyj je (narzędziem Read) — linie i kółka wpinek muszą leżeć na skale, wzdłuż dróg, a nie przesunięte lub przeskalowane.

- [ ] **Step 4: Ponowny import (idempotencja na prawdziwych danych)**

```powershell
docker compose run --rm api topo import portalgorski --only-area "Dolina Kobylańska" --offline
```
Expected: „Skały: 0 nowych, 0 zaktualizowanych”, brak błędów, przebieg bez sieci (wszystko z cache).

- [ ] **Step 5: Raport**

`docs/superpowers/plans/2026-10-08-plan-2-raport-importu.md`: liczby z raportu importu, czas trwania, rozmiar `./cache` i `./media`, lista nieznanych wycen/typów punktów, wnioski z podglądów (czy linie trafiają w skałę), wynik ponownego importu. Jeśli coś było źle — opisz przyczynę, dodaj test odtwarzający problem, popraw kod i powtórz kroki 1–4.

- [ ] **Step 6: Commit**

```powershell
git add docs api
git commit -m "docs: raport z próbnego importu (Dolina Kobylańska)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Po zakończeniu planu 2

- Pełny import wszystkich ~635 skał (2–3 h, ok. 3,8 GB) uruchamia autor, kiedy zechce: `docker compose run --rm api topo import portalgorski`. Dzięki cache można go przerwać i wznowić.
- Następny krok: plan 3 — rozmowa o designie i mockupy (spec §6.0), potem szkielet frontu i mapa.

## Wnioski z wykonania (do uwzględnienia w kolejnych planach)

Decyzje podjęte podczas wykonania (po przeglądach):
- Każda ściana z `topoEditor_<id>` na stronie skały trafia do bazy, nawet gdy nie da się odczytać jej nazwy/opisu.
- Import nigdy nie odtwarza rekordu, który ktoś usunął ręcznie (jakakolwiek ręczna wersja dla `(source, source_id)`); topo ściany jest zamrożone, jeśli którakolwiek jej linia lub punkt ma ręczną wersję (także usunięte).
- Ta sama droga na kilku zdjęciach jednej skały (ta sama nazwa po normalizacji i wycena) to jeden rekord `route`; numer zostaje z pierwszej ściany — numerację „jak na topo” liczy front osobno dla każdego zdjęcia (plan 4).
- Typy punktów z prawdziwych danych: `spit`→`ring`, `ring zjazdowy`→`stanowisko`, `pętla`→`ucho`, `niewidoczny fragment drogi`→`przelot`; nieznany widoczny typ → niewidoczny `przelot` + wpis w raporcie.
- Gdy portal nie odda topo ściany (błąd, `status != 1`), istniejące drogi i linie tej ściany zostają nietknięte, a złą odpowiedź usuwa się z cache.
- Historia: własny `_TopoUnitOfWork` (Continuum zapisuje wersje w transakcji wywołującego) — zależy od wnętrza Continuum 1.8.

Do zrobienia przed pełnym importem (~635 skał):
- ~~Nie łączyć dróg bez wyceny~~ — zrobione (commit po planie 2).

Do zdecydowania w kolejnych planach:
- **Plan 5 (głębia):** zapisy workera głębi do `wall` podpisywać autorem z prefiksem `import:` (np. `import:depth`) albo wyłączyć `depth_*` z wersjonowania (`__versioned__ = {"exclude": [...]}`) — inaczej ściany wyglądają na „ręcznie edytowane” i import przestaje je aktualizować.
- **Plan 6/7 (edycja, wgrywanie):** `is_manually_edited` ma liczyć wersje bez wiersza `transaction` jako ręczne (dziś po wycofanym `begin_nested()` mogą zostać osierocone wersje); przypiąć `sqlalchemy-continuum<1.9` lub test zamieniający SAWarning w błąd; `issued_at` → `timestamptz`; indeksy `(source, source_id)` na tabelach `*_version`; `store_wall_image` ma opakowywać `DecompressionBombError`/błędy EXIF jako `InvalidImage`, zapisywać atomowo i usuwać stary `original.<ext>`; sprzątanie plików po wycofanym imporcie.
- Migracja 0003 w dół nie przejdzie, gdy istnieją punkty `ogranicznik`.
- Drobne: `wall.source_url` wskazuje na zdjęcie, nie stronę skały; `--only-area` dopasowuje podciąg całego adresu.
