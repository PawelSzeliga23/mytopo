# Plan 6: logowanie, edycja danych, historia i cofanie — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Znajomi ze wspólnym hasłem logują się nickiem, poprawiają pola obszarów, skał, dróg i ścian, przesuwają i dodają skały na mapie, usuwają je, zakładają sektory (z istniejących skał albo zamieniając skałę z kilkoma ścianami w sektor), a każdą zmianę widać w historii (przy skale i w „Ostatnich zmianach”) i da się ją cofnąć — także pojedynczo, z ostrzeżeniem o późniejszych zmianach.

**Architecture:** Historia stoi na SQLAlchemy-Continuum z planu 2 (tabele `*_version` + `transaction` z `author`, `comment`, a od tego planu `reverts_id`). Każde żądanie zapisu to jedna transakcja bazy = jeden wpis historii. Logika jest w czystych modułach API: `topo/auth.py` (ciasteczko, limit prób), `topo/editing.py` (stosowanie pól, położenie, wycena, usuwanie przez ORM, żeby powstawały wersje), `topo/sectors.py` (nowy sektor, zamiana skały w sektor), `topo/changes.py` (co zmieniła transakcja, różnice pól, lista z filtrami), `topo/revert.py` (cofanie w trzech fazach: wstawienia rodzic→dziecko, zmiany pól, usunięcia dziecko→rodzic; konflikty liczone przed jakąkolwiek zmianą). Routery FastAPI są cienkie. Front: sesja w `web/src/lib/session.tsx` (TanStack Query `["me"]` + okienko logowania z ponowieniem zapisu po 401), edycja skały jako tryb całej strony (B), drogi w panelu bocznym (C), historia w panelu i na stronie `/zmiany`, edycja na mapie jako tryby `MapPage`.

**Tech Stack:** jak w planach 1–5 + `itsdangerous` (API), shadcn/ui `dialog`, `sheet`, `dropdown-menu`, `sonner`, `input`, `textarea`, `label` (front), `@playwright/test` (E2E).

**Spec:** `docs/superpowers/specs/2026-10-09-plan-6-edycja-historia-design.md` (całość), tło: `docs/superpowers/specs/2026-10-08-topo-design.md` §4–§6, wygląd: `docs/superpowers/specs/2026-10-08-frontend-design.md`, mockupy: `.superpowers/brainstorm/1537-1791538331/content/` (`edycja-skaly.html`, `historia.html`, `mapa-edycja.html`, `nowy-sektor.html`).

## Global Constraints

- Ciasteczko `topo_edit`: `itsdangerous.URLSafeTimedSerializer(SECRET_KEY, salt="topo-edit")`, HttpOnly, SameSite=Lax, `Secure` gdy `PUBLIC_URL` zaczyna się od `https://`, ważne 365 dni; zawartość `{"nick", "pw"}`, `pw` = pierwsze 16 znaków hex `HMAC-SHA256(SECRET_KEY, EDIT_PASSWORD)`.
- Logowanie: > 5 prób na minutę z jednego IP → 429; złe hasło → 401 „Złe hasło”; nick 2–40 znaków po przycięciu, nie zaczyna się od `import:`; brak `EDIT_PASSWORD` → 503 „Edycja wyłączona”; `EDIT_PASSWORD` bez `SECRET_KEY` → błąd przy starcie API.
- Każdy zapis wymaga sesji (401 „Zaloguj się, aby edytować”) i przyjmuje opcjonalne `comment` (≤ 500 znaków). Jedno żądanie = jedna transakcja historii, autor = nick.
- `PATCH` zmienia tylko przysłane pola (`model_dump(exclude_unset=True)`); front wysyła tylko zmienione pola.
- Zmiana nazwy nie zmienia `slug`. Nowe obiekty: `slug = unique_slug(...)`, `source = "manual"`.
- Usuwanie zawsze przez ORM (`session.delete` z załadowanymi dziećmi), nigdy przez `ON DELETE CASCADE` w bazie — inaczej Continuum nie zapisze wersji i nie da się cofnąć. Pliki zdjęć i głębi zostają na dysku.
- Pola pomijane w różnicach i cofaniu (`SKIP_FIELDS`): `version`, `source`, `source_id`, `source_url`, `grade_sort`, `image_original_path`, `image_path`, `thumb_path`, `image_width`, `image_height`, `depth_path`, `depth_status`, `depth_model`, `vegetation_ratio`, `route_vegetation_ratio`, `depth_enabled`, `needs_location`.
- Po zmianie położenia skały, jej obszaru, usunięciu/przywróceniu skały, utworzeniu/usunięciu obszaru: `refresh_area_geom(session)` przed `commit`.
- Kolory: pinezka „do rozstawienia” `#E0A100`; różnice — stara wartość `del` (tło `#F2D9D4`, tekst `#B23A2B`, przekreślenie), nowa `ins` (tło `#D8E6EC`, tekst `#245B72`); w ciemnym motywie odpowiedniki z pasm (`#4A2520`/`#F2A59A`, `#1F3A47`/`#8CCBE6`).
- Wszystkie teksty interfejsu i komunikaty API po polsku.
- Testy: `docker compose run --rm api pytest -q`, `cd web; npm test`. **Zasada testów:** pisane razem z kodem, uruchamiane raz na końcu zadania.

## Review Focus

1. **Sesja wygasła lub hasło zmieniono w trakcie edycji** (otwarty formularz w drugiej karcie) — zapis dostaje 401, pojawia się okienko logowania, po zalogowaniu zapis idzie ponownie, a wpisane dane nie giną — Task 7 `session.test.tsx`.
2. **Przywrócenie usuniętej skały z wariantami dróg** (linia z `parent_line_id`/`parent_point_id`) — przywrócenie nie wywraca się na kluczach obcych, wariant znowu wskazuje punkt rodzica — Task 6 `test_revert.py::test_restore_crag_with_variant_line`.
3. **Podwójne cofnięcie tej samej zmiany i cofnięcie cofnięcia** — drugie cofnięcie nic nie psuje (pusta zmiana albo konflikt, nigdy 500), cofnięcie cofnięcia przywraca stan po zmianie — Task 6 `test_revert_twice_is_harmless`, `test_revert_of_revert`.
4. **Nazwa z polskimi znakami albo już zajęta** (nowa skała „Żabi Koń” obok istniejącej, zmiana nazwy) — nowy obiekt dostaje wolny `slug` (`zabi-kon-2`), stary link po zmianie nazwy dalej działa — Task 3 `test_create_crag_unique_slug`, `test_rename_keeps_slug`.
5. **Usunięcie drogi, od której odchodzi wariant innej drogi** — wariant zostaje, traci tylko powiązanie z rodzicem (z wersją w historii), a cofnięcie usunięcia przywraca powiązanie — Task 3 `test_delete_route_detaches_variants`, Task 6 `test_restore_route_reattaches_variant`.

---

### Task 1: Migracja, ustawienia i długi z planu 2

**Files:**
- Create: `api/alembic/versions/0005_edycja.py`
- Modify: `api/topo/config.py`, `.env.example`, `api/pyproject.toml` (+ `itsdangerous>=2.2`, `sqlalchemy-continuum>=1.8,<1.9`), `api/uv.lock`, `api/topo/history.py`, `api/topo/models/crag.py`, `api/topo/depth.py`, `api/topo/api/app.py`
- Test: `api/tests/test_history.py`, `api/tests/test_models.py`, `api/tests/conftest.py`

**Interfaces (Produces):**
- `Settings.edit_password: str | None = None`, `Settings.secret_key: str | None = None`.
- `Crag.needs_location: Mapped[bool]` (domyślnie `False`, `server_default="false"`).
- `transaction.reverts_id` (BigInteger, nullable, indeks) — id transakcji cofanej przez tę transakcję.
- `set_author(session, author, comment=None, reverts_id=None)`.
- `update_wall_fields(session, wall_id: int, **values) -> None` w `topo/depth.py` — Core UPDATE bez `commit`; `set_wall_fields` woła go i robi `commit` + `refresh` jak dotąd.

- [ ] **Step 1: Testy**

W `api/tests/test_history.py` dopisz:

```python
def test_orphan_version_counts_as_manual(session):
    set_author(session, IMPORT_AUTHOR_PREFIX + "portalgorski")
    crag = f.crag(session, f.area(session, "Dolina"), "Skała")
    session.commit()
    CragVersion = version_class(Crag)
    # A version whose transaction row is gone (left by a rolled-back SAVEPOINT) must not look like import data.
    session.execute(
        CragVersion.__table__.insert().values(
            id=crag.id, transaction_id=999_999, operation_type=1, area_id=crag.area_id, name="x", slug="x",
            location="SRID=4326;POINT(19.7 50.1)",
        )
    )
    assert is_manually_edited(session, Crag, [crag.id])


def test_reverts_id_is_stored(session):
    set_author(session, "ania", "cofnięcie #5", reverts_id=5)
    f.area(session, "Dolina")
    session.commit()
    tx = session.scalars(select(transaction_class()).order_by(transaction_class().id.desc())).first()
    assert (tx.author, tx.reverts_id) == ("ania", 5)


def test_issued_at_has_timezone(session):
    set_author(session, "ania")
    f.area(session, "Dolina")
    session.commit()
    tx = session.scalars(select(transaction_class()).order_by(transaction_class().id.desc())).first()
    assert tx.issued_at.tzinfo is not None
```

