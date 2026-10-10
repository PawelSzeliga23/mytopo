# Plan 7b: zdjęcia ścian i kolejka głębi — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zalogowany dodaje ścianę ze zdjęciem albo podmienia zdjęcie ściany; głębia i segmentacja liczą się w tle przez `topo depth-worker`, a status widać na stronie skały.

**Architecture:** Każde wgranie zdjęcia trafia do nowego podkatalogu `walls/{id}/{n}/`, a głębia jest zapisywana obok zdjęcia, więc cofnięcie podmiany przywraca stare zdjęcie razem z gotową głębią. API przy wgraniu dodaje wiersz `depth_job`; osobny proces w obrazie `depth` pobiera zadania przez `FOR UPDATE SKIP LOCKED` i liczy je tym samym `process_wall` co `topo depth`. Front: okno wgrywania w menu „⋯” skały, napis statusu pod zdjęciem, odświeżanie co 15 s.

**Tech Stack:** FastAPI (multipart: `python-multipart`), SQLAlchemy 2 + Continuum, Pillow, typer; React 19 + TanStack Query + shadcn/ui, vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-plan-7b-zdjecia-glebia-design.md`

## Global Constraints

- Teksty interfejsu i komunikaty API po polsku; kod i komentarze po angielsku (jak w repo).
- Limit pliku 30 MB (413 `too_large` „Zdjęcie jest większe niż 30 MB”); zły obraz → 422 `invalid_image` „Nieprawidłowy plik obrazu”.
- Pliki zdjęć nigdy nie są usuwane ani nadpisywane (poza importem w `walls/{id}/`).
- Podmiana zdjęcia nie zmienia `wall.version` i nie rusza linii.
- Testy pisane razem z kodem, uruchamiane raz na końcu zadania: `docker compose run --rm api pytest` (api), `cd web; npx vitest run` + `npx tsc -b` (web). Bez E2E.
- Wykonanie inline na branchu `plan-7b-zdjecia-glebia`, każde zadanie osobnym commitem z linią `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Podmiana zdjęcia dwa razy pod rząd → katalogi `1` i `2`, cofnięcie drugiej przywraca `1` z jego głębią (test w Task 4).
- Zadanie czeka w kolejce, a ktoś cofa podmianę → worker liczy bieżące (stare) zdjęcie; ma gotową głębię, więc nic nie liczy i kończy `done` (test w Task 2).
- Plik niebędący obrazem / pusty plik → 422 i żadna ściana ani katalog nie powstają (test w Task 3).
- Worker zabity w trakcie → po restarcie zadanie `running` wraca do kolejki (test w Task 2).
- Ponowne „Dodaj zdjęcie”, gdy zadanie już czeka → bez duplikatu zadania (test w Task 3).

---

### Task 1: Katalog zdjęcia — wersjonowane podkatalogi i głębia obok zdjęcia

**Files:**
- Modify: `api/topo/media.py` (parametr `number`, `next_photo_number`, `DecompressionBombError`)
- Modify: `api/topo/depth.py` (`photo_folder`, `process_wall` zapisuje do katalogu zdjęcia)
- Modify: `api/topo/api/crags.py:38-42` (`segments_url` z katalogu zdjęcia)
- Modify: `api/topo/revert.py:302-320` (`_restore_depth` szuka w katalogu zdjęcia)
- Modify: `api/topo/depth_preview.py:110`
- Test: `api/tests/test_media.py`, `api/tests/test_depth.py`

**Interfaces:**
- Produces: `next_photo_number(media_root: Path, wall_id: int) -> int`; `store_wall_image(media_root, wall_id, data, number: int | None = None) -> StoredImage` (None → `walls/{id}/`, liczba → `walls/{id}/{n}/`); `photo_folder(wall: Wall) -> PurePosixPath` (rodzic `image_path`, bez zdjęcia `walls/{id}`).

- [ ] **Step 1: Testy**

`api/tests/test_media.py` (dopisać):
```python
from topo.media import next_photo_number


def test_store_in_numbered_folder(tmp_path):
    stored = store_wall_image(tmp_path, 7, jpeg(800, 600), number=2)
    assert stored.image_path == "walls/7/2/display.webp"
    assert stored.thumb_path == "walls/7/2/thumb.webp"
    assert stored.original_path == "walls/7/2/original.jpg"
    assert (tmp_path / stored.image_path).exists()


def test_next_photo_number_skips_files_and_import_folder(tmp_path):
    assert next_photo_number(tmp_path, 7) == 1
    folder = tmp_path / "walls" / "7"
    (folder / "1").mkdir(parents=True)
    (folder / "3").mkdir()
    (folder / "display.webp").write_bytes(b"x")
    assert next_photo_number(tmp_path, 7) == 4


def test_invalid_image_creates_no_folder(tmp_path):
    with pytest.raises(InvalidImage):
        store_wall_image(tmp_path, 7, b"", number=1)
    assert not (tmp_path / "walls").exists()
```

`api/tests/test_depth.py` (dopisać; `FakeSegmenter` jest już w pliku):
```python
def test_process_wall_writes_next_to_numbered_photo(session, tmp_path):
    crag = f.crag(session, f.area(session, "Dolina"), "Skała")
    wall = f.wall(session, crag)
    (tmp_path / "walls" / str(wall.id) / "2").mkdir(parents=True)
    relative = f"walls/{wall.id}/2/display.webp"
    Image.new("RGB", (64, 48), (90, 90, 90)).save(tmp_path / relative, "WEBP")
    wall.image_path = relative
    session.commit()

    process_wall(session, wall, tmp_path, FakeEstimator(), FakeSegmenter())

    assert wall.depth_path == f"walls/{wall.id}/2/depth.png"
    assert (tmp_path / "walls" / str(wall.id) / "2" / "segments.png").exists()
    assert not (tmp_path / "walls" / str(wall.id) / "depth.png").exists()


def test_photo_folder(session):
    crag = f.crag(session, f.area(session, "Dolina"), "Skała")
    wall = f.wall(session, crag)
    assert photo_folder(wall).as_posix() == f"walls/{wall.id}"
    wall.image_path = f"walls/{wall.id}/3/display.webp"
    assert photo_folder(wall).as_posix() == f"walls/{wall.id}/3"
```
(dodać `photo_folder` do importu z `topo.depth`.)

