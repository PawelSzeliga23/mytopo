# Plan 5a: mapy głębi (CLI, GPU) i próba na ≤ 100 skałach — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Komenda `topo depth`, która dla zdjęć ścian liczy mapy głębi modelem Depth Anything V2 (Large na GPU), zapisuje je jako `media/walls/{id}/depth.png` i ustawia `wall.depth_status`, oraz galeria podglądu (zdjęcie z liniami, głębia w kolorze, cieniowanie rzeźby, interaktywny podgląd 2.5D) do oceny wyników. Plan kończy się próbą na co najwyżej 100 skałach i **zatrzymaniem** na ocenę użytkownika — widok 2.5D w aplikacji to osobny plan 5b, pisany po tej ocenie.

**Architecture:** Cała logika w `api/topo/depth.py`: czyste funkcje (rozmiar, normalizacja, zapis PNG 16-bit), wybór ścian do przeliczenia i pętla przeliczania; model ukryty za protokołem `DepthEstimator`, więc testy używają atrapy, a torch/transformers są importowane dopiero w `HFDepthEstimator`. Status głębi zapisywany zwykłym `UPDATE` na tabeli (bez wersji w historii — to dane wyliczone, a wersja bez autora oznaczałaby dla importera „ręczną edycję”). Model działa w osobnej usłudze Dockera `depth` (ten sam kod, obraz z dodatkiem `--extra depth` i dostępem do GPU), więc obraz `api` nie rośnie o PyTorch. Galeria (`api/topo/depth_preview.py`) to statyczne pliki w `./cache/glebia/`.

**Tech Stack:** Python 3.12, SQLAlchemy 2, Typer, Pillow, numpy (nowa zależność), PyTorch + transformers (tylko dodatek `depth`), Depth Anything V2 (`depth-anything/Depth-Anything-V2-Large-hf`, `…-Small-hf`), Docker Compose z GPU NVIDIA (RTX 3060 12 GB, runtime `nvidia` jest w Docker Desktop). Galeria: HTML + three.js 0.170 z unpkg.

**Spec:** `docs/superpowers/specs/2026-10-08-topo-design.md` §3 (architektura, CLI), §3.1 (Depth Anything V2), §4 (`wall.depth_*`), §7 (pliki: `depth.png`, PNG 16-bit ~768 px), §8 (`topo depth --all [--model large|small] [--only-model small] [--force]`), §9 (błąd → `depth_status=failed`), §10 (test modelu Small na CPU, oznaczony jako wolny). Wnioski o drzewach: koniec `docs/superpowers/plans/2026-10-08-plan-4-strona-skaly.md`.

## Global Constraints

- Mapa głębi: PNG 16-bit w skali szarości, dłuższy bok **768 px** (bez powiększania mniejszych zdjęć), proporcje jak zdjęcie, **jasne = bliżej** (Depth Anything V2 zwraca odwrotność głębi — większa wartość to bliżej; nie odwracamy). Normalizacja na zakres 0–65535 między 1. a 99. percentylem.
- Plik: `media/walls/{wall_id}/depth.png`; w bazie `wall.depth_path = "walls/{id}/depth.png"`, `depth_status` ∈ `pending|ready|failed`, `depth_model` = `depth-anything-v2-large` albo `depth-anything-v2-small`.
- Wejście modelu: `wall.image_path` (WebP 1600 px), nie oryginał.
- Zapis statusu głębi **bez** wersji w historii (Continuum): `UPDATE` na `Wall.__table__`, nie zmiana atrybutów obiektu ORM.
- Nowa zależność główna: tylko `numpy`. `torch` i `transformers` wyłącznie w `[project.optional-dependencies] depth`; `topo.depth` nie może importować ich na poziomie modułu (obraz `api` ich nie ma).
- Komunikaty CLI po polsku.
- Tabela `depth_job` i kolejka na serwerze — poza zakresem (plan 7).
- Testy API: `docker compose run --rm api pytest -q`; wolny test modelu: `docker compose run --rm depth pytest -m slow -q`.
- **Zasada testów:** testy pisane razem z kodem, uruchamiane raz na końcu zadania.
- Import z Portalu Górskiego może w tym czasie działać w kontenerze `topo-api-run-…` — **nie zatrzymywać go** i nie restartować bazy. Przebudowa obrazów nie wpływa na działający kontener.

## Review Focus

1. **Brak albo uszkodzony plik zdjęcia ściany** — ściana dostaje `depth_status=failed`, przeliczanie idzie dalej, raport wymienia ścianę — Task 1 `test_depth.py::test_run_marks_broken_wall_failed_and_continues`.
2. **Ponowne uruchomienie** — gotowe ściany są pomijane, `--force` liczy je od nowa, `--only-model small` wybiera tylko ściany z modelem Small — Task 1 `test_select_*`.
3. **Zapis głębi a historia zmian** — przeliczenie nie dopisuje wersji ściany w historii (inaczej importer uznałby ścianę za ręcznie edytowaną i pomijał ją) — Task 1 `test_process_wall_does_not_create_history_version`.
4. **Płaska albo zepsuta odpowiedź modelu (stała wartość, NaN, ±inf)** — brak dzielenia przez zero, poprawny PNG — Task 1 `test_normalize_*`.
5. **Przerwanie Ctrl+C w trakcie** — gotowe ściany zostają `ready`, kod wyjścia 130, komunikat po polsku — Task 3 `test_depth_command_interrupt`.

---

## Struktura plików

```
api/pyproject.toml                 + numpy; dodatek depth (torch, transformers); znacznik pytest „slow” (Task 1, 2)
api/uv.lock                        przeliczony (Task 1, 2)
api/Dockerfile                     ARG EXTRAS (Task 2)
docker-compose.yml                 usługa depth z GPU, profil „depth” (Task 2)
api/topo/depth.py                  rozmiar, normalizacja, PNG, wybór ścian, przeliczanie, HFDepthEstimator (Task 1, 2)
api/topo/depth_preview.py          kolorowanie, cieniowanie, galeria HTML + podgląd 2.5D (Task 4)
api/topo/cli.py                    komendy depth i depth-preview (Task 3, 4)
api/tests/test_depth.py            (Task 1)
api/tests/test_depth_model.py      wolny test modelu Small (Task 2)
api/tests/test_cli.py              + testy komend (Task 3, 4)
api/tests/test_depth_preview.py    (Task 4)
README.md                          + sekcja „Mapy głębi” (Task 3, 4)
```