W `api/tests/conftest.py` na górze dodaj zamianę ostrzeżeń SQLAlchemy w błędy (łapie m.in. „nested transaction already deassociated” z Continuum):

```python
import warnings
from sqlalchemy.exc import SAWarning

warnings.filterwarnings("error", category=SAWarning)
```

W `api/tests/test_models.py`: `test_crag_needs_location_defaults_false` (nowa skała z fabryki ma `needs_location is False`).

- [ ] **Step 2: Migracja `0005_edycja.py`** (`revision = "0005"`, `down_revision = "0004"`)

```python
def upgrade() -> None:
    op.alter_column("transaction", "issued_at", type_=sa.DateTime(timezone=True), postgresql_using="issued_at AT TIME ZONE 'UTC'")
    op.add_column("transaction", sa.Column("reverts_id", sa.BigInteger(), nullable=True))
    op.create_index("ix_transaction_reverts_id", "transaction", ["reverts_id"])
    op.add_column("crag", sa.Column("needs_location", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("crag_version", sa.Column("needs_location", sa.Boolean(), nullable=True))
    for table in ("area", "crag", "wall", "route", "route_line", "line_point"):
        op.create_index(f"ix_{table}_version_source", f"{table}_version", ["source", "source_id"])


def downgrade() -> None:
    for table in ("area", "crag", "wall", "route", "route_line", "line_point"):
        op.drop_index(f"ix_{table}_version_source", f"{table}_version")
    op.drop_column("crag_version", "needs_location")
    op.drop_column("crag", "needs_location")
    op.drop_index("ix_transaction_reverts_id", "transaction")
    op.drop_column("transaction", "reverts_id")
    op.alter_column("transaction", "issued_at", type_=sa.DateTime(timezone=False))
```

Indeks `(transaction_id)` na tabelach wersji już istnieje (migracja 0002) — nie dublować.

- [ ] **Step 3: Kod**

- `history.py`: w `_TopoTransactionFactory.create_class` dodaj `transaction.reverts_id = sa.Column(sa.BigInteger, index=True)` i podmień `issued_at` na strefowy: `transaction.issued_at = sa.Column(sa.DateTime(timezone=True), default=lambda: datetime.now(UTC))` (jeśli Continuum 1.8 definiuje `issued_at` jako atrybut klasy bazowej, nadpisz go przed `return`; sprawdź `alembic check` — brak różnic po migracji). `_AuthorPlugin.transaction_args` zwraca też `"reverts_id": session.info.get("reverts_id")`; `set_author(..., reverts_id=None)` zapisuje go w `session.info`.
- `has_manual_version`: zamień złączenie z warunkiem na `outerjoin`, osierocone wersje (brak wiersza `transaction`) liczone jako ręczne:

```python
transaction = transaction_class()
version = version_class(model)
manual = sa.or_(transaction.id.is_(None), transaction.author.is_(None), sa.not_(transaction.author.startswith(IMPORT_AUTHOR_PREFIX)))
stmt = sa.select(sa.exists(
    sa.select(version.id).select_from(version).outerjoin(transaction, version.transaction_id == transaction.id).where(manual, *conditions)
))
```

- `config.py`: pola `edit_password`, `secret_key`. `.env.example`: `EDIT_PASSWORD=` i `SECRET_KEY=` z komentarzem „hasło edycji dla znajomych; klucz podpisu ciasteczka (długi losowy ciąg)”.
- `app.py` → `create_app()`: `if settings.edit_password and not settings.secret_key: raise RuntimeError("SECRET_KEY jest wymagany, gdy ustawiono EDIT_PASSWORD")`.
- `depth.py`: wydziel `update_wall_fields` z `set_wall_fields`.
- `uv lock` po zmianie `pyproject.toml`.

- [ ] **Step 4: Uruchom** `docker compose run --rm api pytest -q` — wszystko zielone (także stare testy z ostrzeżeniami jako błędami; jeśli któryś stary test emituje `SAWarning`, napraw przyczynę, nie filtr).

- [ ] **Step 5: Commit** `feat: migracja edycji (reverts_id, needs_location, timestamptz, indeksy) i długi z planu 2`

---

### Task 2: Logowanie i sesja edycji (API)

**Files:**
- Create: `api/topo/auth.py`, `api/topo/api/auth.py`, `api/topo/api/deps.py`
- Modify: `api/topo/api/app.py` (router `/api/auth`), `api/tests/conftest.py` (fikstury `edit_settings`, `editor`)
- Test: `api/tests/test_auth.py`

**Interfaces (Produces):**
- `topo.auth`: `COOKIE = "topo_edit"`, `MAX_AGE = 365 * 24 * 3600`, `password_fingerprint(password: str, secret: str) -> str`, `make_token(nick: str, settings: Settings) -> str`, `read_token(token: str | None, settings: Settings) -> str | None` (nick albo `None` — zły podpis, wygasłe, inny odcisk hasła), `clean_nick(raw: str) -> str` (rzuca `ApiError(422, "invalid_nick", ...)`), `LoginLimiter(limit=5, window=60.0)` z `hit(key: str, now: float | None = None) -> bool` (False = przekroczono), instancja modułowa `login_limiter`.
- `topo.api.deps`: `current_editor(request: Request) -> str` (nick; 401 `ApiError(401, "unauthorized", "Zaloguj się, aby edytować")`), `start_change(session: Session, nick: str, comment: str | None) -> None` (= `set_author`; `comment` przycięty, pusty → `None`).
- Endpointy: `POST /api/auth/login {password, nick}` → `{nick}` + ciasteczko; `POST /api/auth/logout` → 204; `GET /api/auth/me` → `{nick}` / 401.
- Fikstury testowe: `edit_settings` (monkeypatch `EDIT_PASSWORD="tajne"`, `SECRET_KEY="klucz-testowy"`, `get_settings.cache_clear()` przed i po), `editor` (klient po `POST /api/auth/login {"password": "tajne", "nick": "ania"}`; czyści `login_limiter`).

- [ ] **Step 1: Testy `test_auth.py`**
  - poprawne logowanie ustawia `topo_edit` (HttpOnly, `Max-Age=31536000`), `GET /me` → `{"nick": "ania"}`;
  - złe hasło → 401 `{"code": "wrong_password", "message": "Złe hasło"}`;
  - szósta próba w minucie z tego samego IP → 429 `too_many_attempts` (także przy dobrym haśle);
  - `LoginLimiter.hit` z `now` — po 60 s licznik się zeruje;
  - nick `" a "` → 422; `"import:x"` → 422; 41 znaków → 422; `"  ania "` → zapisany jako `"ania"`;
  - zmiana `EDIT_PASSWORD` po zalogowaniu (monkeypatch + `cache_clear`) → `GET /me` 401;
  - podrobione ciasteczko → 401; `POST /logout` → `GET /me` 401;
  - brak `EDIT_PASSWORD` → `POST /login` 503 `editing_disabled`;
  - `create_app()` z hasłem bez klucza → `RuntimeError`.

- [ ] **Step 2: Implementacja**

```python
# topo/auth.py
import hashlib, hmac, time
from collections import defaultdict, deque
from itsdangerous import BadSignature, URLSafeTimedSerializer

COOKIE = "topo_edit"
MAX_AGE = 365 * 24 * 3600

def password_fingerprint(password: str, secret: str) -> str:
    return hmac.new(secret.encode(), password.encode(), hashlib.sha256).hexdigest()[:16]

def _serializer(settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.secret_key, salt="topo-edit")

def make_token(nick, settings) -> str:
    return _serializer(settings).dumps({"nick": nick, "pw": password_fingerprint(settings.edit_password, settings.secret_key)})

def read_token(token, settings) -> str | None:
    if not token or not settings.edit_password or not settings.secret_key:
        return None
    try:
        data = _serializer(settings).loads(token, max_age=MAX_AGE)
    except BadSignature:
        return None
    expected = password_fingerprint(settings.edit_password, settings.secret_key)
    if not hmac.compare_digest(str(data.get("pw", "")), expected):
        return None
    return data.get("nick")

class LoginLimiter:
    def __init__(self, limit: int = 5, window: float = 60.0):
        self.limit, self.window = limit, window
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def hit(self, key: str, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        hits = self._hits[key]
        while hits and now - hits[0] >= self.window:
            hits.popleft()
        hits.append(now)
        return len(hits) <= self.limit

    def clear(self) -> None:
        self._hits.clear()

login_limiter = LoginLimiter()
```