`api/tests/test_api_crags.py` (dopisać; wzorzec z istniejących testów `GET /api/crags/{slug}`):
```python
def test_segments_url_next_to_photo(client, session):
    crag = f.crag(session, f.area(session, "Dolina"), "Skała")
    wall = f.wall(session, crag, image_path=f"walls/1/2/display.webp", depth_status="ready",
                  depth_path="walls/1/2/depth.png", vegetation_ratio=0.0)
    session.commit()
    [out] = client.get(f"/api/crags/{crag.slug}").json()["walls"]
    assert out["segments_url"].endswith("walls/1/2/segments.png")
```

- [ ] **Step 2: Implementacja `media.py`**

```python
def next_photo_number(media_root: Path, wall_id: int) -> int:
    """Number of the wall's next photo folder (``walls/{id}/{n}/``); imported photos lie in ``walls/{id}/`` itself."""
    folder = Path(media_root) / "walls" / str(wall_id)
    numbers = [int(p.name) for p in folder.iterdir() if p.is_dir() and p.name.isdigit()] if folder.is_dir() else []
    return max(numbers, default=0) + 1


def store_wall_image(media_root: Path, wall_id: int, data: bytes, number: int | None = None) -> StoredImage:
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise InvalidImage("Nieprawidłowy plik obrazu") from exc
    ...
    relative = Path("walls") / str(wall_id)
    if number is not None:
        relative = relative / str(number)
```
(reszta bez zmian.)

- [ ] **Step 3: `depth.py`**

```python
from pathlib import Path, PurePosixPath

def photo_folder(wall: Wall) -> PurePosixPath:
    """Folder of the wall's current photo: its depth map and segmentation are stored next to it."""
    if wall.image_path:
        return PurePosixPath(wall.image_path).parent
    return PurePosixPath("walls") / str(wall.id)
```
W `process_wall`: `folder = Path(photo_folder(wall))` zamiast `Path("walls") / str(wall.id)`.

- [ ] **Step 4: użycia**

`crags.py` `_wall_out`: `media_url((photo_folder(wall) / SEGMENTS_FILE).as_posix())`.
`depth_preview.py`: `segments_path = Path(media_root) / photo_folder(wall) / SEGMENTS_FILE`.
`revert.py` `_restore_depth`: `relative = photo_folder(wall)`, `folder = media_root / relative`, `depth_path=(relative / DEPTH_FILE).as_posix()`.

- [ ] **Step 5: Testy i commit**

Run: `docker compose run --rm api pytest tests/test_media.py tests/test_depth.py tests/test_api_crags.py tests/test_revert.py -q` → PASS.
```bash
git commit -am "feat: zdjęcia ścian w numerowanych katalogach, głębia obok zdjęcia"
```

---

### Task 2: Kolejka głębi i `topo depth-worker`

**Files:**
- Create: `api/alembic/versions/0006_kolejka_glebi.py`
- Modify: `api/topo/models/depth_job.py` (`model` nullable)
- Create: `api/topo/depth_queue.py`
- Modify: `api/topo/cli.py` (komenda `depth-worker`)
- Modify: `docker-compose.yml` (usługa `depth-worker`), `README.md` (uruchomienie)
- Test: `api/tests/test_depth_queue.py`

**Interfaces:**
- Consumes: `process_wall`, `photo_folder` (Task 1).
- Produces: `enqueue_depth(session, wall_id: int) -> None` (bez commita, bez duplikatu `queued`); `requeue_running(session) -> int`; `claim_job(session) -> DepthJob | None`; `run_job(session, job, media_root, estimator, segmenter) -> None`; `work(session_factory, media_root, estimator, segmenter, *, interval=5.0, should_stop=..., sleep=time.sleep, log=print) -> None`.

- [ ] **Step 1: Migracja 0006**

```python
"""kolejka głębi: model zadania wpisuje worker

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-10 12:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column('depth_job', 'model', existing_type=sa.String(64), nullable=True)


def downgrade() -> None:
    op.execute("UPDATE depth_job SET model = '' WHERE model IS NULL")
    op.alter_column('depth_job', 'model', existing_type=sa.String(64), nullable=False)
```
Model: `model: Mapped[str | None] = mapped_column(String(64))`.

- [ ] **Step 2: Testy `api/tests/test_depth_queue.py`**