---

### Task 1: Rdzeń map głębi (`topo.depth`)

**Files:**
- Modify: `api/pyproject.toml` (dependencies: `"numpy>=2.0"`), `api/uv.lock`
- Create: `api/topo/depth.py`
- Test: `api/tests/test_depth.py`

**Interfaces:**
- Consumes: `topo.models.Wall` (pola `image_path`, `depth_path`, `depth_status`, `depth_model`, relacja `crag`), `sqlalchemy_continuum.version_class`, fabryki `tests/factories.py`.
- Produces (w `topo.depth`):
  - `DEPTH_MAX = 768`, `DEPTH_FILE = "depth.png"`
  - `class DepthEstimator(Protocol)`: atrybut `name: str`, metoda `predict(image: PIL.Image.Image) -> numpy.ndarray` (2D, float, dowolna rozdzielczość, większa wartość = bliżej)
  - `depth_size(width: int, height: int) -> tuple[int, int]`
  - `normalize_depth(raw: np.ndarray) -> np.ndarray` (uint16)
  - `compute_depth(image: Image.Image, estimator: DepthEstimator) -> np.ndarray` (uint16, kształt `(h, w)` z `depth_size`)
  - `save_depth_png(path: Path, depth: np.ndarray) -> None`, `load_depth(path: Path) -> np.ndarray` (uint16)
  - `select_walls(session, *, wall_ids: list[int] | None = None, crag_limit: int | None = None, only_model: str | None = None, force: bool = False) -> list[Wall]`
  - `process_wall(session, wall: Wall, media_root: Path, estimator: DepthEstimator) -> None` (przy błędzie: status `failed`, wyjątek leci dalej)
  - `@dataclass DepthReport(done: int = 0, failed: list[str])`
  - `run_depth(session, walls: list[Wall], media_root: Path, estimator: DepthEstimator, log: Callable[[str], None] = print) -> DepthReport`

- [ ] **Step 1: Dodaj numpy i przelicz lock**

W `api/pyproject.toml` do `dependencies` dopisz `"numpy>=2.0",` (po `"pillow>=10.4",`). Potem:

```powershell
docker run --rm -v "${PWD}/api:/app" -w /app ghcr.io/astral-sh/uv:python3.12-bookworm-slim uv lock
docker compose build api
```

(`docker compose build api` tylko buduje obraz — działający import i serwer API zostają na starym obrazie.)

- [ ] **Step 2: Napisz testy**

`api/tests/test_depth.py`:

```python
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy_continuum import version_class

from tests import factories as f
from topo.depth import (
    DEPTH_MAX,
    compute_depth,
    depth_size,
    load_depth,
    normalize_depth,
    process_wall,
    run_depth,
    save_depth_png,
    select_walls,
)
from topo.models import Wall


class FakeEstimator:
    """Depth = brightness of the photo's red channel, at half resolution (like a real model's own size)."""

    name = "fake-model"

    def predict(self, image):
        small = image.resize((image.width // 2, image.height // 2))
        return np.asarray(small, dtype=np.float32)[:, :, 0]


def photo(media_root: Path, wall_id: int, size=(1600, 1200)) -> str:
    relative = f"walls/{wall_id}/display.webp"
    (media_root / "walls" / str(wall_id)).mkdir(parents=True, exist_ok=True)
    gradient = np.tile(np.linspace(0, 255, size[0], dtype=np.uint8), (size[1], 1))
    Image.fromarray(np.stack([gradient] * 3, axis=-1)).save(media_root / relative, "WEBP")
    return relative


def test_depth_size_limits_longer_side_without_upscaling():
    assert depth_size(1600, 1200) == (768, 576)
    assert depth_size(1200, 1600) == (576, 768)
    assert depth_size(640, 480) == (640, 480)
    assert max(depth_size(1600, 7)) == DEPTH_MAX and min(depth_size(1600, 7)) >= 1


def test_normalize_spreads_to_full_range_and_keeps_near_bright():
    raw = np.linspace(0.0, 10.0, 1000, dtype=np.float32).reshape(10, 100)
    depth = normalize_depth(raw)
    assert depth.dtype == np.uint16
    assert depth.min() == 0 and depth.max() == 65535
    assert depth[0, 0] < depth[-1, -1]


def test_normalize_constant_input_gives_zeros():
    depth = normalize_depth(np.full((4, 4), 3.0, dtype=np.float32))
    assert depth.dtype == np.uint16 and not depth.any()


def test_normalize_survives_nan_and_inf():
    raw = np.linspace(0.0, 1.0, 100, dtype=np.float32).reshape(10, 10)
    raw[0, 0], raw[0, 1], raw[0, 2] = np.nan, np.inf, -np.inf
    depth = normalize_depth(raw)
    assert depth.dtype == np.uint16 and depth.max() == 65535


def test_compute_depth_resizes_to_depth_size():
    image = Image.new("RGB", (1600, 1200), (200, 10, 10))
    assert compute_depth(image, FakeEstimator()).shape == (576, 768)


def test_png_roundtrip_keeps_16_bits(tmp_path):
    depth = np.array([[0, 1, 65535], [300, 40000, 7]], dtype=np.uint16)
    save_depth_png(tmp_path / "d.png", depth)
    np.testing.assert_array_equal(load_depth(tmp_path / "d.png"), depth)


def _walls(session, media_root):
    region = f.area(session, "R")
    first, second = f.crag(session, region, "Pierwsza"), f.crag(session, region, "Druga")
    walls = []
    for crag in (first, first, second):
        wall = f.wall(session, crag)
        wall.image_path = photo(media_root, wall.id, size=(64, 48))
        walls.append(wall)
    no_photo = f.wall(session, second)
    session.flush()
    return walls, no_photo


def test_select_skips_ready_and_walls_without_photo(session, tmp_path):
    walls, no_photo = _walls(session, tmp_path)
    walls[0].depth_status = "ready"
    session.flush()
    selected = select_walls(session)
    assert walls[0] not in selected and no_photo not in selected
    assert set(selected) == {walls[1], walls[2]}


def test_select_force_includes_ready(session, tmp_path):
    walls, _ = _walls(session, tmp_path)
    walls[0].depth_status = "ready"
    session.flush()
    assert set(select_walls(session, force=True)) == set(walls)


def test_select_only_model(session, tmp_path):
    walls, _ = _walls(session, tmp_path)
    walls[0].depth_status, walls[0].depth_model = "ready", "depth-anything-v2-small"
    walls[1].depth_status, walls[1].depth_model = "ready", "depth-anything-v2-large"
    session.flush()
    assert select_walls(session, only_model="depth-anything-v2-small") == [walls[0]]


def test_select_crag_limit_takes_first_crags_with_photos(session, tmp_path):
    walls, _ = _walls(session, tmp_path)
    assert select_walls(session, crag_limit=1) == walls[:2]


def test_select_wall_ids(session, tmp_path):
    walls, _ = _walls(session, tmp_path)
    assert select_walls(session, wall_ids=[walls[2].id]) == [walls[2]]


def test_process_wall_writes_png_and_marks_ready(session, tmp_path):
    walls, _ = _walls(session, tmp_path)
    wall = walls[0]
    process_wall(session, wall, tmp_path, FakeEstimator())
    assert (wall.depth_status, wall.depth_model) == ("ready", "fake-model")
    assert wall.depth_path == f"walls/{wall.id}/depth.png"
    depth = load_depth(tmp_path / wall.depth_path)
    assert depth.shape == (48, 64)
    assert depth[:, 0].mean() < depth[:, -1].mean()


def test_process_wall_does_not_create_history_version(session, tmp_path):
    # Factories already wrote versions without an author, so compare counts instead of is_manually_edited.
    walls, _ = _walls(session, tmp_path)
    versions = version_class(Wall)

    def count():
        return session.scalar(select(func.count()).select_from(versions).where(versions.id == walls[0].id))

    before = count()
    process_wall(session, walls[0], tmp_path, FakeEstimator())
    assert count() == before


def test_run_marks_broken_wall_failed_and_continues(session, tmp_path):
    walls, _ = _walls(session, tmp_path)
    (tmp_path / walls[1].image_path).write_bytes(b"to nie jest obraz")
    lines = []
    report = run_depth(session, walls, tmp_path, FakeEstimator(), log=lines.append)
    assert report.done == 2 and len(report.failed) == 1
    assert f"#{walls[1].id}" in report.failed[0]
    assert [w.depth_status for w in walls] == ["ready", "failed", "ready"]
    assert lines[0].startswith("[1/3] Pierwsza")


def test_run_marks_missing_photo_failed(session, tmp_path):
    walls, _ = _walls(session, tmp_path)
    (tmp_path / walls[0].image_path).unlink()
    report = run_depth(session, walls[:1], tmp_path, FakeEstimator(), log=lambda _: None)
    assert report.done == 0 and walls[0].depth_status == "failed"
```