Router `topo/api/auth.py`: `login` — najpierw `login_limiter.hit(request.client.host)` (429), potem 503 gdy brak hasła, `hmac.compare_digest` hasła (401), `clean_nick`, `response.set_cookie(COOKIE, make_token(...), max_age=MAX_AGE, httponly=True, samesite="lax", secure=settings.public_url.startswith("https://"), path="/")`. `logout` — `delete_cookie(COOKIE, path="/")`. `me` — `current_editor`.

- [ ] **Step 3: Uruchom** `docker compose run --rm api pytest -q tests/test_auth.py`, potem całość.
- [ ] **Step 4: Commit** `feat: logowanie hasłem i nickiem (ciasteczko sesji edycji, limit prób)`

---

### Task 3: Edycja skał, dróg i ścian (API)

**Files:**
- Create: `api/topo/editing.py`, `api/topo/schemas_edit.py`, `api/topo/api/routes.py`, `api/topo/api/walls.py`
- Modify: `api/topo/api/crags.py` (POST/PATCH/DELETE + `id` i `needs_location` w odpowiedzi), `api/topo/schemas.py` (`CragOut.needs_location`), `api/topo/api/map.py` (`needs_location` w właściwościach skały), `api/topo/api/app.py` (routery `/api/routes`, `/api/walls`)
- Test: `api/tests/test_api_edit.py`

**Interfaces:**
- Consumes: `current_editor`, `start_change` (Task 2), `unique_slug`, `grade_sort`, `normalize_grade`, `refresh_area_geom`.
- Produces (`topo.editing`):
  - `location_from(lnglat: tuple[float, float]) -> WKTElement` — walidacja `-180 ≤ lon ≤ 180`, `-90 ≤ lat ≤ 90`, liczby skończone, inaczej `ApiError(422, "invalid_location", "Nieprawidłowe położenie")`.
  - `location_of(crag_or_version) -> list[float]` — `[lon, lat]` z geometrii (`geoalchemy2.shape.to_shape`), zaokrąglone do 7 miejsc.
  - `apply_grade(route: Route, raw: str | None) -> None` — pusty → `grade = grade_sort = None`; nieznana → `ApiError(422, "invalid_grade", "Nieznana wycena „…” — przykłady: VI, VI.1+, VI.2/3")`.
  - `apply_fields(obj, data: dict) -> set[str]` — ustawia atrybuty, zwraca nazwy faktycznie zmienionych pól.
  - `delete_route(session, route) -> None` — odpina warianty innych dróg (`child.parent_line = None; child.parent_point = None` dla linii, których rodzic jest linią tej drogi), usuwa linie drogi przez `session.delete`, potem drogę.
  - `delete_wall(session, wall) -> None`, `delete_crag(session, crag) -> None` — przed usunięciem odpinają warianty spoza usuwanego zbioru (jak wyżej), potem `session.delete` (kaskada ORM).
  - `area_kind_ok(area) -> bool` — skała może należeć tylko do regionu albo sektora.
- Produces (`topo.schemas_edit`, Pydantic v2): `CragCreate {name, area_id, location: tuple[float, float], comment?}`, `CragPatch` (wszystkie pola opisowe z `CragOut` + `area_id`, `location`, `comment`; wszystkie opcjonalne), `RouteCreate {name, grade?, length_m?, protection?, first_ascent?, year?, description?, comment?}`, `RoutePatch` (to samo opcjonalnie + `number`), `WallPatch {name?, description?, sort_order?, comment?}`, `DeleteBody {comment?}` (DELETE przyjmuje komentarz w query `?comment=`). Nazwy: `str` 1–200 znaków po przycięciu (drogi 300); `year` 1900–2100; `length_m` 1–500; `approach_minutes` 0–600.
- Endpointy (wszystkie: `nick = Depends(current_editor)`, `start_change`, jedna `commit`):
  - `POST /api/crags` → 201 `{id, slug}`; `PATCH /api/crags/{id:int}` → `{id, slug, changed: [...]}`; `DELETE /api/crags/{id:int}` → 204.
  - `POST /api/crags/{id:int}/routes` → 201 `{id}`; `PATCH /api/routes/{id}` → `{id, changed}`; `DELETE /api/routes/{id}` → 204.
  - `PATCH /api/walls/{id}` → `{id, changed}`; `DELETE /api/walls/{id}` → 204.
  - `PATCH` skały z `location` zeruje `needs_location`; z `location` lub `area_id` → `refresh_area_geom`. `area_id` wskazujący obszar typu `obszar` albo nieistniejący → 422 `invalid_area`.
  - `PATCH` bez zmian (`changed == []`) nie tworzy transakcji (nie robi `commit` zmian; zwraca 200 z pustą listą).

- [ ] **Step 1: Testy `test_api_edit.py`** (fikstura `editor`)
  - bez sesji: `PATCH /api/crags/1` → 401;
  - `PATCH` opisu skały → 200, `GET /api/crags/{slug}` pokazuje nowy opis, ostatnia transakcja ma `author == "ania"` i `comment` z żądania;
  - `test_rename_keeps_slug`: zmiana nazwy na „Nowa nazwa” → `slug` bez zmian;
  - `test_create_crag_unique_slug`: istnieje „Żabi Koń” (`zabi-kon`), `POST` drugiej „Żabi Koń” → `slug == "zabi-kon-2"`, `source == "manual"`;
  - `location` `[19.7, 50.1]` → zapis i `needs_location == False`; `[200, 0]` → 422; `area_id` obszaru `obszar` → 422;
  - zmiana wyceny drogi `VI` → `VI.1+` przelicza `grade_sort`; `"VI.x"` → 422 `invalid_grade`; `""` → `grade is None`;
  - `test_delete_route_detaches_variants`: droga A z linią, droga B z wariantem od punktu A; `DELETE A` → B istnieje, jej linia ma `parent_line_id is None`, w `route_line_version` jest wersja B z `operation_type == 1`;
  - `DELETE` skały usuwa ściany, drogi, linie i punkty — każdy z nich ma wiersz wersji `operation_type == 2` w tej samej transakcji; pliki w `media_root/walls/{id}` nietknięte (użyj `tmp_path` jako `MEDIA_ROOT`);
  - `PATCH` ściany (nazwa, opis); `DELETE` ściany usuwa jej linie, drogi zostają;
  - `PATCH` bez zmian nie dodaje transakcji;
  - mapa skał (`/api/map/crags`) ma `needs_location` we właściwościach.

- [ ] **Step 2: Implementacja** — według Interfaces. Wzór endpointu:

```python
@router.patch("/{crag_id:int}")
def patch_crag(crag_id: int, body: CragPatch, nick: str = Depends(current_editor), session: Session = Depends(get_session)):
    crag = session.get(Crag, crag_id) or raise_not_found("skała")
    data = body.model_dump(exclude_unset=True)
    start_change(session, nick, data.pop("comment", None))
    changed: set[str] = set()
    if "location" in data:
        new = data.pop("location")
        if location_of(crag) != [round(v, 7) for v in new]:
            crag.location, crag.needs_location = location_from(new), False
            changed.add("location")
    if "area_id" in data and data["area_id"] != crag.area_id:
        area = session.get(Area, data["area_id"])
        if area is None or not area_kind_ok(area):
            raise ApiError(422, "invalid_area", "Skała może należeć tylko do regionu albo sektora")
    changed |= apply_fields(crag, data)
    geom_changed = bool(changed & {"location", "area_id"})
    if not changed:
        session.rollback()
        return {"id": crag.id, "slug": crag.slug, "changed": []}
    if geom_changed:
        session.flush()
        refresh_area_geom(session)
    session.commit()
    return {"id": crag.id, "slug": crag.slug, "changed": sorted(changed)}
```

(`raise_not_found` = pomocnik zwracający `not_found(...)` przez `raise`; dopisz do `topo/api/errors.py`.)

- [ ] **Step 3: Uruchom** `docker compose run --rm api pytest -q`.
- [ ] **Step 4: Commit** `feat: API edycji skał, dróg i ścian (z historią)`

---

### Task 4: Obszary, nowy sektor i zamiana skały w sektor (API)

**Files:**
- Create: `api/topo/sectors.py`
- Modify: `api/topo/api/areas.py` (POST/PATCH/DELETE), `api/topo/api/crags.py` (`to-sector`, `to-sector/preview`), `api/topo/schemas_edit.py` (`AreaCreate`, `AreaPatch`)
- Test: `api/tests/test_sectors.py`