```python
from PIL import Image
from sqlalchemy import select

from tests import factories as f
from tests.test_depth import FakeEstimator, FakeSegmenter
from topo.depth_queue import claim_job, enqueue_depth, requeue_running, run_job, work
from topo.models import DepthJob, Wall


class Broken:
    name = "broken"

    def predict(self, image):
        raise RuntimeError("model padł")


def wall_with_photo(session, media_root, number=1):
    crag = f.crag(session, f.area(session, "Dolina"), "Skała")
    wall = f.wall(session, crag)
    relative = f"walls/{wall.id}/{number}/display.webp"
    (media_root / relative).parent.mkdir(parents=True)
    Image.new("RGB", (64, 48), (90, 90, 90)).save(media_root / relative, "WEBP")
    wall.image_path = relative
    session.commit()
    return wall


def jobs(session, wall_id):
    return list(session.scalars(select(DepthJob).where(DepthJob.wall_id == wall_id).order_by(DepthJob.id)))


def test_enqueue_skips_duplicate_queued(session, tmp_path):
    wall = wall_with_photo(session, tmp_path)
    enqueue_depth(session, wall.id)
    session.flush()
    enqueue_depth(session, wall.id)
    session.commit()
    assert [j.status for j in jobs(session, wall.id)] == ["queued"]


def test_claim_and_run_job(session, tmp_path):
    wall = wall_with_photo(session, tmp_path)
    enqueue_depth(session, wall.id)
    session.commit()

    job = claim_job(session)
    assert job is not None and job.status == "running"
    assert claim_job(session) is None
    run_job(session, job, tmp_path, FakeEstimator(), FakeSegmenter())

    session.expire_all()
    assert (job.status, job.model, job.error) == ("done", "fake-model", None)
    wall = session.get(Wall, wall.id)
    assert (wall.depth_status, wall.depth_path) == ("ready", f"walls/{wall.id}/1/depth.png")
    assert wall.vegetation_ratio is not None


def test_failed_job(session, tmp_path):
    wall = wall_with_photo(session, tmp_path)
    enqueue_depth(session, wall.id)
    session.commit()
    job = claim_job(session)
    run_job(session, job, tmp_path, Broken(), FakeSegmenter())
    session.expire_all()
    assert job.status == "failed" and "model padł" in job.error
    assert session.get(Wall, wall.id).depth_status == "failed"


def test_ready_photo_is_not_recomputed(session, tmp_path):
    """A job queued for a photo that was reverted to one with ready depth finishes without a model run."""
    wall = wall_with_photo(session, tmp_path)
    wall.depth_status, wall.vegetation_ratio = "ready", 0.0
    enqueue_depth(session, wall.id)
    session.commit()
    job = claim_job(session)
    run_job(session, job, tmp_path, Broken(), FakeSegmenter())
    session.expire_all()
    assert job.status == "done"


# A wall deleted while its job runs: CASCADE removes the row, run_job must still finish without an error.
def test_missing_wall_job_is_done(session, tmp_path):
    job = DepthJob(wall_id=999_999, status="running")
    run_job(session, job, tmp_path, Broken(), FakeSegmenter())
    assert job.status == "done"


def test_requeue_running(session, tmp_path):
    wall = wall_with_photo(session, tmp_path)
    enqueue_depth(session, wall.id)
    session.commit()
    claim_job(session)
    assert requeue_running(session) == 1
    assert [j.status for j in jobs(session, wall.id)] == ["queued"]


def test_work_processes_queue_then_sleeps(session, tmp_path):
    wall = wall_with_photo(session, tmp_path)
    enqueue_depth(session, wall.id)
    session.commit()
    sleeps = []
    work(lambda: _Borrowed(session), tmp_path, FakeEstimator(), FakeSegmenter(), interval=7,
         should_stop=lambda: len(sleeps) >= 1, sleep=sleeps.append, log=lambda _: None)
    assert sleeps == [7]
    assert [j.status for j in jobs(session, wall.id)] == ["done"]


class _Borrowed:
    """The test session as a context manager that does not close it (work() opens one per job)."""

    def __init__(self, session):
        self.session = session

    def __enter__(self):
        return self.session

    def __exit__(self, *exc):
        return False
```

- [ ] **Step 3: `api/topo/depth_queue.py`**

```python
"""Depth queue: the API adds a depth_job when a photo arrives, `topo depth-worker` computes them one by one."""

import time
from collections.abc import Callable
from contextlib import AbstractContextManager
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from topo.depth import DepthEstimator, Segmenter, process_wall
from topo.models import DepthJob, Wall

ERROR_MAX = 2000


def enqueue_depth(session: Session, wall_id: int) -> None:
    """Adds a job unless one is already waiting for this wall; no commit — part of the caller's change."""
    waiting = session.scalar(
        select(DepthJob.id).where(DepthJob.wall_id == wall_id, DepthJob.status == "queued").limit(1)
    )
    if waiting is None:
        session.add(DepthJob(wall_id=wall_id, status="queued"))


def requeue_running(session: Session) -> int:
    """Jobs left "running" by a worker that died go back to the queue."""
    count = session.execute(update(DepthJob).where(DepthJob.status == "running").values(status="queued")).rowcount
    session.commit()
    return count


def claim_job(session: Session) -> DepthJob | None:
    job = session.scalars(
        select(DepthJob).where(DepthJob.status == "queued").order_by(DepthJob.created_at, DepthJob.id)
        .limit(1).with_for_update(skip_locked=True)
    ).first()
    if job is None:
        session.rollback()
        return None
    job.status = "running"
    session.commit()
    return job


def run_job(session: Session, job: DepthJob, media_root: Path, estimator: DepthEstimator, segmenter: Segmenter) -> None:
    """Computes depth and segmentation of the wall's current photo; a photo with ready depth is left as it is."""
    wall = session.get(Wall, job.wall_id)
    job.model = estimator.name
    try:
        if wall is not None and wall.image_path is not None:
            process_wall(session, wall, media_root, estimator, segmenter)
    except Exception as exc:
        session.rollback()
        job.status, job.error = "failed", str(exc)[:ERROR_MAX] or type(exc).__name__
    else:
        job.status, job.error = "done", None
    session.commit()


def work(
    session_factory: Callable[[], AbstractContextManager[Session]],
    media_root: Path,
    estimator: DepthEstimator,
    segmenter: Segmenter,
    *,
    interval: float = 5.0,
    should_stop: Callable[[], bool] = lambda: False,
    sleep: Callable[[float], None] = time.sleep,
    log: Callable[[str], None] = print,
) -> None:
    with session_factory() as session:
        if requeued := requeue_running(session):
            log(f"Wznowiono przerwane zadania: {requeued}")
    while not should_stop():
        with session_factory() as session:
            job = claim_job(session)
            if job is None:
                sleep(interval)
                continue
            started = time.perf_counter()
            run_job(session, job, media_root, estimator, segmenter)
            note = f": {job.error}" if job.error else ""
            log(f"Ściana #{job.wall_id}: {job.status} ({time.perf_counter() - started:.1f} s){note}")
```
Uwaga: `process_wall` przy błędzie już ustawił ścianie `failed` i zacommitował, więc `rollback` niczego nie cofa.

- [ ] **Step 4: CLI**