- [ ] **Step 3: Zaimplementuj `api/topo/depth.py`**

```python
"""Depth maps of wall photos (Depth Anything V2): a 16-bit PNG next to the photo, brighter = nearer."""

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import numpy as np
from PIL import Image
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from topo.models import Wall

DEPTH_MAX = 768
DEPTH_FILE = "depth.png"


class DepthEstimator(Protocol):
    name: str

    def predict(self, image: Image.Image) -> np.ndarray:
        """2D relative depth at any resolution; larger = nearer."""


def depth_size(width: int, height: int) -> tuple[int, int]:
    scale = min(1.0, DEPTH_MAX / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale))


def normalize_depth(raw: np.ndarray) -> np.ndarray:
    values = np.asarray(raw, dtype=np.float64)
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return np.zeros(values.shape, dtype=np.uint16)
    low, high = np.percentile(finite, [1, 99])
    if high - low < 1e-9:
        return np.zeros(values.shape, dtype=np.uint16)
    values = np.nan_to_num(values, nan=low, posinf=high, neginf=low)
    scaled = (np.clip(values, low, high) - low) / (high - low)
    return np.round(scaled * 65535).astype(np.uint16)


def compute_depth(image: Image.Image, estimator: DepthEstimator) -> np.ndarray:
    raw = np.asarray(estimator.predict(image), dtype=np.float32)
    resized = Image.fromarray(raw).resize(depth_size(image.width, image.height), Image.Resampling.BILINEAR)
    return normalize_depth(np.asarray(resized))


def save_depth_png(path: Path, depth: np.ndarray) -> None:
    Image.fromarray(depth.astype(np.uint16)).save(path, "PNG")


def load_depth(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        return np.asarray(image).astype(np.uint16)


def select_walls(
    session: Session,
    *,
    wall_ids: list[int] | None = None,
    crag_limit: int | None = None,
    only_model: str | None = None,
    force: bool = False,
) -> list[Wall]:
    """Walls with a photo to (re)compute, ordered by crag; ``crag_limit`` = first N crags with photos."""
    stmt = select(Wall).where(Wall.image_path.is_not(None)).order_by(Wall.crag_id, Wall.sort_order, Wall.id)
    if wall_ids:
        stmt = stmt.where(Wall.id.in_(wall_ids))
    if only_model:
        stmt = stmt.where(Wall.depth_model == only_model)
    elif not force:
        stmt = stmt.where(Wall.depth_status != "ready")
    if crag_limit is not None:
        first_crags = (
            select(Wall.crag_id).where(Wall.image_path.is_not(None))
            .group_by(Wall.crag_id).order_by(Wall.crag_id).limit(crag_limit)
        )
        stmt = stmt.where(Wall.crag_id.in_(first_crags))
    return list(session.scalars(stmt))


def _set_depth(session: Session, wall: Wall, **values) -> None:
    # Core UPDATE on purpose: depth is derived data, not an edit. A Continuum version without an
    # "import:" author would make the importer treat the wall as manually edited and skip it.
    session.execute(update(Wall.__table__).where(Wall.__table__.c.id == wall.id).values(**values))
    session.commit()
    session.refresh(wall, ["depth_path", "depth_status", "depth_model"])


def process_wall(session: Session, wall: Wall, media_root: Path, estimator: DepthEstimator) -> None:
    relative = Path("walls") / str(wall.id) / DEPTH_FILE
    try:
        with Image.open(Path(media_root) / wall.image_path) as image:
            depth = compute_depth(image.convert("RGB"), estimator)
        target = Path(media_root) / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        save_depth_png(target, depth)
    except Exception:
        _set_depth(session, wall, depth_status="failed")
        raise
    _set_depth(session, wall, depth_path=relative.as_posix(), depth_status="ready", depth_model=estimator.name)


@dataclass
class DepthReport:
    done: int = 0
    failed: list[str] = field(default_factory=list)


def run_depth(
    session: Session,
    walls: list[Wall],
    media_root: Path,
    estimator: DepthEstimator,
    log: Callable[[str], None] = print,
) -> DepthReport:
    report = DepthReport()
    for index, wall in enumerate(walls, 1):
        label = f"{wall.crag.name} — {wall.name or 'ściana'} (#{wall.id})"
        started = time.perf_counter()
        try:
            process_wall(session, wall, media_root, estimator)
        except Exception as exc:
            report.failed.append(f"{label}: {exc}")
            log(f"[{index}/{len(walls)}] {label}: BŁĄD {exc}")
            continue
        report.done += 1
        log(f"[{index}/{len(walls)}] {label}: ok ({time.perf_counter() - started:.1f} s)")
    return report
```