**Interfaces:**
- Consumes: Task 2–3 (`current_editor`, `start_change`, `delete_crag`, `unique_slug`).
- Produces (`topo.sectors`):
  - `region_of(area: Area) -> Area` — region dla regionu albo rodzic sektora; inaczej `ApiError(422, "invalid_area", ...)`.
  - `make_sector(session, region: Area, name: str, description: str | None, crags: list[Crag]) -> Area` — każda skała musi mieć `region_of(crag.area) == region`, inaczej 422 `crag_outside_region` (z nazwą skały).
  - `ToSectorPreview = TypedDict("ToSectorPreview", {"sector_name": str, "crags": list[str], "copied_routes": int, "unplaced": int})`; `to_sector_preview(crag: Crag) -> ToSectorPreview`.
  - `crag_to_sector(session, crag: Crag) -> tuple[Area, list[Crag]]` — dokładnie jak spec §6.3: sektor w `region_of(crag.area)`; ściany wg `(sort_order, id)` → nowe skały (nazwa ściany albo `f"{crag.name} — ściana {n}"`, pola opisowe `rock_type, height_min, height_max, aspects, formations, approach_minutes, child_friendly, surroundings, description, approach_description` skopiowane, `location` skopiowane, `needs_location = n > 1`, `source = "manual"`, `slug = unique_slug`); ściana przenoszona (`wall.crag = new`); droga → skała pierwszej ściany z jej linią, na kolejnych ścianach kopia drogi (wszystkie pola oprócz `id`, `source*`; `source = "manual"`) i linie tej ściany wskazują kopię; drogi bez linii → pierwsza nowa skała; na końcu `session.flush()`, `session.expire(crag)`, `delete_crag(session, crag)`. Skała z < 2 ścianami → 422 `single_wall` „Skała ma tylko jedną ścianę”.
- Endpointy:
  - `POST /api/areas {kind: "region" | "sektor", parent_id, name, description?, crag_ids?: list[int], comment?}` → 201 `{id, slug}`. `region` → rodzic typu `obszar`; `sektor` → rodzic typu `region` (inaczej 422); `crag_ids` tylko dla sektora.
  - `PATCH /api/areas/{id:int} {name?, description?, parent_id?, comment?}` — `parent_id` musi być tego samego typu co obecny rodzic.
  - `DELETE /api/areas/{id:int}` — obszar z dziećmi lub skałami → 409 `area_not_empty` „Najpierw przenieś skały i sektory”.
  - `GET /api/crags/{id:int}/to-sector/preview` (wymaga sesji) → `ToSectorPreview`; `POST /api/crags/{id:int}/to-sector {comment?}` → `{sector: {id, slug}, crags: [{id, slug, name, needs_location}]}`.
  - Każdy zapis kończy `refresh_area_geom` + `commit`.

- [ ] **Step 1: Testy `test_sectors.py`**
  - nowy sektor z trzech skał regionu (jedna z innego sektora tego regionu) → wszystkie mają `area_id` nowego sektora; skała z innego regionu → 422 `crag_outside_region`;
  - `POST` regionu pod `obszar`, sektora pod `region`; sektor pod sektorem → 422;
  - `DELETE` niepustego → 409; pustego → 204;
  - zamiana: skała z 3 ścianami, droga D1 tylko na ścianie 1, D2 na ścianach 1 i 3, D3 bez linii → 3 nowe skały; D1 i D2 w skale 1 (te same `id`), kopia D2 w skale 3 i linia ściany 3 wskazuje kopię; D3 w skale 1; `needs_location` = `[False, True, True]`; stara skała nie istnieje; wszystko w jednej transakcji (jeden `transaction_id` we wszystkich nowych wersjach);
  - nazwa ściany `None` → „X — ściana 2”;
  - podgląd: `copied_routes == 1`, `unplaced == 2`;
  - skała z jedną ścianą → 422 `single_wall`;
  - skała w sektorze → nowy sektor w regionie tego sektora.

- [ ] **Step 2: Implementacja** według Interfaces.
- [ ] **Step 3: Uruchom** `docker compose run --rm api pytest -q`.
- [ ] **Step 4: Commit** `feat: obszary, nowy sektor ze skał i zamiana skały w sektor (API)`

---

### Task 5: Co zmieniła transakcja i lista zmian (API)

**Files:**
- Create: `api/topo/changes.py`, `api/topo/api/changes.py`
- Modify: `api/topo/api/app.py` (router `/api/changes`), `api/topo/schemas.py` (`FieldDiffOut`, `ObjectChangeOut`, `ChangeOut`, `ChangesPage`)
- Test: `api/tests/test_changes.py`

**Interfaces:**
- Consumes: `SKIP_FIELDS` (definiowane tutaj), `location_of` (Task 3), `transaction_class`, `version_class`.
- Produces (`topo.changes`):

```python
MODELS: list[type] = [Area, Crag, Wall, Route, RouteLine, LinePoint]   # rodzic → dziecko
KIND = {Area: "area", Crag: "crag", Wall: "wall", Route: "route", RouteLine: "line", LinePoint: "point"}
SKIP_FIELDS = frozenset({...})   # lista z Global Constraints
Op = Literal["created", "updated", "deleted"]

@dataclass
class FieldDiff:
    field: str
    before: Any
    after: Any

@dataclass
class ObjectChange:
    model: type
    id: int
    op: Op
    before: dict[str, Any] | None   # wartości kolumn przed T (None dla created)
    after: dict[str, Any] | None    # wartości po T (None dla deleted)
    diffs: list[FieldDiff]          # tylko pola spoza SKIP_FIELDS, które się różnią (dla created/deleted: wszystkie niepuste)

def version_values(model: type, row) -> dict[str, Any]   # kolumny modelu z wiersza wersji; location → [lon, lat]
def transaction_changes(session, tx_id: int) -> list[ObjectChange]   # w kolejności MODELS
def list_changes(session, *, crag_id: int | None, kind: Literal["all", "deleted"], include_import: bool, limit: int, before: int | None) -> list[ChangeOut]
```

  - `before`/`after` dla `updated`: poprzednia wersja (najnowsza z `transaction_id < T` dla tego `id`) i wersja z T. Dla `deleted`: `before` = wartości z wiersza wersji usunięcia (Continuum kopiuje w nim ostatni stan), `after = None`. Dla `created`: `before = None`.
  - Filtr `crag_id`: transakcje z wierszem wersji, gdzie `crag_version.id == crag_id` albo `wall_version.crag_id == crag_id` albo `route_version.crag_id == crag_id` albo `route_line_version.wall_id IN (ids ścian, które kiedykolwiek należały do skały)` albo `line_point_version.line_id IN (ids linii, które kiedykolwiek były na tych ścianach)` — podzapytania po tabelach wersji, więc działa też dla usuniętych i przeniesionych.
  - `kind="deleted"`: transakcje z `operation_type == 2` w `crag_version`, `route_version` albo `wall_version`.
  - `include_import=False`: pomija transakcje z autorem `import:*`.
  - Stronicowanie po `transaction.id` malejąco, `before` = id ostatniego wpisu poprzedniej strony, `limit` 1–100 (domyślnie 30).
- Produces (`schemas.py` + `GET /api/changes`, wymaga sesji):

```python
class FieldDiffOut(BaseModel): field: str; before: Any; after: Any
class ObjectChangeOut(BaseModel):
    kind: Literal["area", "crag", "wall", "route", "topo"]
    id: int
    name: str | None
    op: Literal["created", "updated", "deleted"]
    diffs: list[FieldDiffOut]
    summary: str | None          # dla "topo": „zmieniono 3 linie, 7 punktów”
class CragRef(BaseModel): id: int; name: str; slug: str | None   # slug None, gdy skały już nie ma
class ChangeOut(BaseModel):
    id: int; author: str | None; comment: str | None; issued_at: datetime
    is_import: bool; reverts_id: int | None; reverted_by: int | None
    crag: CragRef | None; area_path: list[AreaRef]
    objects: list[ObjectChangeOut]
class ChangesPage(BaseModel): items: list[ChangeOut]; next_before: int | None
```

  - Zmiany `line`/`point` grupowane po ścianie w jeden obiekt `kind="topo"` (`id` = id ściany, `name` = nazwa ściany, `summary` po polsku z liczbami linii i punktów, `diffs = []`).
  - `crag`: pierwsza skała, której dotyczy transakcja (z wartości wersji); `area_path` z obecnego obszaru skały, gdy istnieje.
  - `reverted_by`: najnowsza transakcja z `reverts_id == id`.
  - Query: `?crag=&kind=all|deleted&include_import=false&limit=30&before=`.

