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
