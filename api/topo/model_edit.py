"""2.5D models edited by hand: depth and segmentation rasters stored next to the photo as model-{n}-*.png."""

import io
import re
from pathlib import Path, PurePosixPath

import numpy as np
from PIL import Image, UnidentifiedImageError

from topo.depth import GROUND, model_files, photo_folder, vegetation_stats
from topo.models import Wall

MAX_MODEL_UPLOAD = 30 * 1024 * 1024
_MODEL_FILE = re.compile(r"^model-(\d+)-depth\.png$")


class InvalidModel(Exception):
    pass


def _open(data: bytes, what: str) -> tuple[str, np.ndarray]:
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "PNG":
                raise InvalidModel(f"{what}: oczekiwano PNG")
            mode = image.mode
            array = np.asarray(image)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise InvalidModel(f"{what}: nieprawidłowy plik") from exc
    return mode, array


def check_model(depth: bytes, segments: bytes, size: tuple[int, int]) -> None:
    """Both rasters must have the size of the worker's depth map: 16-bit depth, 8-bit classes 0–4."""
    width, height = size
    depth_mode, depth_array = _open(depth, "Głębia")
    segments_mode, segments_array = _open(segments, "Segmentacja")
    if depth_mode not in ("I;16", "I;16B", "I") or depth_array.ndim != 2:
        raise InvalidModel("Głębia: oczekiwano jednokanałowego PNG 16-bit")
    if segments_mode != "L":
        raise InvalidModel("Segmentacja: oczekiwano jednokanałowego PNG 8-bit")
    if depth_array.shape != (height, width) or segments_array.shape != (height, width):
        raise InvalidModel(f"Rastry muszą mieć rozmiar {width}×{height}")
    if int(segments_array.max(initial=0)) > GROUND:
        raise InvalidModel("Segmentacja: nieznana klasa")


def next_model_number(folder: Path) -> int:
    numbers = [int(match[1]) for p in folder.glob("model-*-depth.png") if (match := _MODEL_FILE.match(p.name))]
    return max(numbers, default=0) + 1


def store_model(media_root: Path, wall: Wall, depth: bytes, segments: bytes) -> str:
    """Writes the rasters as the next model of the wall's photo; returns its model_path."""
    folder = photo_folder(wall)
    model_path = (folder / f"model-{next_model_number(Path(media_root) / folder)}").as_posix()
    depth_file, segments_file = model_files(model_path)
    (Path(media_root) / depth_file).write_bytes(depth)
    (Path(media_root) / segments_file).write_bytes(segments)
    return model_path


def model_vegetation(segments: bytes, wall: Wall) -> tuple[float, float | None]:
    """Vegetation shares (as in the worker) from a checked segmentation raster."""
    _, classes = _open(segments, "Segmentacja")
    return vegetation_stats(classes, [[(point.x, point.y) for point in line.points] for line in wall.lines])


def original_size(media_root: Path, wall: Wall) -> tuple[int, int]:
    with Image.open(Path(media_root) / PurePosixPath(wall.depth_path)) as image:
        return image.size