- [ ] **Step 1: Testy `test_changes.py`**
  - zmiana opisu skały i wyceny drogi w jednej transakcji → dwa `ObjectChange` (`crag`, `route`), `diffs` tylko z `description` i `grade` (bez `grade_sort`);
  - utworzenie skały → `op == "created"`, `before is None`; usunięcie drogi → `op == "deleted"`, `before["name"]` = nazwa;
  - `location` w różnicy jako `[lon, lat]`;
  - `GET /api/changes?crag=` zawiera zmiany ściany, drogi i linii tej skały, nie zawiera zmian innej skały; zawiera transakcję usunięcia skały;
  - `kind=deleted` zwraca tylko usunięcia; domyślnie bez importu, `include_import=true` z importem (`is_import == True`);
  - stronicowanie: 35 transakcji, `limit=30` → 30 + `next_before`, druga strona 5 + `next_before is None`;
  - zmiany punktów linii → jeden obiekt `kind="topo"` z `summary`;
  - `reverted_by` ustawione, gdy istnieje transakcja z `reverts_id` (ustaw ręcznie przez `set_author(..., reverts_id=)`);
  - bez sesji → 401.

- [ ] **Step 2: Implementacja** według Interfaces.
- [ ] **Step 3: Uruchom** `docker compose run --rm api pytest -q`.
- [ ] **Step 4: Commit** `feat: historia zmian — różnice pól i lista z filtrami (API)`

---

### Task 6: Cofanie zmian (API)

**Files:**
- Create: `api/topo/revert.py`
- Modify: `api/topo/api/changes.py` (`POST /{id}/revert`)
- Test: `api/tests/test_revert.py`

**Interfaces:**
- Consumes: `transaction_changes`, `ObjectChange`, `MODELS`, `SKIP_FIELDS`, `version_values` (Task 5); `location_from`, `location_of`, `delete_crag`/`delete_route`/`delete_wall` (Task 3); `update_wall_fields`, `vegetation_stats`, `DEPTH_FILE`, `SEGMENTS_FILE` (`topo/depth.py`); `unique_slug`; `refresh_area_geom`.
- Produces (`topo.revert`):

```python
Mode = Literal["check", "safe", "all"]

@dataclass
class Conflict:
    kind: str; id: int; name: str | None
    field: str                 # "*" = obiekt zmieniony/usunięty później jako całość
    author: str | None; issued_at: datetime | None
    current: Any; restored: Any

class RevertConflict(Exception):
    def __init__(self, conflicts: list[Conflict]): ...

class MissingParent(Exception):
    def __init__(self, kind: str, name: str | None, transaction_id: int | None): ...

def revert_transaction(session, tx_id: int, nick: str, comment: str | None, mode: Mode, media_root: Path) -> int
    # zwraca id nowej transakcji; "check" + konflikty → RevertConflict (nic nie zmienione)
```

- Endpoint `POST /api/changes/{id}/revert {mode?: "safe" | "all", comment?}` (wymaga sesji): brak transakcji → 404; transakcja importu → 403 `import_revert` „Danych z importu nie cofa się — popraw je ręcznie”; brak `mode` → `"check"`; `RevertConflict` → 409 `{code: "revert_conflict", message: "Część pól zmieniono później", conflicts: [...]}`; `MissingParent` → 409 `{code: "missing_parent", message: "Najpierw przywróć: {nazwa}", transaction_id}`; sukces → `{transaction_id}`.

**Algorytm** (`revert_transaction`):
1. `changes = transaction_changes(session, tx_id)`; `start_change` z autorem `nick`, komentarzem `f"cofnięcie #{tx_id}"` (+ `f": {comment}"`) i `reverts_id=tx_id`.
2. **Plan (bez zmian w bazie):** dla każdej zmiany policz akcję i konflikty:
   - `updated`: obiekt nie istnieje → konflikt `field="*"` (pominięty w każdym trybie); dla każdej różnicy: `cur = current(obj, field)`; `cur == after` → przywróć `before`; `cur == before` → pomiń; inaczej konflikt (autor i czas = najnowsza wersja obiektu z `transaction_id > T`), w `all` przywróć.
   - `created`: obiekt nie istnieje → pomiń; istnieje wersja z `transaction_id > T` → konflikt `field="*"` (w `safe` pomiń, w `all` usuń); inaczej usuń.
   - `deleted`: obiekt istnieje → pomiń; inaczej wstaw z `before`. Rodzic wymagany (`Area.parent_id` gdy nie `None`, `Crag.area_id`, `Wall.crag_id`, `Route.crag_id`, `RouteLine.wall_id`, `LinePoint.line_id`) musi istnieć albo być wstawiany w tym samym cofnięciu — inaczej `MissingParent` (z id najnowszej transakcji, która go usunęła). `RouteLine.route_id`, którego drogi nie ma i nie będzie → `None`.
   - `mode == "check"` i są konflikty → `RevertConflict` (po `session.rollback()`).
3. **Faza 1 — wstawienia** w kolejności `MODELS`: `model(**{k: v for k, v in before.items() if k not in ("parent_line_id", "parent_point_id")}, id=...)`; `location` przez `location_from`; kolizja `slug` → `unique_slug(session, model, name)`; `session.flush()`. Potem ustaw `parent_line_id`/`parent_point_id` przywróconych linii (rodzic istnieje albo został wstawiony; inaczej zostaw `None`); `flush`.
4. **Faza 2 — pola:** `setattr` (`location` przez `location_from`; `Route.grade` przez `apply_grade`); `flush`; `session.expire_all()`.
5. **Faza 3 — usunięcia** w odwrotnej kolejności `MODELS` przez `delete_*` albo `session.delete`; `flush`.
6. Przywrócone ściany: `folder = media_root / "walls" / str(id)`; `depth.png` jest → `update_wall_fields(depth_status="ready", depth_path="walls/{id}/depth.png")`, inaczej `depth_status="pending", depth_path=None`; `segments.png` jest → `vegetation_ratio`, `route_vegetation_ratio = vegetation_stats(np.array(Image.open(...)), linie ściany)`.
7. `refresh_area_geom`, `commit`, zwróć id nowej transakcji.

`current(obj, field)`: `location_of(obj)` dla `location`, listy dla tablic, inaczej `getattr`. Porównania wartości po normalizacji (float zaokrąglone do 7 miejsc, listy jako listy).

- [ ] **Step 1: Testy `test_revert.py`** (fikstury: `editor`, `tmp_path` jako `MEDIA_ROOT`)
  - cofnięcie zmiany opisu i czasu dojścia → stare wartości, nowa transakcja z `reverts_id`, `author == "ania"`;
  - konflikt: Ania zmienia wycenę VI → VI+ i opis, Bartek wycenę → VI.1; cofnięcie zmiany Ani bez `mode` → 409 z jednym konfliktem (`field == "grade"`, `author == "bartek"`, `current == "VI.1"`, `restored == "VI"`) i nic nie zmienione; `mode=safe` → opis cofnięty, wycena VI.1; `mode=all` → wycena VI, `grade_sort` przeliczony;
  - cofnięcie usunięcia skały: ściany, drogi, linie, punkty wracają z tymi samymi `id`; `GET /api/crags/{slug}` działa; pliki `depth.png` i `segments.png` w `tmp_path/walls/{id}` → `depth_status == "ready"` i `vegetation_ratio` policzone;
  - `test_restore_crag_with_variant_line`: skała z drogą A i wariantem B (`parent_line_id`, `parent_point_id` → A) usunięta i przywrócona → B znów wskazuje punkt A;
  - `test_restore_route_reattaches_variant`: usunięcie drogi A (Task 3 odpina wariant B) i cofnięcie → A wraca, B znów wskazuje A;
  - cofnięcie utworzenia skały → skała usunięta; gdy po utworzeniu ktoś ją edytował → 409 `field == "*"`;
  - brak rodzica: usunięcie drogi, potem usunięcie skały; cofnięcie usunięcia drogi → 409 `missing_parent` z id transakcji usunięcia skały;
  - kolizja `slug`: usunięta „Baszta”, nowa „Baszta” (`baszta`), cofnięcie usunięcia → przywrócona ma `baszta-2`;
  - zamiana w sektor i jej cofnięcie → jedna skała jak przed zamianą (te same ściany, drogi, linie wskazują oryginalne drogi), sektor i kopie dróg usunięte; gdy nowej skale przesunięto pinezkę → bez `mode` 409, `all` cofa całość;
  - nowy sektor z `crag_ids` i jego cofnięcie → skały wracają do poprzednich obszarów, sektora nie ma;
  - `test_revert_twice_is_harmless`: drugie cofnięcie tej samej zmiany → 200 bez zmian w danych albo 409, nigdy 500;
  - `test_revert_of_revert`: cofnięcie transakcji cofnięcia przywraca stan po pierwotnej zmianie;
  - cofnięcie transakcji importu → 403;
  - import po cofnięciu nie nadpisuje skały (`is_manually_edited` True).

