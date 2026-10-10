"""Depth maps of wall photos (Depth Anything V2): a 16-bit PNG next to the photo, brighter = nearer."""

import math
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Protocol

import numpy as np
from PIL import Image
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from topo.models import Wall

DEPTH_MAX = 768
DEPTH_FILE = "depth.png"
MODELS = {
    "large": "depth-anything/Depth-Anything-V2-Large-hf",
    "small": "depth-anything/Depth-Anything-V2-Small-hf",
}


def model_name(key: str) -> str:
    return f"depth-anything-v2-{key}"


SEGMENTS_FILE = "segments.png"
OTHER, VEGETATION, SKY, ROCK, GROUND = 0, 1, 2, 3, 4
VEGETATION_LABELS = ("tree", "plant", "flower", "palm")
GROUND_LABELS = ("grass", "earth", "floor", "road", "sidewalk", "field", "sand", "path", "dirt track", "land", "step", "stairs", "stairway")
ROCK_LABELS = ("rock", "mountain", "hill", "wall")
VEGETATION_LIMIT = 0.10  # share of the rock covered by vegetation above which a wall gets 2D only
MIN_ROCK_COLUMN = 0.02  # a column belongs to the rock when at least this share of its pixels is rock


class DepthEstimator(Protocol):
    name: str

    def predict(self, image: Image.Image) -> np.ndarray:
        """2D relative depth at any resolution; larger = nearer."""


class Segmenter(Protocol):
    def predict(self, image: Image.Image) -> np.ndarray:
        """2D uint8 classes (OTHER, VEGETATION, SKY, ROCK, GROUND) at any resolution."""

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


def compute_segments(image: Image.Image, segmenter: Segmenter) -> np.ndarray:
    classes = Image.fromarray(np.asarray(segmenter.predict(image), dtype=np.uint8))
    return np.asarray(classes.resize(depth_size(image.width, image.height), Image.Resampling.NEAREST))


def rock_region(classes: np.ndarray) -> np.ndarray:
    """Where the rock is, including parts hidden behind vegetation.

    Per column: from the topmost rock pixel down to the ground below the lowest rock pixel (or to that rock
    pixel when no ground follows). Trees above the rock, beside it or in the background stay outside.
    """
    height, width = classes.shape
    region = np.zeros(classes.shape, dtype=bool)
    for x in range(width):
        column = classes[:, x]
        rock = np.flatnonzero(column == ROCK)
        if rock.size < max(1, MIN_ROCK_COLUMN * height):
            continue
        ground = np.flatnonzero(column[rock[-1]:] == GROUND)
        bottom = rock[-1] + ground[0] if ground.size else rock[-1] + 1
        region[rock[0]:bottom, x] = True
    return region


def vegetation_stats(classes: np.ndarray, lines: list[list[tuple[float, float]]]) -> tuple[float, float | None]:
    """(share of the rock covered by vegetation, share of route samples covered by vegetation or None without routes).

    Without any recognised rock the first value falls back to the vegetation share of the whole non-sky photo.
    A route sample (every ~4 px) counts as covered when more than half of its 9x9 window is vegetation.
    """
    vegetation = classes == VEGETATION
    area = rock_region(classes) & (classes != SKY)
    if not area.any():
        area = classes != SKY
    ratio = float(vegetation[area].sum() / max(1, int(area.sum())))
    height, width = classes.shape
    hits = total = 0
    for points in lines:
        for (x0, y0), (x1, y1) in zip(points, points[1:]):
            steps = max(1, round(math.hypot((x1 - x0) * width, (y1 - y0) * height) / 4))
            for t in range(steps):
                x, y = x0 + (x1 - x0) * t / steps, y0 + (y1 - y0) * t / steps
                cx = min(width - 1, max(0, round(x * (width - 1))))
                cy = min(height - 1, max(0, round(y * (height - 1))))
                total += 1
                hits += vegetation[max(0, cy - 4):cy + 5, max(0, cx - 4):cx + 5].mean() > 0.5
    return ratio, (hits / total if total else None)


def wants_3d(wall: Wall) -> bool:
    """2.5D only with a ready depth map; a manual choice wins, otherwise a rock overgrown above the limit gets 2D."""
    if wall.depth_status != "ready":
        return False
    if wall.depth_enabled is not None:
        return wall.depth_enabled
    return wall.vegetation_ratio is None or wall.vegetation_ratio <= VEGETATION_LIMIT


def select_walls(
    session: Session,
    *,
    wall_ids: list[int] | None = None,
    crag_limit: int | None = None,
    only_model: str | None = None,
    force: bool = False,
    with_segments: bool = False,
) -> list[Wall]:
    """Walls with a photo to (re)compute, ordered by crag; ``crag_limit`` = first N crags with photos.

    ``with_segments`` also picks walls whose depth is ready but whose segmentation is missing.
    """
    stmt = select(Wall).where(Wall.image_path.is_not(None)).order_by(Wall.crag_id, Wall.sort_order, Wall.id)
    if wall_ids:
        stmt = stmt.where(Wall.id.in_(wall_ids))
    if only_model:
        stmt = stmt.where(Wall.depth_model == only_model)
    elif not force:
        missing = Wall.depth_status != "ready"
        stmt = stmt.where(or_(missing, Wall.vegetation_ratio.is_(None)) if with_segments else missing)
    if crag_limit is not None:
        first_crags = (
            select(Wall.crag_id).where(Wall.image_path.is_not(None))
            .group_by(Wall.crag_id).order_by(Wall.crag_id).limit(crag_limit)
        )
        stmt = stmt.where(Wall.crag_id.in_(first_crags))
    return list(session.scalars(stmt))