```python
@app.command("depth-worker")
def depth_worker_command(
    model: str = typer.Option("large", "--model", help="large (GPU) albo small (CPU)"),
    interval: float = typer.Option(5.0, "--interval", help="Co ile sekund sprawdzać kolejkę, gdy jest pusta"),
) -> None:
    """Liczy głębię i segmentację nowo wgranych zdjęć z kolejki (działa do Ctrl+C / SIGTERM)."""
    if model not in MODELS:
        raise typer.BadParameter(f"Nieznany model {model!r} — dostępne: {', '.join(MODELS)}")
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    estimator = HFDepthEstimator(model)
    segmenter = HFSegmenter(estimator.device)
    typer.echo(f"Worker głębi: {estimator.name} na {estimator.device}, czekam na zdjęcia…")
    try:
        work(SessionLocal, Path(get_settings().media_root), estimator, segmenter,
             interval=interval, should_stop=stop.is_set, sleep=stop.wait, log=typer.echo)
    except KeyboardInterrupt:
        typer.echo("Zatrzymano.")
```
(`import signal, threading`; `from topo.depth_queue import work`.)

- [ ] **Step 5: docker-compose i README**

```yaml
  depth-worker:
    image: topo-depth
    profiles: ["depth"]
    env_file:
      - path: .env
        required: false
    environment:
      DATABASE_URL: ${DATABASE_URL:-postgresql+psycopg://topo:topo@db:5432/topo}
      HF_HOME: /data/cache/huggingface
    command: ["topo", "depth-worker"]
    restart: unless-stopped
    volumes:
      - ./api:/app
      - ./media:/data/media
      - ./cache:/data/cache
    depends_on:
      db:
        condition: service_healthy
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```
README (sekcja głębi): `docker compose --profile depth up -d depth-worker` — liczy zdjęcia wgrane w aplikacji; na serwerze bez GPU `command: ["topo", "depth-worker", "--model", "small"]`.

- [ ] **Step 6: Testy i commit**

Run: `docker compose run --rm api pytest tests/test_depth_queue.py tests/test_cli.py -q` → PASS.
```bash
git commit -m "feat: kolejka głębi i topo depth-worker"
```

---

### Task 3: Endpointy wgrywania

**Files:**
- Modify: `api/pyproject.toml`, `api/uv.lock` (`python-multipart`)
- Create: `api/topo/photos.py` (odczyt uploadu, zapis zdjęcia na ścianie)
- Modify: `api/topo/api/crags.py` (`POST /{crag_id}/walls`), `api/topo/api/walls.py` (`PUT /{id}/image`, `POST /{id}/depth`)
- Test: `api/tests/test_api_photos.py`

**Interfaces:**
- Consumes: `store_wall_image(..., number)`, `next_photo_number` (Task 1), `enqueue_depth` (Task 2).
- Produces: `POST /api/crags/{id}/walls` → 201 `{"id", "version"}`; `PUT /api/walls/{id}/image` → 200 `{"id", "version"}`; `POST /api/walls/{id}/depth` → 202 `{"queued": true}`.

- [ ] **Step 1: Zależność**

Run: `docker compose run --rm api uv add "python-multipart>=0.0.9"` (zmienia `pyproject.toml` i `uv.lock` przez bind mount), potem `docker compose build api`. Obraz `depth` też trzeba przebudować (`docker compose --profile depth build depth`) — zgłosić użytkownikowi, bo pobiera torch.

- [ ] **Step 2: Testy `api/tests/test_api_photos.py`**

```python
import io

import pytest
from PIL import Image
from sqlalchemy import select

from tests import factories as f
from topo.config import get_settings
from topo.models import DepthJob, Wall


@pytest.fixture
def media(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


def jpeg(width=640, height=480) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (120, 90, 60)).save(buffer, "JPEG")
    return buffer.getvalue()


def upload(data=None, **fields):
    return {"files": {"file": ("sciana.jpg", data if data is not None else jpeg(), "image/jpeg")}, "data": fields}


def make_crag(session):
    crag = f.crag(session, f.area(session, "Dolina"), "Żabi Koń")
    f.wall(session, crag, "Stara", sort_order=4)
    session.commit()
    return crag


def queued(session, wall_id):
    return session.scalars(select(DepthJob.status).where(DepthJob.wall_id == wall_id)).all()


def test_create_wall(editor, session, media):
    crag = make_crag(session)
    response = editor.post(f"/api/crags/{crag.id}/walls", **upload(name=" Lewa ", comment="nowe zdjęcie"))
    assert response.status_code == 201
    wall = session.get(Wall, response.json()["id"])
    assert (wall.name, wall.sort_order, wall.source, wall.depth_status) == ("Lewa", 5, "manual", "pending")
    assert wall.image_path == f"walls/{wall.id}/1/display.webp"
    assert (wall.image_width, wall.image_height) == (640, 480)
    assert (media / wall.image_path).exists()
    assert queued(session, wall.id) == ["queued"]
    walls = editor.get(f"/api/crags/{crag.slug}").json()["walls"]
    assert walls[-1]["id"] == wall.id and walls[-1]["depth_status"] == "pending"


def test_create_wall_empty_name_is_null(editor, session, media):
    crag = make_crag(session)
    response = editor.post(f"/api/crags/{crag.id}/walls", **upload(name="  "))
    assert session.get(Wall, response.json()["id"]).name is None


def test_create_wall_invalid_image(editor, session, media):
    crag = make_crag(session)
    response = editor.post(f"/api/crags/{crag.id}/walls", **upload(b"to nie jest obraz"))
    assert response.status_code == 422 and response.json()["code"] == "invalid_image"
    assert len(session.scalars(select(Wall).where(Wall.crag_id == crag.id)).all()) == 1
    assert not (media / "walls").exists()


def test_too_large(editor, session, media, monkeypatch):
    monkeypatch.setattr("topo.photos.MAX_UPLOAD", 100)
    crag = make_crag(session)
    response = editor.post(f"/api/crags/{crag.id}/walls", **upload())
    assert response.status_code == 413 and response.json()["code"] == "too_large"


def test_upload_needs_login(client, session, media):
    crag = make_crag(session)
    assert client.post(f"/api/crags/{crag.id}/walls", **upload()).status_code == 401
    wall = crag.walls[0]
    assert client.put(f"/api/walls/{wall.id}/image", **upload()).status_code == 401
    assert client.post(f"/api/walls/{wall.id}/depth").status_code == 401


def test_replace_image(editor, session, media):
    crag = make_crag(session)
    wall = crag.walls[0]
    route = f.route(session, crag, "Rysa", "V")
    line = f.line(session, wall, route)
    wall.image_path = f"walls/{wall.id}/display.webp"
    wall.depth_status, wall.depth_path, wall.vegetation_ratio, wall.depth_enabled = "ready", "x", 0.5, True
    session.commit()
    version = wall.version

    first = editor.put(f"/api/walls/{wall.id}/image", **upload(comment="lepsze"))
    second = editor.put(f"/api/walls/{wall.id}/image", **upload(jpeg(800, 600)))
    assert first.status_code == 200 and second.status_code == 200

    session.expire_all()
    wall = session.get(Wall, wall.id)
    assert wall.image_path == f"walls/{wall.id}/2/display.webp"
    assert (wall.image_width, wall.image_height) == (800, 600)
    assert (wall.depth_status, wall.depth_path, wall.vegetation_ratio, wall.depth_enabled) == ("pending", None, None, None)
    assert wall.version == version
    assert [l.id for l in wall.lines] == [line.id]
    assert queued(session, wall.id) == ["queued"]  # the second upload does not add a duplicate


def test_retry_depth(editor, session, media):
    crag = make_crag(session)
    wall = crag.walls[0]
    wall.image_path, wall.depth_status = f"walls/{wall.id}/display.webp", "failed"
    session.commit()
    response = editor.post(f"/api/walls/{wall.id}/depth")
    assert response.status_code == 202
    session.expire_all()
    assert session.get(Wall, wall.id).depth_status == "pending"
    assert queued(session, wall.id) == ["queued"]


def test_retry_depth_without_photo(editor, session, media):
    crag = make_crag(session)
    response = editor.post(f"/api/walls/{crag.walls[0].id}/depth")
    assert response.status_code == 422 and response.json()["code"] == "no_image"
```