- [ ] **Step 2: Implementacja** według Interfaces i Algorytmu.
- [ ] **Step 3: Uruchom** `docker compose run --rm api pytest -q`.
- [ ] **Step 4: Commit** `feat: cofanie zmian z wykrywaniem konfliktów (API)`

---

### Task 7: Sesja na froncie — logowanie, pasek, zapisy

**Files:**
- Create: `web/src/lib/session.tsx`, `web/src/components/LoginDialog.tsx`, `web/src/components/UserMenu.tsx`, `web/src/lib/session.test.tsx`, `web/src/lib/patch.ts`, `web/src/lib/patch.test.ts`; shadcn: `npx shadcn@latest add dialog sheet dropdown-menu sonner input textarea label` (pliki w `web/src/components/ui/`)
- Modify: `web/src/lib/api.ts`, `web/src/lib/api.test.ts`, `web/src/App.tsx` (`SessionProvider`, `<Toaster />`, trasa `/zmiany` dodana w Task 10), `web/src/map/TopBar.tsx`, `web/src/pages/CragPage.tsx` (nagłówek: `UserMenu` / „✎ Edytuj”)

**Interfaces (Produces):**
- `api.ts`:
  - `ApiError` dostaje `readonly code: string | null` i `readonly body: unknown` (cała odpowiedź błędu — dla 409 cofania zawiera `conflicts`).
  - `sendJson<T>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T>` — `credentials: "same-origin"`, `Content-Type: application/json`, 204 → `undefined as T`, błędy jak `getJson`.
  - Typy: `CragPatch`, `RoutePatch`, `WallPatch`, `AreaPatch`, `ChangeOut`, `ObjectChangeOut`, `FieldDiffOut`, `ChangesPage`, `RevertConflict` (pola jak w API Task 5–6), `ToSectorPreview`.
  - `api.me()`, `api.login(password, nick)`, `api.logout()`, `api.patchCrag(id, patch)`, `api.createCrag(body)`, `api.deleteCrag(id, comment?)`, `api.createRoute(cragId, body)`, `api.patchRoute(id, patch)`, `api.deleteRoute(id, comment?)`, `api.patchWall(id, patch)`, `api.deleteWall(id, comment?)`, `api.createArea(body)`, `api.patchArea(id, patch)`, `api.deleteArea(id)`, `api.toSectorPreview(cragId)`, `api.toSector(cragId, comment?)`, `api.changes({crag?, kind?, before?, limit?})`, `api.revert(id, mode?, comment?)`.
  - `CragDetail` + `needs_location`; `CragProps` + `needs_location`.
- `patch.ts`: `changedFields<T extends object>(original: T, draft: T): Partial<T>` — porównanie płytkie, tablice po zawartości, `""` traktowane jak `null`.
- `session.tsx`:
  - `SessionProvider` — trzyma zapytanie `["me"]` (`api.me`, 401 → `null`, bez ponawiania) i okienko logowania.
  - `useSession(): { nick: string | null; isEditor: boolean; login(password: string, nick: string): Promise<void>; logout(): Promise<void>; requestLogin(): Promise<boolean> }` — `requestLogin` otwiera `LoginDialog` i rozwiązuje się `true` po zalogowaniu, `false` po anulowaniu.
  - `useEditorMutation<V, R>(fn: (vars: V) => Promise<R>, options?: { onSuccess?: (r: R, v: V) => void; invalidate?: QueryKey[] })` — opakowanie `useMutation`: `ApiError` 401 → `setQueryData(["me"], null)`, `await requestLogin()`, przy `true` ponowienie z tymi samymi danymi; po sukcesie `invalidateQueries` dla `invalidate` i `toast.success("Zapisano")`; inne błędy → `toast.error(error.message)` (oprócz 409 `revert_conflict`, które obsługuje wołający).
- `LoginDialog` (mockup `mapa-edycja.html` §1): „Tryb edycji”, pola „Hasło” (`type=password`, `autocomplete="current-password"`) i „Twój nick (podpis w historii)” (domyślnie ostatni nick z `localStorage` `topo-nick`, odczyt w try/catch), tekst „Zapamiętamy na tym urządzeniu przez rok.”, „Anuluj” / „Wejdź”; błąd z API pod polami.
- `UserMenu`: niezalogowany → przycisk „✎ Edytuj” (`requestLogin`); zalogowany → link-kafelek „⟲ Ostatnie zmiany” (`/zmiany`) i „● {nick} ▾” (dropdown: „Zmień nick” = `requestLogin`, „Wyloguj”). Na telefonie kafelek tylko ikoną z `aria-label`.

- [ ] **Step 1: Testy**
  - `patch.test.ts`: tylko zmienione pola; `""` vs `null` bez zmiany; tablice `["S"]` vs `["S"]` bez zmiany, `["S","W"]` zmiana.
  - `api.test.ts`: `sendJson` 204 → `undefined`; 409 → `ApiError` z `code` i `body.conflicts`.
  - `session.test.tsx` (fetch zamockowany): niezalogowany widzi „Edytuj”; zalogowanie zmienia pasek na nick i „Ostatnie zmiany”; **`useEditorMutation` dostaje 401 → pokazuje okienko logowania; po „Wejdź” ponawia zapis z tymi samymi danymi (drugi `PATCH` z identycznym ciałem); po „Anuluj” nie ponawia, a stan formularza w komponencie testowym zostaje** (Review Focus 1).
- [ ] **Step 2: Implementacja** według Interfaces.
- [ ] **Step 3: Uruchom** `cd web; npm test`.
- [ ] **Step 4: Commit** `feat: sesja edycji na froncie (logowanie, pasek, ponowienie po 401)`

---

### Task 8: Edycja skały (tryb B), ściany i menu „⋯”

**Files:**
- Create: `web/src/crag/edit/CragEditForm.tsx`, `web/src/crag/edit/CragMenu.tsx`, `web/src/crag/edit/WallEditDialog.tsx`, `web/src/crag/edit/ToSectorDialog.tsx`, `web/src/crag/edit/ConfirmDialog.tsx`, `web/src/crag/edit/fields.ts`, `web/src/crag/edit/CragEditForm.test.tsx`
- Modify: `web/src/pages/CragPage.tsx`

**Interfaces:**
- Consumes: `useSession`, `useEditorMutation`, `changedFields`, `api.*` (Task 7).
- Produces:
  - `fields.ts`: `CRAG_FIELDS` — kolejność i etykiety pól skały: nazwa, rodzaj skały, wysokość od–do (m), wystawa (wielokrotny wybór N, NE, E, SE, S, SW, W, NW), formacje (lista z przecinkami), czas dojścia (min), dla dzieci (tak/nie/brak), otoczenie, opis, dojście; `toDraft(crag: CragDetail): CragDraft`, `draftToPatch(original: CragDraft, draft: CragDraft): CragPatch` (konwersja liczb, puste → `null`, używa `changedFields`).
  - `CragEditForm({ crag, onDone })` — mockup `edycja-skaly.html` wariant B: pola w siatce (telefon jedna kolumna), przyklejony u dołu pasek: „Komentarz (opcjonalnie)…”, „Anuluj”, „Zapisz zmiany (n)” (n = liczba zmienionych pól, przycisk nieaktywny przy 0). Wyjście z niezapisanymi zmianami (Anuluj, `beforeunload`) → `ConfirmDialog` „Porzucić zmiany?”. Po zapisie `invalidate: [["crag", slug], ["map"]]`.
  - `CragMenu({ crag, wall })` — przycisk „⋯” (dropdown): „Historia” (otwiera panel z Task 10 — tu tylko callback `onHistory`), „Przesuń na mapie” (nawigacja `/?przesun={crag.id}` + hash widoku skały), „Ściana: nazwa i opis” (`WallEditDialog` dla bieżącej ściany), „Usuń ścianę”, „Zamień w sektor” (tylko gdy `walls.length > 1`), „Usuń skałę”.
  - `WallEditDialog({ wall, onClose })` — nazwa, opis, kolejność; `api.patchWall`.
  - `ToSectorDialog({ crag, onClose })` — `api.toSectorPreview` → treść „Powstanie sektor {nazwa} i {n} skały (z {n} ścian); {copied} dróg występuje na kilku ścianach — dostaną kopie. {unplaced} skał trzeba będzie ustawić na mapie.” → „Zamień” → `api.toSector` → nawigacja na mapę na sektor (`/#widok` z położeniem skały, zoom 15) i `toast` „Zamieniono w sektor — ustaw skały na mapie”.
  - Usunięcie skały: `ConfirmDialog` „Usunąć {nazwa} razem z {n} ścianami i {m} drogami? Można to cofnąć w Ostatnich zmianach.” → `api.deleteCrag` → nawigacja na mapę + `toast`.
  - `CragPage`: zalogowany → obok nazwy „✎ Edytuj skałę” i `CragMenu`; w trybie edycji `CragEditForm` zastępuje nagłówek i `CragInfo` (przeglądarka ściany i lista dróg zostają).

