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


def next_photo_number(media_root: Path, wall_id: int) -> int:
    """Number of the wall's next photo folder (``walls/{id}/{n}/``); imported photos lie in ``walls/{id}/`` itself."""
    folder = Path(media_root) / "walls" / str(wall_id)
    numbers = [int(p.name) for p in folder.iterdir() if p.is_dir() and p.name.isdigit()] if folder.is_dir() else []
    return max(numbers, default=0) + 1


def store_wall_image(media_root: Path, wall_id: int, data: bytes, number: int | None = None) -> StoredImage:
    """Stores the photo in ``walls/{id}/`` (import) or, with ``number``, in its own folder ``walls/{id}/{number}/``."""
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise InvalidImage("Nieprawidłowy plik obrazu") from exc
    # MPO is a JPEG with extra frames, as phones save them.
    extension = {"JPEG": "jpg", "MPO": "jpg"}.get(image.format or "", (image.format or "img").lower())
    image = ImageOps.exif_transpose(image).convert("RGB")

    relative = Path("walls") / str(wall_id)
    if number is not None:
        relative = relative / str(number)
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