def model_files(model_path: str) -> tuple[str, str]:
    """Depth and segmentation of a model edited by hand (paths relative to the media root)."""
    return f"{model_path}-depth.png", f"{model_path}-segments.png"


def model_number(model_path: str | None) -> int | None:
    return int(model_path.rsplit("-", 1)[1]) if model_path else None


def photo_folder(wall: Wall) -> PurePosixPath:
    """Folder of the wall's current photo: its depth map and segmentation are stored next to it."""
    if wall.image_path:
        return PurePosixPath(wall.image_path).parent
    return PurePosixPath("walls") / str(wall.id)


def update_wall_fields(session: Session, wall_id: int, **values) -> None:
    # Core UPDATE on purpose: depth, segmentation and the 2.5D switch are derived data or display settings,
    # not edits. A Continuum version without an "import:" author would make the importer treat the wall as
    # manually edited and skip it. No commit: the caller decides.
    session.execute(update(Wall.__table__).where(Wall.__table__.c.id == wall_id).values(**values))


def set_wall_fields(session: Session, wall: Wall, **values) -> None:
    update_wall_fields(session, wall.id, **values)
    session.commit()
    session.refresh(wall, list(values))


def process_wall(
    session: Session,
    wall: Wall,
    media_root: Path,
    estimator: DepthEstimator,
    segmenter: Segmenter | None = None,
    force: bool = False,
) -> None:
    """Computes the missing depth map (and segmentation, when a segmenter is given); ``force`` recomputes both."""
    need_depth = force or wall.depth_status != "ready"
    need_segments = segmenter is not None and (force or wall.vegetation_ratio is None)
    folder = Path(photo_folder(wall))
    (Path(media_root) / folder).mkdir(parents=True, exist_ok=True)
    try:
        with Image.open(Path(media_root) / wall.image_path) as opened:
            image = opened.convert("RGB")
        if need_depth:
            save_depth_png(Path(media_root) / folder / DEPTH_FILE, compute_depth(image, estimator))
    except Exception:
        if need_depth:
            set_wall_fields(session, wall, depth_status="failed")
        raise
    if need_depth:
        set_wall_fields(
            session, wall, depth_path=(folder / DEPTH_FILE).as_posix(), depth_status="ready", depth_model=estimator.name
        )
    if need_segments:
        classes = compute_segments(image, segmenter)
        Image.fromarray(classes).save(Path(media_root) / folder / SEGMENTS_FILE)
        lines = [[(point.x, point.y) for point in line.points] for line in wall.lines]
        ratio, route_ratio = vegetation_stats(classes, lines)
        set_wall_fields(session, wall, vegetation_ratio=ratio, route_vegetation_ratio=route_ratio)


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
    segmenter: Segmenter | None = None,
    force: bool = False,
) -> DepthReport:
    report = DepthReport()
    for index, wall in enumerate(walls, 1):
        label = f"{wall.crag.name} — {wall.name or 'ściana'} (#{wall.id})"
        started = time.perf_counter()
        try:
            process_wall(session, wall, media_root, estimator, segmenter, force)
        except Exception as exc:
            report.failed.append(f"{label}: {exc}")
            log(f"[{index}/{len(walls)}] {label}: BŁĄD {exc}")
            continue
        report.done += 1
        log(f"[{index}/{len(walls)}] {label}: ok ({time.perf_counter() - started:.1f} s)")
    return report


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


class HFSegmenter:
    """SegFormer-B5 trained on ADE20K; its 150 labels are folded into rock / ground / vegetation / sky / other."""

    REPO = "nvidia/segformer-b5-finetuned-ade-640-640"

    def __init__(self, device: str | None = None) -> None:
        import torch
        from transformers import AutoImageProcessor, AutoModelForSemanticSegmentation

        self._torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self._processor = AutoImageProcessor.from_pretrained(self.REPO)
        self._model = AutoModelForSemanticSegmentation.from_pretrained(self.REPO).to(self.device).eval()
        lookup = np.full(len(self._model.config.id2label), OTHER, dtype=np.uint8)
        for index, label in self._model.config.id2label.items():
            name = label.strip().lower()
            for labels, value in ((VEGETATION_LABELS, VEGETATION), (ROCK_LABELS, ROCK), (GROUND_LABELS, GROUND)):
                if name in labels:
                    lookup[int(index)] = value
            if name == "sky":
                lookup[int(index)] = SKY
        self._lookup = lookup

    def predict(self, image: Image.Image) -> np.ndarray:
        inputs = self._processor(images=image, return_tensors="pt").to(self.device)
        with self._torch.inference_mode():
            logits = self._model(**inputs).logits
            width, height = depth_size(image.width, image.height)
            logits = self._torch.nn.functional.interpolate(logits, size=(height, width), mode="bilinear")
            labels = logits.argmax(dim=1)[0].cpu().numpy()
        return self._lookup[labels]