- [ ] **Step 1: Testy `CragEditForm.test.tsx`**: `draftToPatch` (liczby, wystawa, puste → `null`, bez zmian → `{}`); licznik „Zapisz zmiany (2)” po zmianie dwóch pól; „Zapisz” wysyła `PATCH` tylko z tymi polami i komentarzem; „Anuluj” po zmianach pyta o porzucenie; niezalogowany nie widzi „Edytuj skałę”.
- [ ] **Step 2: Implementacja** według Interfaces.
- [ ] **Step 3: Uruchom** `cd web; npm test`.
- [ ] **Step 4: Commit** `feat: edycja skały i ścian, menu skały (usuń, zamień w sektor)`

---

### Task 9: Edycja dróg w panelu (C)

**Files:**
- Create: `web/src/crag/edit/RouteEditPanel.tsx`, `web/src/crag/edit/RouteEditPanel.test.tsx`
- Modify: `web/src/crag/RouteList.tsx` (props `editable`, `onEdit(route)`, `onAdd()`), `web/src/pages/CragPage.tsx`

**Interfaces:**
- Consumes: `useEditorMutation`, `changedFields`, `api.patchRoute/createRoute/deleteRoute`, `ConfirmDialog` (Task 8), `Sheet` (shadcn) i istniejący `web/src/components/ui/drawer.tsx`.
- Produces: `RouteEditPanel({ cragId, slug, route: RouteOut | null /* null = nowa */, onClose })` — komputer: `Sheet` z prawej (szerokość ~360 px, bez przyciemniania strony, żeby widać topo); telefon: `Drawer` od dołu. Pola: nazwa, wycena (podpowiedź „np. VI.1+, VI.2/3”), długość (m), asekuracja, autor, rok, numer, opis, komentarz. Przyciski: „Usuń” (z potwierdzeniem; tylko dla istniejącej), „Zapisz”. Błąd 422 `invalid_grade` → komunikat pod polem wyceny. Otwarcie panelu zaznacza drogę (`setSelectedRouteId`), więc jej linia jest podświetlona na topo.
- `RouteList`: przy `editable` w wierszu ikona ✎ (`aria-label="Edytuj drogę {nazwa}"`, kliknięcie nie wybiera wiersza drugi raz), pod listą „+ Dodaj drogę”.

- [ ] **Step 1: Testy `RouteEditPanel.test.tsx`**: zapis zmienionej wyceny wysyła `PATCH {grade}`; 422 `invalid_grade` pokazuje błąd przy wycenie i nie zamyka panelu; nowa droga → `POST /api/crags/{id}/routes`; „Usuń” pyta i wysyła `DELETE`; ✎ w `RouteList` widoczne tylko przy `editable`.
- [ ] **Step 2: Implementacja** według Interfaces.
- [ ] **Step 3: Uruchom** `cd web; npm test`.
- [ ] **Step 4: Commit** `feat: edycja i dodawanie dróg w panelu bocznym`

---

### Task 10: Historia przy skale, okienko konfliktu i „Ostatnie zmiany”

**Files:**
- Create: `web/src/history/format.ts`, `web/src/history/format.test.ts`, `web/src/history/ChangeEntry.tsx`, `web/src/history/HistoryPanel.tsx`, `web/src/history/ConflictDialog.tsx`, `web/src/history/useRevert.ts`, `web/src/history/ConflictDialog.test.tsx`, `web/src/pages/ChangesPage.tsx`, `web/src/pages/ChangesPage.test.tsx`
- Modify: `web/src/App.tsx` (trasa `/zmiany`, leniwie), `web/src/pages/CragPage.tsx` (`CragMenu.onHistory` → `HistoryPanel`), `web/src/index.css` (klasy `.diff-del`, `.diff-ins` z kolorami z Global Constraints dla obu motywów)

**Interfaces:**
- Consumes: `api.changes`, `api.revert`, typy `ChangeOut`, `RevertConflict`, `useEditorMutation`, `useSession`.
- Produces:
  - `format.ts`: `FIELD_LABELS: Record<string, string>` (np. `grade` → „wycena”, `approach_minutes` → „czas dojścia”, `location` → „położenie”, `area_id` → „obszar”), `formatValue(field: string, value: unknown): string` (minuty „10 min”, metry „15 m”, położenie „50.4721, 19.6513”, tablice po przecinku, `null` → „—”, tekst > 80 znaków skrócony „…”), `objectTitle(o: ObjectChangeOut): string` („Skała”, „Droga **Filar**”, „Ściana 2”, „Sektor …”), `changeHeadline(c: ChangeOut): string` (np. „Usunięto skałę (2 ściany, 9 dróg)”, „Zamieniono skałę w sektor”), `formatWhen(iso: string, now?: Date): string` („dziś 14:02”, „wczoraj”, „8 paź”).
  - `ChangeEntry({ change, showCrag })` — mockup `historia.html`: kto · kiedy · „komentarz”, lista różnic (`del` → `ins`), przycisk „↶ Cofnij” (albo „↶ Przywróć”, gdy transakcja tylko usuwa); import wyszarzony bez przycisku; „cofnięta przez #N” gdy `reverted_by`. Z `showCrag`: nazwa skały + ścieżka i „Otwórz skałę” (gdy `crag.slug`).
  - `useRevert()` → `{ revert(change: ChangeOut): void; dialog: ReactNode }` — `api.revert(id)`; 409 `revert_conflict` → `ConflictDialog`; 409 `missing_parent` → `toast.error(message)`; sukces → `toast` „Cofnięto zmianę #id”, `invalidate [["changes"], ["crag"], ["map"]]`.
  - `ConflictDialog({ conflicts, onCancel, onSafe, onAll })` — „Cofnąć zmianę {autor} z {czas}?”, lista: „{obiekt} · {pole} — {autor}, {czas}: {current}; cofnięcie ustawi {current} → {restored}”, dla `field === "*"` „{obiekt} zmieniono później w całości”; przyciski „Anuluj”, „Cofnij tylko bez konfliktu”, „Cofnij wszystko”.
  - `HistoryPanel({ crag, onClose })` — `Sheet` z prawej / `Drawer` od dołu, `useInfiniteQuery(["changes", {crag: id}])` z `include_import=true` (żeby wpis importu był widoczny wyszarzony), doczytywanie „Starsze ↓”.
  - `ChangesPage` (`/zmiany`): niezalogowany → komunikat „Ostatnie zmiany są widoczne po zalogowaniu” + „✎ Edytuj”; zalogowany → nagłówek „Ostatnie zmiany”, filtry (chipy) „wszystkie” / „bez importu” (domyślnie) / „tylko usunięcia”, lista `ChangeEntry showCrag`, doczytywanie przy przewijaniu (`IntersectionObserver`, z przyciskiem „Starsze” jako zapasem). Nagłówek strony jak na stronie skały (logo → mapa, `UserMenu`, motyw).

- [ ] **Step 1: Testy**
  - `format.test.ts`: etykiety, `formatValue` dla minut, położenia, `null`, długiego tekstu; `changeHeadline` dla usunięcia skały i zamiany; `formatWhen` dziś/wczoraj/data.
  - `ConflictDialog.test.tsx`: trzy przyciski wołają `onCancel`/`onSafe`/`onAll`; konflikt `field="*"` ma osobny opis.
  - `ChangesPage.test.tsx`: niezalogowany widzi zaproszenie do logowania; filtr „tylko usunięcia” wysyła `kind=deleted`; „↶ Cofnij” → 409 → okienko konfliktu → „Cofnij tylko bez konfliktu” wysyła `{mode: "safe"}`.
- [ ] **Step 2: Implementacja** według Interfaces.
- [ ] **Step 3: Uruchom** `cd web; npm test`.
- [ ] **Step 4: Commit** `feat: historia skały, cofanie z okienkiem konfliktu i strona Ostatnie zmiany`

---

### Task 11: Edycja na mapie — przesuwanie, dodawanie, sektory, rozstawianie

**Files:**
- Create: `web/src/map/edit/mode.ts`, `web/src/map/edit/geo.ts`, `web/src/map/edit/geo.test.ts`, `web/src/map/edit/MoveCragBar.tsx`, `web/src/map/edit/AddCragDialog.tsx`, `web/src/map/edit/NewSectorBar.tsx`, `web/src/map/edit/NewSectorDialog.tsx`, `web/src/map/edit/AreaEditDialog.tsx`, `web/src/map/edit/mode.test.ts`
- Modify: `web/src/map/MapPage.tsx`, `web/src/map/layers.ts`, `web/src/map/layers.test.ts`, `web/src/map/DetailCard.tsx`, `web/src/map/DetailCard.test.tsx`