- [ ] **Step 3: `api/topo/photos.py`**

```python
"""Photos uploaded in the app: each one goes to a new numbered folder, so reverting a replacement gets the old one back."""

from pathlib import Path

from fastapi import UploadFile
from sqlalchemy.orm import Session

from topo.api.errors import ApiError
from topo.depth_queue import enqueue_depth
from topo.media import InvalidImage, next_photo_number, store_wall_image
from topo.models import Wall

MAX_UPLOAD = 30 * 1024 * 1024


def read_upload(file: UploadFile) -> bytes:
    data = file.file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise ApiError(413, "too_large", "Zdjęcie jest większe niż 30 MB")
    return data


def set_photo(session: Session, wall: Wall, data: bytes, media_root: Path) -> None:
    """Stores the photo, points the wall at it, clears what was derived from the old one and queues its depth."""
    try:
        stored = store_wall_image(media_root, wall.id, data, next_photo_number(media_root, wall.id))
    except InvalidImage as exc:
        session.rollback()
        raise ApiError(422, "invalid_image", str(exc)) from exc
    wall.image_original_path, wall.image_path, wall.thumb_path = stored.original_path, stored.image_path, stored.thumb_path
    wall.image_width, wall.image_height = stored.width, stored.height
    wall.depth_status, wall.depth_path, wall.depth_model = "pending", None, None
    wall.vegetation_ratio = wall.route_vegetation_ratio = wall.depth_enabled = None
    enqueue_depth(session, wall.id)
```

- [ ] **Step 4: Endpointy**

`crags.py`:
```python
@router.post("/{crag_id:int}/walls", status_code=201)
def create_wall(
    crag_id: int,
    file: UploadFile,
    name: Annotated[str | None, Form(max_length=200)] = None,
    comment: Annotated[str | None, Form(max_length=500)] = None,
    nick: str = Depends(current_editor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    crag = session.get(Crag, crag_id) or raise_not_found("skała")
    data = read_upload(file)
    start_change(session, nick, comment)
    last = session.scalar(select(func.max(Wall.sort_order)).where(Wall.crag_id == crag.id))
    wall = Wall(crag_id=crag.id, name=(name or "").strip() or None, sort_order=(last + 1) if last is not None else 0,
                source="manual")
    session.add(wall)
    session.flush()
    set_photo(session, wall, data, Path(get_settings().media_root))
    session.commit()
    return {"id": wall.id, "version": wall.version}
```
`walls.py`:
```python
@router.put("/{wall_id:int}/image")
def replace_image(
    wall_id: int,
    file: UploadFile,
    comment: Annotated[str | None, Form(max_length=500)] = None,
    nick: str = Depends(current_editor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    data = read_upload(file)
    # Locked until commit: two uploads at once must not pick the same folder number.
    wall = session.get(Wall, wall_id, with_for_update=True) or raise_not_found("ściana")
    start_change(session, nick, comment)
    set_photo(session, wall, data, Path(get_settings().media_root))
    session.commit()
    return {"id": wall.id, "version": wall.version}


@router.post("/{wall_id:int}/depth", status_code=202)
def retry_depth(wall_id: int, nick: str = Depends(current_editor), session: Session = Depends(get_session)) -> dict[str, bool]:
    wall = session.get(Wall, wall_id) or raise_not_found("ściana")
    if wall.image_path is None:
        raise ApiError(422, "no_image", "Ściana nie ma zdjęcia")
    update_wall_fields(session, wall.id, depth_status="pending")  # derived data: no history entry
    enqueue_depth(session, wall.id)
    session.commit()
    return {"queued": True}
```

- [ ] **Step 5: Testy i commit**

Run: `docker compose run --rm api pytest tests/test_api_photos.py -q` → PASS.
```bash
git commit -m "feat: dodawanie ściany ze zdjęciem, podmiana zdjęcia, ponowienie głębi"
```

---

### Task 4: Historia i cofanie zmiany zdjęcia