Uwaga: jeśli `session.refresh` po `commit` w fixture testowym (SAVEPOINT) nie zadziała, nie zmieniaj podejścia na ustawianie atrybutów ORM (to tworzy wersję w historii) — zgłoś problem.

- [ ] **Step 4: Uruchom testy**

Run: `docker compose run --rm api pytest -q`
Expected: wszystkie PASS (nowe z `test_depth.py` i dotychczasowe).

- [ ] **Step 5: Commit**

```powershell
git add api/pyproject.toml api/uv.lock api/topo/depth.py api/tests/test_depth.py
git commit -m "feat: rdzeń map głębi — normalizacja, PNG 16-bit, wybór ścian i przeliczanie" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Model Depth Anything V2 i usługa Dockera z GPU

**Files:**
- Modify: `api/pyproject.toml` (dodatek `depth`, znacznik `slow`), `api/uv.lock`, `api/Dockerfile`, `docker-compose.yml`
- Modify: `api/topo/depth.py` (+ `MODELS`, `model_name`, `HFDepthEstimator`)
- Test: `api/tests/test_depth_model.py`

**Interfaces:**
- Consumes: `DepthEstimator`, `compute_depth`, `DEPTH_MAX` z Task 1.
- Produces:
  - `MODELS: dict[str, str] = {"large": "depth-anything/Depth-Anything-V2-Large-hf", "small": "depth-anything/Depth-Anything-V2-Small-hf"}`
  - `model_name(key: str) -> str` → `"depth-anything-v2-" + key`
  - `class HFDepthEstimator(model: str = "large", device: str | None = None)` z `name`, `device: str`, `predict(image)`
  - Usługa compose `depth` (profil `depth`): `docker compose run --rm depth topo …`

- [ ] **Step 1: Zależności i konfiguracja pytest w `api/pyproject.toml`**

Po bloku `[project.scripts]` dodaj:

```toml
[project.optional-dependencies]
depth = [
    "torch>=2.4",
    "transformers>=4.45",
]
```

A `[tool.pytest.ini_options]` zamień na:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
markers = ["slow: wymaga modelu głębi (torch, transformers) — uruchamiaj w usłudze depth: pytest -m slow"]
addopts = "-m 'not slow'"
```

Przelicz lock: `docker run --rm -v "${PWD}/api:/app" -w /app ghcr.io/astral-sh/uv:python3.12-bookworm-slim uv lock`

- [ ] **Step 2: `api/Dockerfile` — opcjonalne dodatki**