**Interfaces:**
- Consumes: `useSession`, `useEditorMutation`, `api.patchCrag/createCrag/createArea/patchArea/deleteArea`, `CragProps.needs_location`, `AreaProps`.
- Produces:
  - `mode.ts`: `type MapMode = { kind: "browse" } | { kind: "move"; crag: CragProps; target: [number, number] | null } | { kind: "add"; point: [number, number] | null } | { kind: "sector"; region: AreaProps; selected: number[] }`; `toggleCrag(mode, cragId)` (dodaje/odejmuje z `selected`), `parseMoveParam(search: string): number | null` (`?przesun=ID`).
  - `geo.ts`: `distanceMeters(a: [number, number], b: [number, number]): number` (haversine), `convexHull(points: [number, number][]): [number, number][]` (monotone chain; < 3 punkty → punkty bez zmian), `nearestSector(point, sectors: AreaProps[]): AreaProps | null` (najbliższy środek w promieniu 3 km), `formatDistance(m)` („140 m”, „1,2 km”).
  - `layers.ts`: kolor punktu skały — `["case", ["get", "needs_location"], "#E0A100", <dotychczasowe wyrażenie>]`; warstwa `crag-selected` (obwódka akcentu dla zaznaczonych w trybie `sector`, filtr po `id`) i źródło GeoJSON `edit-hull` (obrys na żywo, przerywany kontur akcentu).
  - `MoveCragBar` (mockup `mapa-edycja.html` §2): górny pływający pasek „Przeciągnij pinezkę (albo kliknij w nowe miejsce).” + „Przesunięto o {odległość}”; dolny: współrzędne, „Anuluj”, „Zapisz położenie” → `api.patchCrag(id, {location})`. Mapa: `Marker` react-map-gl z `draggable`, stary punkt półprzezroczysty, przerywana linia do nowego. Po zapisie powrót do `browse`, `invalidate [["map"], ["crag"]]`.
  - `AddCragDialog` (§3): po kliknięciu miejsca: nazwa, region/sektor (lista regionów i sektorów; domyślnie `nearestSector`, inaczej region najbliższego sektora; ostatnia pozycja „+ Nowy region…” rozwija pole nazwy — region powstaje przez `api.createArea({kind: "region", parent_id: <obszar najbliższego regionu>, name})` tuż przed skałą) → `api.createCrag` → nawigacja do `/skaly/{slug}`.
  - `NewSectorBar` + `NewSectorDialog` (mockup `nowy-sektor.html`): pasek „Klikaj skały, które mają wejść do sektora…”, „{n} skał · {m} dróg”, „Anuluj”, „Dalej” (aktywne od 1 skały); dialog: region (ustalony), nazwa, opis, lista skał z dopiskiem „(przejdzie z sektora „…”)”, „Wstecz”, „Utwórz sektor” → `api.createArea({kind: "sektor", parent_id, name, description, crag_ids})`. W trybie `sector` kliknięcie skały spoza regionu → `toast` „Ta skała jest w innym regionie”.
  - `AreaEditDialog` — nazwa, opis; „Usuń obszar” (409 `area_not_empty` → komunikat z API).
  - `DetailCard` (zalogowany): region → „✎” (`AreaEditDialog`), „+ Nowy sektor”; sektor → „✎”, lista „Do rozstawienia: n” (skały z `needs_location`, każda z „Ustaw na mapie” → tryb `move`); skała → „Przesuń na mapie”.
  - `MapPage`: stan `MapMode`; pływający przycisk „+ Dodaj skałę” (zalogowany, prawy dolny róg nad przełącznikiem warstw); `?przesun=ID` z adresu → tryb `move` po wczytaniu skał (i usunięcie parametru z adresu); `Escape` → `browse`; w trybach edycji kliknięcia nie otwierają kart.

- [ ] **Step 1: Testy**
  - `geo.test.ts`: `distanceMeters` (Kraków–Warszawa ~252 km ±2 km; ten sam punkt 0), `convexHull` (kwadrat z punktem w środku → 4 wierzchołki; 2 punkty → 2), `nearestSector` (najbliższy w promieniu, dalej niż 3 km → `null`), `formatDistance`.
  - `mode.test.ts`: `toggleCrag` dodaje i usuwa; `parseMoveParam("?przesun=12") === 12`, śmieci → `null`.
  - `layers.test.ts`: wyrażenie koloru skały zawiera `needs_location` i `#E0A100`.
  - `DetailCard.test.tsx`: zalogowany widzi „+ Nowy sektor” w karcie regionu i listę „Do rozstawienia” w karcie sektora; niezalogowany nie widzi przycisków edycji.
- [ ] **Step 2: Implementacja** według Interfaces.
- [ ] **Step 3: Uruchom** `cd web; npm test`.
- [ ] **Step 4: Commit** `feat: edycja na mapie (przesuwanie i dodawanie skał, nowy sektor, rozstawianie)`

---

### Task 12: E2E i sprawdzenie w przeglądarce

**Files:**
- Create: `web/playwright.config.ts`, `web/e2e/edit-history.spec.ts`
- Modify: `web/package.json` (+ `@playwright/test`, skrypt `"e2e": "playwright test"`), `web/vite.config.ts` (`test.exclude: [...configDefaults.exclude, "e2e/**"]`), `docker-compose.yml` (`EDIT_PASSWORD`, `SECRET_KEY` przekazane do `api` z `.env`), `README.md` (sekcja „Edycja”: ustawienie hasła i klucza, logowanie, historia)

- [ ] **Step 1: Test E2E** (`baseURL: "http://localhost:5173"`, `webServer: { command: "npm run dev", port: 5173, reuseExistingServer: true }`; API z `docker compose up -d api` i `EDIT_PASSWORD=e2e-haslo` w `.env`):

```ts
test("logowanie → zmiana wyceny → historia → cofnięcie", async ({ page }) => {
  await page.goto("/skaly/zabi-kon");                       // skała z fixture importu (plan 2)
  await page.getByRole("button", { name: "✎ Edytuj" }).click();
  await page.getByLabel("Hasło").fill(process.env.EDIT_PASSWORD ?? "e2e-haslo");
  await page.getByLabel(/Twój nick/).fill("e2e");
  await page.getByRole("button", { name: "Wejdź" }).click();
  const row = page.getByRole("listitem").filter({ hasText: /./ }).first();
  const oldGrade = (await row.getByTestId("grade").textContent()) ?? "";
  await row.getByRole("button", { name: /Edytuj drogę/ }).click();
  await page.getByLabel("Wycena").fill("VI.5");
  await page.getByRole("button", { name: "Zapisz" }).click();
  await expect(row.getByTestId("grade")).toHaveText("VI.5");
  await page.getByRole("button", { name: "⋯" }).click();
  await page.getByRole("menuitem", { name: "Historia" }).click();
  const entry = page.getByTestId("change-entry").first();
  await expect(entry).toContainText("e2e");
  await entry.getByRole("button", { name: "↶ Cofnij" }).click();
  await expect(row.getByTestId("grade")).toHaveText(oldGrade);
});
```

(Jeśli w bazie nie ma `zabi-kon`, test zaczyna od pierwszej skały z `/api/map/crags`. `data-testid="grade"` na plakietce wyceny w wierszu drogi i `data-testid="change-entry"` na `ChangeEntry` — dodaj w Task 9/10, jeśli brakuje.)

- [ ] **Step 2: Sprawdzenie w przeglądarce** (`docker compose up -d api`, `cd web; npm run dev`; komputer 1440×900 i telefon 390×844, motyw jasny i ciemny): logowanie i wylogowanie; edycja skały (B) z komentarzem; edycja, dodanie i usunięcie drogi (C) z podświetleniem na topo; historia skały i cofnięcie z konfliktem (dwie karty, dwa nicki); przesunięcie pinezki; dodanie skały; nowy sektor z trzech skał i jego cofnięcie; zamiana skały z kilkoma ścianami w sektor, żółte pinezki, rozstawienie, cofnięcie; usunięcie skały i przywrócenie z „Ostatnich zmian” (2D i 2.5D działają); `npm run build` bez błędów, główny plik JS nie urósł o więcej niż ~60 kB (strona zmian i panele leniwie).
- [ ] **Step 3: Uruchom** `cd web; npm test; npm run e2e`, `docker compose run --rm api pytest -q`.
- [ ] **Step 4: Commit** `test: E2E edycji i historii, konfiguracja hasła edycji`
- [ ] **Step 5:** Dopisz „Wnioski z wykonania” na końcu tego planu (decyzje i poprawki z przeglądarki) i zaktualizuj spec, jeśli użytkownik zmienił decyzję.