**Files:**
- Modify: `api/topo/changes.py:18-21` (`image_path` poza `SKIP_FIELDS`)
- Modify: `api/topo/revert.py` (grupa pól zdjęcia, `_restore_depth` dla podmienionych ścian, zadanie dla brakującej głębi)
- Test: `api/tests/test_api_photos.py` (cofanie), `api/tests/test_revert.py` (istniejące muszą przejść)

**Interfaces:**
- Consumes: endpointy z Task 3, `enqueue_depth`, `photo_folder`.
- Produces: diff `{"field": "image_path", "before": ..., "after": ...}` w historii.

- [ ] **Step 1: Testy (dopisać do `test_api_photos.py`)**

```python
from tests.test_revert import revert, tx_id


def test_replace_shows_in_history_and_reverts(editor, session, media):
    crag = make_crag(session)
    wall_id = crag.walls[0].id
    editor.put(f"/api/walls/{wall_id}/image", **upload())
    folder = media / "walls" / str(wall_id) / "1"
    Image.new("I;16", (32, 24)).save(folder / "depth.png")  # the worker computed photo 1
    session.execute(update(Wall).where(Wall.id == wall_id).values(depth_status="ready", depth_path=f"walls/{wall_id}/1/depth.png"))
    session.commit()
    editor.put(f"/api/walls/{wall_id}/image", **upload(jpeg(800, 600)))

    history = editor.get(f"/api/crags/{crag.id}/history").json()
    diffs = history["items"][0]["objects"][0]["diffs"]
    assert diffs == [{"field": "image_path", "before": f"walls/{wall_id}/1/display.webp", "after": f"walls/{wall_id}/2/display.webp"}]

    assert revert(editor, tx_id(session)).status_code == 200
    session.expire_all()
    wall = session.get(Wall, wall_id)
    assert (wall.image_path, wall.thumb_path) == (f"walls/{wall_id}/1/display.webp", f"walls/{wall_id}/1/thumb.webp")
    assert (wall.image_width, wall.image_height) == (640, 480)
    assert (wall.depth_status, wall.depth_path) == ("ready", f"walls/{wall_id}/1/depth.png")


def test_revert_to_photo_without_depth_queues_job(editor, session, media):
    crag = make_crag(session)
    wall_id = crag.walls[0].id
    editor.put(f"/api/walls/{wall_id}/image", **upload())
    editor.put(f"/api/walls/{wall_id}/image", **upload())
    session.execute(delete(DepthJob))
    session.commit()
    assert revert(editor, tx_id(session)).status_code == 200
    session.expire_all()
    assert session.get(Wall, wall_id).depth_status == "pending"
    assert queued(session, wall_id) == ["queued"]


def test_revert_wall_creation(editor, session, media):
    crag = make_crag(session)
    wall_id = editor.post(f"/api/crags/{crag.id}/walls", **upload()).json()["id"]
    assert revert(editor, tx_id(session)).status_code == 200
    session.expire_all()
    assert session.get(Wall, wall_id) is None
```
(Ścieżkę historii skały i kształt odpowiedzi sprawdzić w `api/topo/api/changes.py` / istniejących testach `test_history.py` i dopasować; `update`, `delete` z `sqlalchemy`.)

- [ ] **Step 2: `changes.py`**

Usunąć `"image_path"` z `SKIP_FIELDS` (zostają `image_original_path`, `thumb_path`, `image_width`, `image_height`).

- [ ] **Step 3: `revert.py`**

```python
# A photo is one value for history: image_path stands for the whole group.
PHOTO_FIELDS = ("image_original_path", "thumb_path", "image_width", "image_height")
```
W `_Planner.update` po pętli diffów:
```python
        if change.model is Wall and "image_path" in values:
            values.update({name: change.before[name] for name in PHOTO_FIELDS})
```
W `revert_transaction`:
```python
        photos = [obj_id for (model, obj_id), (_, values) in plan.restores.items() if model is Wall and "image_path" in values]
        ...
        _restore_depth(session, [c.id for c in plan.inserts if c.model is Wall] + photos, media_root)
```
(`photos` policzyć przed `_restore`, bo `_restore` nie zmienia `plan.restores`, ale czytelniej przed.) W `_restore_depth`: gdy brak `depth.png` i ściana ma `image_path` → `enqueue_depth(session, wall_id)`.

- [ ] **Step 4: Testy i commit**

Run: `docker compose run --rm api pytest -q` (cały backend) → PASS.
```bash
git commit -m "feat: zmiana zdjęcia w historii i jej cofanie"
```

---

### Task 5: Front — okno wgrywania, menu, status 2.5D, historia

**Files:**
- Modify: `web/src/lib/api.ts` (`sendForm`, `createWall`, `replaceWallImage`, `retryDepth`, typ `WallCreated`)
- Create: `web/src/crag/edit/PhotoUploadDialog.tsx`, `web/src/crag/edit/PhotoUploadDialog.test.tsx`
- Modify: `web/src/crag/edit/CragMenu.tsx` (pozycje menu)
- Create: `web/src/crag/DepthStatus.tsx`, `web/src/crag/DepthStatus.test.tsx`
- Modify: `web/src/pages/CragPage.tsx` (`DepthStatus` pod zdjęciem, `refetchInterval`)
- Modify: `web/src/history/format.ts`, `web/src/history/format.test.ts` (pole „zdjęcie”)

**Interfaces:**
- Consumes: endpointy z Task 3, diff `image_path` z Task 4.
- Produces: `PhotoUploadDialog({ crag: CragDetail; wall?: WallOut | null; onClose: () => void })`, `DepthStatus({ wall: WallOut })`.

- [ ] **Step 1: `api.ts`**