```dockerfile
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ARG EXTRAS=""
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project ${EXTRAS}
COPY . .
RUN uv sync --frozen ${EXTRAS}

EXPOSE 8000
CMD ["uvicorn", "topo.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 3: Usługa `depth` w `docker-compose.yml`**

Dopisz pod usługą `api` (przed `volumes:` najwyższego poziomu):

```yaml
  depth:
    build:
      context: ./api
      args:
        EXTRAS: "--extra depth"
    image: topo-depth
    profiles: ["depth"]
    env_file:
      - path: .env
        required: false
    environment:
      DATABASE_URL: ${DATABASE_URL:-postgresql+psycopg://topo:topo@db:5432/topo}
      TEST_DATABASE_URL: ${TEST_DATABASE_URL:-postgresql+psycopg://topo:topo@db:5432/topo_test}
      HF_HOME: /data/cache/huggingface
    command: ["topo", "depth", "--help"]
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

(`HF_HOME` w `./cache/huggingface` — model pobiera się raz, ok. 1,3 GB dla Large.)

- [ ] **Step 4: Wolny test modelu**

`api/tests/test_depth_model.py`:

```python
import numpy as np
import pytest
from PIL import Image

pytest.importorskip("transformers")
pytestmark = pytest.mark.slow


def test_small_model_on_cpu_gives_depth_map_of_expected_size():
    from topo.depth import HFDepthEstimator, compute_depth

    gradient = np.tile(np.linspace(0, 255, 1600, dtype=np.uint8), (1200, 1))
    image = Image.fromarray(np.stack([gradient, gradient // 2, 255 - gradient], axis=-1))
    estimator = HFDepthEstimator("small", device="cpu")
    depth = compute_depth(image, estimator)

    assert estimator.name == "depth-anything-v2-small"
    assert depth.shape == (576, 768) and depth.dtype == np.uint16
    assert depth.max() > depth.min()
```

- [ ] **Step 5: `HFDepthEstimator` w `api/topo/depth.py`**

Pod `DEPTH_FILE` dodaj:

```python
MODELS = {
    "large": "depth-anything/Depth-Anything-V2-Large-hf",
    "small": "depth-anything/Depth-Anything-V2-Small-hf",
}


def model_name(key: str) -> str:
    return f"depth-anything-v2-{key}"
```

Na końcu pliku:

```python
class HFDepthEstimator:
    """Depth Anything V2 via transformers; torch is imported here so the api image works without it."""

    def __init__(self, model: str = "large", device: str | None = None) -> None:
        import torch
        from transformers import AutoImageProcessor, AutoModelForDepthEstimation

        self._torch = torch
        self.name = model_name(model)
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self._processor = AutoImageProcessor.from_pretrained(MODELS[model])
        self._model = AutoModelForDepthEstimation.from_pretrained(MODELS[model]).to(self.device).eval()

    def predict(self, image: Image.Image) -> np.ndarray:
        inputs = self._processor(images=image, return_tensors="pt").to(self.device)
        with self._torch.inference_mode():
            predicted = self._model(**inputs).predicted_depth
        return predicted.squeeze().float().cpu().numpy()
```

- [ ] **Step 6: Zbuduj obraz i uruchom testy**

```powershell
docker compose --profile depth build depth
docker compose run --rm depth python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
docker compose run --rm depth pytest -m slow -q
docker compose build api
docker compose run --rm api pytest -q
```

Expected: druga komenda wypisuje `True NVIDIA GeForce RTX 3060`; wolny test PASS (pierwsze uruchomienie pobiera model Small); w `api` wszystkie PASS, a test modelu nie jest zbierany (odznaczony przez `-m 'not slow'`, a bez transformers pominięty). Jeśli `cuda.is_available()` jest `False`, zatrzymaj się i zgłoś (sterownik / Docker Desktop GPU) — reszta planu wymaga GPU tylko dla szybkości, nie poprawności.

- [ ] **Step 7: Commit**

```powershell
git add api/pyproject.toml api/uv.lock api/Dockerfile docker-compose.yml api/topo/depth.py api/tests/test_depth_model.py
git commit -m "feat: model Depth Anything V2 i usługa depth z GPU" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Komenda `topo depth`

**Files:**
- Modify: `api/topo/cli.py`, `README.md`
- Test: `api/tests/test_cli.py`

**Interfaces:**
- Consumes: `select_walls`, `run_depth`, `DepthReport`, `HFDepthEstimator`, `MODELS`, `model_name` z `topo.depth`; `SessionLocal`, `get_settings` (importowane w `topo.cli` — testy podmieniają `topo.cli.SessionLocal`, `topo.cli.get_settings`, `topo.cli.HFDepthEstimator`).
- Produces: `topo depth (--all | --crags N | --wall ID … | --only-model small|large) [--model large|small] [--force]`.

- [ ] **Step 1: Testy w `api/tests/test_cli.py`**

Dopisz na końcu (importy na górę pliku: `from contextlib import nullcontext`, `import numpy as np`, `from topo.config import Settings`):

```python
class FakeDepthEstimator:
    name = "depth-anything-v2-large"
    device = "cpu"

    def __init__(self, model="large", device=None):
        pass

    def predict(self, image):
        return np.asarray(image, dtype=np.float32)[:, :, 0]


def _depth_setup(session, tmp_path, monkeypatch, crags=("Pierwsza", "Druga")):
    monkeypatch.setattr("topo.cli.SessionLocal", lambda: nullcontext(session))
    monkeypatch.setattr("topo.cli.get_settings", lambda: Settings(media_root=str(tmp_path), cache_dir=str(tmp_path)))
    monkeypatch.setattr("topo.cli.HFDepthEstimator", FakeDepthEstimator)
    region = f.area(session, "R")
    walls = []
    for name in crags:
        wall = f.wall(session, f.crag(session, region, name))
        (tmp_path / "walls" / str(wall.id)).mkdir(parents=True)
        Image.new("RGB", (40, 30), (wall.id * 20 % 255, 0, 0)).save(tmp_path / "walls" / str(wall.id) / "display.webp")
        wall.image_path = f"walls/{wall.id}/display.webp"
        walls.append(wall)
    session.flush()
    return walls


def test_depth_command_requires_selection():
    result = CliRunner().invoke(app, ["depth"])
    assert result.exit_code != 0
    assert "--all" in result.output


def test_depth_command_rejects_unknown_model():
    result = CliRunner().invoke(app, ["depth", "--all", "--model", "huge"])
    assert result.exit_code != 0
    assert "large" in result.output


def test_depth_command_crags_limit(session, tmp_path, monkeypatch):
    walls = _depth_setup(session, tmp_path, monkeypatch)
    result = CliRunner().invoke(app, ["depth", "--crags", "1"])
    assert result.exit_code == 0, result.output
    assert "Gotowe: 1" in result.output
    assert [w.depth_status for w in walls] == ["ready", "pending"]


def test_depth_command_nothing_to_do(session, tmp_path, monkeypatch):
    walls = _depth_setup(session, tmp_path, monkeypatch)
    for wall in walls:
        wall.depth_status = "ready"
    session.flush()
    result = CliRunner().invoke(app, ["depth", "--all"])
    assert result.exit_code == 0
    assert "Nic do przeliczenia" in result.output


def test_depth_command_interrupt(session, tmp_path, monkeypatch):
    walls = _depth_setup(session, tmp_path, monkeypatch)
    calls = []

    class Interrupting(FakeDepthEstimator):
        def predict(self, image):
            calls.append(1)
            if len(calls) == 2:
                raise KeyboardInterrupt
            return super().predict(image)

    monkeypatch.setattr("topo.cli.HFDepthEstimator", Interrupting)
    result = CliRunner().invoke(app, ["depth", "--all"])
    assert result.exit_code == 130
    assert "Przerwano" in result.output
    assert walls[0].depth_status == "ready"
```

Uwaga: `KeyboardInterrupt` nie jest `Exception`, więc `run_depth` go nie łapie — przechodzi do CLI. Ściana przerwana w trakcie zostaje `pending` (bez zapisu), co jest poprawne.

- [ ] **Step 2: Komenda w `api/topo/cli.py`**

Import: `from topo.depth import MODELS, DepthReport, HFDepthEstimator, model_name, run_depth, select_walls`.

```python
@app.command("depth")
def depth_command(
    all_walls: bool = typer.Option(False, "--all", help="Wszystkie ściany ze zdjęciem bez gotowej mapy głębi"),
    crags: int | None = typer.Option(None, "--crags", help="Tylko ściany pierwszych N skał (próbnie)"),
    wall_ids: list[int] | None = typer.Option(None, "--wall", help="Tylko ta ściana (można powtórzyć)"),
    model: str = typer.Option("large", "--model", help="large (GPU) albo small (CPU)"),
    only_model: str | None = typer.Option(None, "--only-model", help="Przelicz ściany zrobione tym modelem (large/small)"),
    force: bool = typer.Option(False, "--force", help="Licz od nowa także gotowe"),
) -> None:
    """Liczy mapy głębi zdjęć ścian (Depth Anything V2)."""
    for key in (model, only_model):
        if key is not None and key not in MODELS:
            raise typer.BadParameter(f"Nieznany model {key!r} — dostępne: {', '.join(MODELS)}")
    if not (all_walls or crags or wall_ids or only_model):
        raise typer.BadParameter("Podaj --all, --crags N, --wall ID albo --only-model")
    settings = get_settings()
    with SessionLocal() as session:
        walls = select_walls(
            session, wall_ids=wall_ids or None, crag_limit=crags,
            only_model=model_name(only_model) if only_model else None, force=force,
        )
        if not walls:
            typer.echo("Nic do przeliczenia.")
            return
        typer.echo(f"Ścian do przeliczenia: {len(walls)}. Wczytuję model {model}…")
        estimator = HFDepthEstimator(model)
        typer.echo(f"Model {estimator.name} na {estimator.device}.")
        try:
            report = run_depth(session, walls, Path(settings.media_root), estimator, log=typer.echo)
        except KeyboardInterrupt:
            typer.echo("Przerwano — gotowe mapy głębi zostają, ponowne uruchomienie dokończy resztę.")
            raise typer.Exit(130)
    _print_depth_report(report)


def _print_depth_report(report: DepthReport) -> None:
    typer.echo(f"Gotowe: {report.done}, błędy: {len(report.failed)}")
    for line in report.failed:
        typer.echo(f"  {line}")
```

Uwaga: `typer.BadParameter` poza callbackiem daje kod 2 i komunikat w wyjściu — to wystarczy dla testów (`exit_code != 0`, tekst w `result.output`). Jeśli Typer tego nie wypisze do `result.output`, użyj `typer.echo(..., err=True)` + `raise typer.Exit(2)` (CliRunner domyślnie miesza stderr z wyjściem).

- [ ] **Step 3: README — sekcja „Mapy głębi”**

Dopisz w `README.md` po sekcji „Import z Portalu Górskiego”:

````markdown
## Mapy głębi

Liczone modelem Depth Anything V2 w osobnej usłudze z GPU (obraz z PyTorch, ok. 6–8 GB):

```powershell
docker compose --profile depth build depth
docker compose run --rm depth topo depth --crags 100        # próbnie: ściany pierwszych 100 skał
docker compose run --rm depth topo depth --all              # wszystkie bez gotowej głębi (Large, GPU)
docker compose run --rm depth topo depth --only-model small # przelicz ściany zrobione modelem Small
docker compose run --rm depth topo depth --wall 12 --force  # jedna ściana od nowa
docker compose run --rm depth pytest -m slow                # test prawdziwego modelu (Small, CPU)
```

Wynik: `media/walls/{id}/depth.png` (PNG 16-bit, dłuższy bok 768 px, jasne = bliżej). Modele pobierają się do `./cache/huggingface/`.
````

- [ ] **Step 4: Uruchom testy**

Run: `docker compose run --rm api pytest -q`
Expected: wszystkie PASS.

- [ ] **Step 5: Commit**

```powershell
git add api/topo/cli.py api/tests/test_cli.py README.md
git commit -m "feat: komenda topo depth" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Galeria podglądu map głębi (`topo depth-preview`)

**Files:**
- Create: `api/topo/depth_preview.py`
- Modify: `api/topo/cli.py`, `README.md`
- Test: `api/tests/test_depth_preview.py`, `api/tests/test_cli.py`

**Interfaces:**
- Consumes: `load_depth`, `DEPTH_FILE` z `topo.depth`; `render_wall_preview(wall, media_root) -> Image` z `topo.importer.preview`.
- Produces (w `topo.depth_preview`):
  - `colorize(depth: np.ndarray) -> Image.Image` (RGB, paleta turbo: daleko = granat, blisko = czerwień)
  - `hillshade(depth: np.ndarray, relief: float = 0.15) -> Image.Image` (L; światło z lewej góry; `relief` = rozpiętość głębi jako ułamek szerokości)
  - `ready_walls(session, crag_limit: int | None = None) -> list[Wall]`
  - `write_gallery(walls: list[Wall], media_root: Path, out_dir: Path) -> Path` (ścieżka `index.html`)
  - CLI: `topo depth-preview OUT_DIR [--crags N]`

Pliki galerii na ścianę: `{id}-linie.jpg` (zdjęcie z liniami, dłuższy bok 900 px), `{id}-glebia.jpg` (kolor), `{id}-cien.jpg` (cieniowanie), `{id}-zdjecie.jpg` i `{id}-szara.png` (8-bit) dla podglądu 2.5D; do tego `index.html` i `view.html`. Podgląd 2.5D wymaga serwera HTTP (tekstury WebGL nie wczytają się z `file://`): `npx --yes serve cache/glebia`.

- [ ] **Step 1: Testy `api/tests/test_depth_preview.py`**

```python
import numpy as np
from PIL import Image

from tests import factories as f
from topo.depth import save_depth_png
from topo.depth_preview import colorize, hillshade, ready_walls, write_gallery


def test_colorize_far_is_blue_near_is_red():
    depth = np.array([[6554, 58982]], dtype=np.uint16)  # 0.1 and 0.9 — the very ends of turbo are dark
    image = colorize(depth)
    assert image.mode == "RGB" and image.size == (2, 1)
    far, near = image.getpixel((0, 0)), image.getpixel((1, 0))
    assert far[2] > far[0]
    assert near[0] > near[2]


def test_hillshade_flat_is_uniform_and_slopes_differ():
    flat = hillshade(np.full((20, 20), 30000, dtype=np.uint16))
    assert flat.mode == "L" and len(set(flat.getdata())) == 1
    ramp = np.tile(np.linspace(0, 65535, 40, dtype=np.float64), (40, 1))
    rising = hillshade(ramp.astype(np.uint16))                 # nearer to the right: faces left, towards the light
    falling = hillshade(ramp[:, ::-1].astype(np.uint16))       # faces right, away from the light
    assert np.asarray(rising)[20, 20] > np.asarray(falling)[20, 20]


def _ready_wall(session, media_root, crag_name="Skała <Test>"):
    wall = f.wall(session, f.crag(session, f.area(session, "R"), crag_name), name="Płn.")
    folder = media_root / "walls" / str(wall.id)
    folder.mkdir(parents=True)
    Image.new("RGB", (160, 120), (90, 90, 90)).save(folder / "display.webp")
    save_depth_png(folder / "depth.png", np.tile(np.linspace(0, 65535, 160, dtype=np.uint16), (120, 1)))
    wall.image_path, wall.depth_path = f"walls/{wall.id}/display.webp", f"walls/{wall.id}/depth.png"
    wall.depth_status, wall.depth_model, wall.image_width, wall.image_height = "ready", "fake", 160, 120
    f.line(session, wall)
    session.flush()
    return wall


def test_ready_walls_only_ready(session, tmp_path):
    wall = _ready_wall(session, tmp_path)
    f.wall(session, wall.crag, name="Bez głębi", image_path="x.webp")
    assert ready_walls(session) == [wall]


def test_write_gallery_creates_files_and_escaped_index(session, tmp_path):
    wall = _ready_wall(session, tmp_path / "media")
    index = write_gallery([wall], tmp_path / "media", tmp_path / "out")
    out = tmp_path / "out"
    for suffix in ("linie.jpg", "glebia.jpg", "cien.jpg", "zdjecie.jpg", "szara.png"):
        assert (out / f"{wall.id}-{suffix}").exists(), suffix
    assert (out / "view.html").exists()
    html = index.read_text(encoding="utf-8")
    assert "Skała &lt;Test&gt;" in html
    assert f"view.html?id={wall.id}&amp;w=160&amp;h=120" in html
    with Image.open(out / f"{wall.id}-szara.png") as gray:
        assert gray.mode == "L" and gray.size == (160, 120)
```

W `api/tests/test_cli.py` dopisz:

```python
def test_cli_help_lists_depth_commands():
    result = CliRunner().invoke(app, ["--help"])
    assert "depth" in result.output and "depth-preview" in result.output
```

- [ ] **Step 2: Zaimplementuj `api/topo/depth_preview.py`**

```python
"""Static gallery for judging depth maps: photo with lines, coloured depth, relief shading and a 2.5D viewer."""

import html
from pathlib import Path

import numpy as np
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from topo.depth import load_depth
from topo.importer.preview import render_wall_preview
from topo.models import Wall

PREVIEW_MAX = 900

# Polynomial approximation of Google's Turbo colormap (coefficients for x^0..x^5).
_TURBO = np.array([
    [0.13572138, 4.61539260, -42.66032258, 132.13108234, -152.94239396, 59.28637943],
    [0.09140261, 2.19418839, 4.84296658, -14.18503333, 4.27729857, 2.82956604],
    [0.10667330, 12.64194608, -60.58204836, 110.36276771, -89.90310912, 27.34824973],
])


def colorize(depth: np.ndarray) -> Image.Image:
    x = depth.astype(np.float64) / 65535
    powers = np.stack([x**i for i in range(6)], axis=-1)
    rgb = np.clip(powers @ _TURBO.T, 0, 1)
    return Image.fromarray(np.round(rgb * 255).astype(np.uint8), "RGB")


def hillshade(depth: np.ndarray, relief: float = 0.15) -> Image.Image:
    height = depth.astype(np.float64) / 65535 * relief * depth.shape[1]
    dy, dx = np.gradient(height)
    normal = np.stack([-dx, -dy, np.ones_like(height)], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    light = np.array([-1.0, -1.0, 1.5])
    shade = np.clip(normal @ (light / np.linalg.norm(light)), 0, 1)
    return Image.fromarray(np.round(shade * 255).astype(np.uint8), "L")


def ready_walls(session: Session, crag_limit: int | None = None) -> list[Wall]:
    stmt = select(Wall).where(Wall.depth_status == "ready").order_by(Wall.crag_id, Wall.sort_order, Wall.id)
    if crag_limit is not None:
        first = select(Wall.crag_id).where(Wall.depth_status == "ready").group_by(Wall.crag_id).order_by(Wall.crag_id).limit(crag_limit)
        stmt = stmt.where(Wall.crag_id.in_(first))
    return list(session.scalars(stmt))


def _small(image: Image.Image) -> Image.Image:
    image = image.copy()
    image.thumbnail((PREVIEW_MAX, PREVIEW_MAX))
    return image


def write_gallery(walls: list[Wall], media_root: Path, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    sections = []
    for wall in walls:
        depth = load_depth(Path(media_root) / wall.depth_path)
        _small(render_wall_preview(wall, media_root)).save(out_dir / f"{wall.id}-linie.jpg", quality=85)
        colorize(depth).save(out_dir / f"{wall.id}-glebia.jpg", quality=85)
        hillshade(depth).save(out_dir / f"{wall.id}-cien.jpg", quality=85)
        Image.fromarray((depth >> 8).astype(np.uint8), "L").save(out_dir / f"{wall.id}-szara.png")
        with Image.open(Path(media_root) / wall.image_path) as photo:
            photo.convert("RGB").save(out_dir / f"{wall.id}-zdjecie.jpg", quality=88)
        title = html.escape(f"{wall.crag.name} — {wall.name or 'ściana'}")
        view = html.escape(f"view.html?id={wall.id}&w={depth.shape[1]}&h={depth.shape[0]}")
        images = "".join(
            f'<a href="{wall.id}-{name}.jpg"><img src="{wall.id}-{name}.jpg" alt="{label}" loading="lazy"></a>'
            for name, label in (("linie", "zdjęcie z liniami"), ("glebia", "głębia"), ("cien", "cieniowanie"))
        )
        sections.append(
            f'<section><h2>{title} <small>#{wall.id} · {html.escape(wall.depth_model or "")}</small> '
            f'<a href="{view}">podgląd 2.5D</a></h2><div class="row">{images}</div></section>'
        )
    index = out_dir / "index.html"
    index.write_text(_INDEX.replace("{count}", str(len(walls))).replace("{sections}", "\n".join(sections)), encoding="utf-8")
    (out_dir / "view.html").write_text(_VIEW, encoding="utf-8")
    return index


_INDEX = """<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mapy głębi</title>
<style>
body{margin:0 auto;max-width:1500px;padding:16px;font:14px system-ui,sans-serif;background:#f4ecdd;color:#2b2420}
h1{font-size:20px}h2{font-size:15px;margin:24px 0 6px}small{color:#7a6e62;font-weight:400}
.row{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.row img{width:100%;display:block}
a{color:#2f4fa0}
</style></head><body>
<h1>Mapy głębi — {count} ścian</h1>
<p>Kolumny: zdjęcie z liniami · głębia (czerwone = blisko, granatowe = daleko) · cieniowanie rzeźby (światło z lewej góry).
Podgląd 2.5D wymaga serwera: <code>npx --yes serve cache/glebia</code>.</p>
{sections}
</body></html>
"""

_VIEW = """<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Podgląd 2.5D</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#1d1916;color:#ede3d2;font:14px system-ui,sans-serif}
#ui{position:fixed;top:8px;left:8px;background:#0009;padding:8px 10px;border-radius:8px}a{color:#8ccbe6}</style>
</head><body>
<div id="ui"><a href="index.html">← galeria</a> · głębia <input id="scale" type="range" min="0" max="0.6" step="0.01" value="0.25">
· <label><input id="wire" type="checkbox"> siatka</label></div>
<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.170.0/build/three.module.js",
"three/addons/":"https://unpkg.com/three@0.170.0/examples/jsm/"}}</script>
<script type="module">
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const params = new URLSearchParams(location.search);
const id = params.get("id");
const aspect = Number(params.get("w")) / Number(params.get("h"));
const width = aspect >= 1 ? 1.6 : 1.6 * aspect;
const height = width / aspect;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 100);
camera.position.set(0, 0, 2.6);

const loader = new THREE.TextureLoader();
const photo = loader.load(`${id}-zdjecie.jpg`);
photo.colorSpace = THREE.SRGBColorSpace;
const depth = loader.load(`${id}-szara.png`);
const material = new THREE.MeshStandardMaterial({
  color: 0x000000, emissive: 0xffffff, emissiveMap: photo, displacementMap: depth,
});
const segmentsX = aspect >= 1 ? 384 : Math.round(384 * aspect);
const segmentsY = aspect >= 1 ? Math.round(384 / aspect) : 384;
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(width, height, segmentsX, segmentsY), material));

const scaleInput = document.getElementById("scale");
function applyScale() {
  material.displacementScale = Number(scaleInput.value) * width;
  material.displacementBias = -material.displacementScale / 2;
}
scaleInput.addEventListener("input", applyScale);
applyScale();
document.getElementById("wire").addEventListener("change", (e) => { material.wireframe = e.target.checked; });

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minAzimuthAngle = -Math.PI / 6;
controls.maxAzimuthAngle = Math.PI / 6;
controls.minPolarAngle = Math.PI / 2 - Math.PI / 9;
controls.maxPolarAngle = Math.PI / 2 + Math.PI / 9;
controls.minDistance = 0.8;
controls.maxDistance = 5;

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
</script></body></html>
"""
```

(Podgląd celowo prostszy niż docelowy widok 2.5D: bez linii dróg i bez ukrywania trójkątów na skokach głębi — ma pokazać surową jakość mapy głębi, w tym „garby” z drzew i rozciągnięte krawędzie. Ograniczenia obrotu ±30°/±20° jak w spec §6.3.)

- [ ] **Step 3: Komenda w `api/topo/cli.py`**

Import: `from topo.depth_preview import ready_walls, write_gallery`.

```python
@app.command("depth-preview")
def depth_preview_command(
    output: Path = typer.Argument(Path("/data/cache/glebia"), help="Katalog galerii"),
    crags: int | None = typer.Option(None, "--crags", help="Tylko ściany pierwszych N skał z gotową głębią"),
) -> None:
    """Zapisuje galerię map głębi do oceny (zdjęcie z liniami, głębia, cieniowanie, podgląd 2.5D)."""
    settings = get_settings()
    with SessionLocal() as session:
        walls = ready_walls(session, crag_limit=crags)
        if not walls:
            typer.echo("Brak ścian z gotową mapą głębi.")
            return
        index = write_gallery(walls, Path(settings.media_root), output)
    typer.echo(f"Galeria: {len(walls)} ścian, {index}")
```

- [ ] **Step 4: README**

W sekcji „Mapy głębi” dopisz:

````markdown
Galeria do oceny wyników (zdjęcie z liniami, głębia, cieniowanie, podgląd 2.5D):

```powershell
docker compose run --rm depth topo depth-preview /data/cache/glebia --crags 100
npx --yes serve cache/glebia     # potem http://localhost:3000
```
````

- [ ] **Step 5: Uruchom testy**

Run: `docker compose run --rm api pytest -q`
Expected: wszystkie PASS.

- [ ] **Step 6: Commit**

```powershell
git add api/topo/depth_preview.py api/topo/cli.py api/tests/test_depth_preview.py api/tests/test_cli.py README.md
git commit -m "feat: galeria podglądu map głębi z widokiem 2.5D" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Próba na ≤ 100 skałach i ocena (z użytkownikiem — STOP)

Bez nowego kodu. Wykonuje kontroler (nie subagent), bo kończy się rozmową z użytkownikiem.

- [ ] **Step 1: Przeliczenie**

```powershell
docker compose run --rm depth topo depth --crags 100
```

Expected: `Model depth-anything-v2-large na cuda.`, linie `[i/n] … ok (… s)`, na końcu `Gotowe: N, błędy: 0` (czas na ścianę zapisz do wniosków). Import może w tym czasie działać — próba bierze pierwsze 100 skał po `crag.id`, już zapisane.

- [ ] **Step 2: Galeria**

```powershell
docker compose run --rm depth topo depth-preview /data/cache/glebia --crags 100
npx --yes serve cache/glebia
```

Sprawdź samemu kilka ścian (w tym z drzewami przed skałą) w galerii i w `view.html`, potem pokaż użytkownikowi adres `http://localhost:3000`.

- [ ] **Step 3: STOP — ocena użytkownika**

Zapytaj użytkownika o ocenę. Pytania pomocnicze: czy rzeźba skały wygląda wiarygodnie; jak bardzo przeszkadzają drzewa i krzaki („garby”, rozciągnięte krawędzie); czy domyślna głębia 0,25 szerokości jest dobra; czy szczegóły są wystarczające (wejście modelu ma 518 px — ewentualnie większa rozdzielczość wejścia); czy któreś ściany są wyraźnie złe (np. zdjęcia z daleka, zdjęcia z narysowanymi już liniami).

- [ ] **Step 4: Wnioski i następny krok**

Zapisz ocenę i liczby (czas na ścianę, liczba ścian, błędy) w sekcji „Wnioski z wykonania” na końcu tego pliku i zacommituj:

```powershell
git add docs/superpowers/plans/2026-10-08-plan-5a-mapy-glebi.md
git commit -m "docs: wnioski z próby map głębi (plan 5a)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Na tej podstawie powstaje plan 5b (widok 2.5D w aplikacji: odporny odczyt głębi dla linii, ukrywanie trójkątów na skokach, przełącznik 2.5D/2D, `React.lazy`) oraz decyzja, czy liczyć `--all` od razu po zakończeniu importu.

---

## Po zakończeniu planu 5a

- Komendy `topo depth` i `topo depth-preview`, usługa `depth` z GPU, mapy głębi dla ścian pierwszych ≤ 100 skał, galeria z oceną użytkownika.
- Poza zakresem: widok 2.5D w aplikacji (plan 5b), maska roślinności (decyzja po próbie — domyślnie później), kolejka `depth_job` na serwerze (plan 7).

## Wnioski z wykonania

(uzupełnić po Task 5)
