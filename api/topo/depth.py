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