```ts
export interface WallCreated {
  id: number;
  version: number;
}

export function sendForm<T>(method: "POST" | "PUT", path: string, form: FormData): Promise<T> {
  return request<T>(path, { method, credentials: "same-origin", headers: { Accept: "application/json" }, body: form });
}
```
w obiekcie `api`:
```ts
  createWall: (cragId: number, form: FormData) => sendForm<WallCreated>("POST", `/api/crags/${cragId}/walls`, form),
  replaceWallImage: (id: number, form: FormData) => sendForm<WallCreated>("PUT", `/api/walls/${id}/image`, form),
  retryDepth: (id: number) => sendJson<{ queued: boolean }>("POST", `/api/walls/${id}/depth`),
```

- [ ] **Step 2: `PhotoUploadDialog.tsx`**

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type CragDetail, type WallOut } from "@/lib/api";
import { useEditorMutation } from "@/lib/session";

export const MAX_PHOTO_BYTES = 30 * 1024 * 1024;

interface Props {
  crag: CragDetail;
  /** The wall whose photo is replaced; without it a new wall is added. */
  wall?: WallOut | null;
  onClose: () => void;
}

export function PhotoUploadDialog({ crag, wall, onClose }: Props) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const upload = useEditorMutation(
    (form: FormData) => (wall ? api.replaceWallImage(wall.id, form) : api.createWall(crag.id, form)),
    {
      successToast: wall ? "Zdjęcie podmienione" : "Dodano ścianę",
      onSuccess: async (result) => {
        // The editor reads the crag from the cache: it must already have the new photo.
        await client.invalidateQueries({ queryKey: ["crag", crag.slug] });
        onClose();
        navigate(`/skaly/${crag.slug}/topo/${result.id}`);
      },
    },
  );

  function choose(next: File | undefined) {
    const large = !!next && next.size > MAX_PHOTO_BYTES;
    setTooLarge(large);
    setFile(next && !large ? next : null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    if (!wall && name.trim()) form.append("name", name.trim());
    if (comment.trim()) form.append("comment", comment.trim());
    upload.mutate(form);
  }

  const replacing = !!wall;
  const title = !replacing ? "Dodaj ścianę" : wall.image_url ? "Podmień zdjęcie" : "Dodaj zdjęcie";
  return (
    <Dialog open onOpenChange={(next) => !next && !upload.isPending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {replacing && wall.image_url
                ? "Linie dróg zostaną — po wgraniu otworzy się edytor, żeby je dopasować."
                : "Po wgraniu otworzy się edytor topo, żeby narysować drogi."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="photo-file">Zdjęcie (JPEG, PNG albo WebP, do 30 MB)</Label>
            <Input id="photo-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => choose(event.target.files?.[0])} />
            {tooLarge && <p role="alert" className="text-xs text-destructive">Zdjęcie jest większe niż 30 MB</p>}
          </div>
          {preview && <img src={preview} alt="Podgląd zdjęcia" className="max-h-60 w-full rounded-md object-contain bg-secondary" />}
          {!replacing && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="photo-name">Nazwa ściany (opcjonalnie)</Label>
              <Input id="photo-name" value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="photo-comment">Komentarz do zmiany (opcjonalnie)</Label>
            <Input id="photo-comment" value={comment} maxLength={500} onChange={(event) => setComment(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={upload.isPending}>
              Anuluj
            </Button>
            <Button type="submit" disabled={!file || upload.isPending}>
              {upload.isPending ? "Wysyłanie…" : "Wyślij"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```
Sprawdzić, czy `useEditorMutation` przyjmuje asynchroniczne `onSuccess` (typ `(result, variables) => void` — `async` zwraca Promise, TypeScript to akceptuje) i jak pokazuje błąd (toast z komunikatem API — tak jak przy innych zapisach).

- [ ] **Step 3: Test `PhotoUploadDialog.test.tsx`**

Wzorzec renderowania i `stubFetch` z `RouteEditPanel.test.tsx` (SessionProvider, QueryClient, MemoryRouter); `URL.createObjectURL` / `revokeObjectURL` stubowane (`vi.stubGlobal` nie działa na `URL` statyczne — przypisać `URL.createObjectURL = vi.fn(() => "blob:x")` w `beforeEach`). Przypadki:
```tsx
it("adds a wall and opens the editor", async () => {
  // fetch: /api/auth/me → {nick}, POST /api/crags/1/walls → 201 {id: 42, version: 1}, GET crag → crag
  // user.upload(input "Zdjęcie…", new File(["x"], "a.jpg", { type: "image/jpeg" })); type name "Lewa"; click "Wyślij"
  // expect POST url "/api/crags/{crag.id}/walls", body instanceof FormData, body.get("name") === "Lewa", body.get("file") is File
  // expect location /skaly/{slug}/topo/42 (render a <Routes> with a route that prints "EDYTOR")
});
it("rejects a file over 30 MB before sending", async () => {
  // File with size > MAX: Object.defineProperty(file, "size", { value: MAX_PHOTO_BYTES + 1 })
  // expect alert "Zdjęcie jest większe niż 30 MB", button "Wyślij" disabled, no POST
});
it("replaces the photo of a wall", async () => {
  // wall given → title "Podmień zdjęcie", no name field, PUT /api/walls/{id}/image
});
```
(Pełny kod testów pisany według tego szkieletu podczas wykonania; `stubFetch` z tego zadania zapisuje `init.body` bez `JSON.parse`, gdy jest `FormData`.)

- [ ] **Step 4: `CragMenu.tsx`**

`type Open = "wall" | "photo" | "add-wall" | ...`. W sekcji ściany przed „Edytuj topo”:
```tsx
<DropdownMenuItem onSelect={() => setOpen("photo")}>{wall.image_url ? "Podmień zdjęcie" : "Dodaj zdjęcie"}</DropdownMenuItem>
```
W sekcji skały (po separatorze, przed „Zamień w sektor”):
```tsx
<DropdownMenuItem onSelect={() => setOpen("add-wall")}>Dodaj ścianę</DropdownMenuItem>
```
Na dole:
```tsx
{open === "photo" && wall && <PhotoUploadDialog crag={crag} wall={wall} onClose={close} />}
{open === "add-wall" && <PhotoUploadDialog crag={crag} onClose={close} />}
```
Okno ładowane leniwie jak pozostałe okna w menu? `CragMenu` importuje okna wprost — zostaje tak samo.

- [ ] **Step 5: `DepthStatus.tsx` i `CragPage.tsx`**

```tsx
import { Button } from "@/components/ui/button";
import { api, type WallOut } from "@/lib/api";
import { useEditorMutation, useSession } from "@/lib/session";

/** Under the photo: the 2.5D model is being computed, or computing it failed (with a retry for editors). */
export function DepthStatus({ wall }: { wall: WallOut }) {
  const { isEditor } = useSession();
  const retry = useEditorMutation(() => api.retryDepth(wall.id), { invalidate: [["crag"]], successToast: "Ponowiono liczenie 2.5D" });
  if (!wall.image_url || (wall.depth_status !== "pending" && wall.depth_status !== "failed")) return null;
  return (
    <p data-testid="depth-status" className="flex items-center gap-2 text-[11px] text-muted-foreground">
      {wall.depth_status === "pending" ? "Model 2.5D w przygotowaniu" : "Nie udało się policzyć 2.5D"}
      {wall.depth_status === "failed" && isEditor && (
        <Button variant="link" size="sm" className="h-auto p-0 text-[11px]" disabled={retry.isPending} onClick={() => retry.mutate(undefined)}>
          Ponów
        </Button>
      )}
    </p>
  );
}
```
`CragPage.tsx`:
```tsx
const DEPTH_POLL_MS = 15_000;
...
useQuery({
  queryKey: ["crag", slug],
  queryFn: () => api.crag(slug),
  // While a photo waits for its depth map, check again now and then: 2.5D appears without a reload.
  refetchInterval: (query) => (query.state.data?.walls.some((w) => w.image_url && w.depth_status === "pending") ? DEPTH_POLL_MS : false),
});
```
`{wall && <DepthStatus wall={wall} />}` zaraz po bloku `WallViewer` (rodzeństwo `div.sticky`).

Test `DepthStatus.test.tsx`: pending → tekst; failed + zalogowany → „Ponów” wysyła `POST /api/walls/{id}/depth`; failed + niezalogowany (`/api/auth/me` → 401) → bez przycisku; ready → nic.

- [ ] **Step 6: Historia — `format.ts`**

```ts
  image_path: "zdjęcie",
```
w `FIELD_LABELS`, a w `formatValue` przed ogólnym przypadkiem:
```ts
  if (field === "image_path" && typeof value === "string") {
    const number = /^walls\/\d+\/(\d+)\//.exec(value)?.[1];
    return number ? `wersja ${number}` : "z importu";
  }
```
Test w `format.test.ts`:
```ts
it("formats a photo", () => {
  expect(fieldLabel("image_path")).toBe("zdjęcie");
  expect(formatValue("image_path", "walls/5/display.webp")).toBe("z importu");
  expect(formatValue("image_path", "walls/5/3/display.webp")).toBe("wersja 3");
});
```

- [ ] **Step 7: Testy i commit**

Run: `cd web; npx vitest run; npx tsc -b; npx oxlint` → PASS, bez nowych ostrzeżeń.
```bash
git commit -m "feat: wgrywanie zdjęć ścian i status 2.5D na stronie skały"
```

---

### Task 6: Sprawdzenie, przegląd gałęzi, wnioski

- [ ] **Step 1:** Cały backend `docker compose run --rm api pytest -q` i cały front `npx vitest run`, `npx tsc -b` → PASS.
- [ ] **Step 2:** Przebudowa obrazów (`docker compose build api`, `docker compose --profile depth build`), restart API; ręcznie przez API: wgranie zdjęcia na testową skałę w dev DB, sprawdzenie plików i `depth_job`; uruchomienie workera na chwilę, jeśli obraz `depth` jest gotowy (inaczej zostawić użytkownikowi).
- [ ] **Step 3:** Przegląd całej gałęzi (`git diff master...`): zgodność ze spec, błędy, brakujące testy; poprawki osobnym commitem.
- [ ] **Step 4:** „Wnioski z wykonania” na końcu tego planu; aktualizacja specu głównej (§8 worker) jednym zdaniem; zgłoszenie użytkownikowi gotowości do scalenia (bez scalania).

---

## Wnioski z wykonania

- Wykonanie inline (jedna sesja), testy pisane z kodem i uruchamiane raz na koniec zadania; przegląd gałęzi zrobiony samodzielnie (bez osobnego recenzenta).
- Nowa ściana dostaje id z sekwencji przed zapisem zdjęcia i jest wstawiana jednym INSERT — inaczej Continuum zapisywał ją jako „zmienioną”, a nie „dodaną”, i cofnięcie dodania kończyło się konfliktem.
- Cofnięcie (podmiany albo usunięcia ściany) dodaje zadanie głębi, gdy w katalogu zdjęcia brakuje `depth.png` albo `segments.png`.
- Po przeglądzie: API przyjmuje tylko JPEG, PNG i WebP (wcześniej każdy format Pillow), zdjęcia MPO z telefonów są JPEG-ami z rozszerzeniem `.jpg`; worker nie wywraca się, gdy ściana zniknie w trakcie liczenia.
- Sprawdzone na bazie dev: wgranie → `walls/{id}/1/`, worker na starym obrazie `topo-depth` (Large, GPU) liczy ścianę w ~2 s, podmiana i jej cofnięcie przywracają zdjęcie z gotową głębią, SIGTERM zatrzymuje workera w ~3 s.
- Do zrobienia przy okazji: obraz `depth` trzeba przebudować (`docker compose --profile depth build depth`), bo zmienił się `uv.lock` (worker działa i na starym, multipart potrzebne jest tylko w API); produkcyjny nginx potrzebuje `client_max_body_size 30m`.
- Odłożone drobiazgi: błąd segmentacji po udanej głębi zostawia status `ready` bez „Ponów”; po wyjściu z edytora nowej ściany strona skały pokazuje pierwszą ścianę; zadanie dla cofniętego zdjęcia czeka do uruchomienia workera (kończy się bez liczenia); `depth_model` po przywróceniu z dysku jest pusty.
