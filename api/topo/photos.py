"""Photos uploaded in the app: each one goes to a new numbered folder, so reverting a replacement gets the old one back."""

import io
from pathlib import Path

from fastapi import UploadFile
from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from topo.api.errors import ApiError
from topo.depth_queue import enqueue_depth
from topo.media import InvalidImage, next_photo_number, store_wall_image
from topo.models import Wall

MAX_UPLOAD = 30 * 1024 * 1024
FORMATS = {"JPEG", "MPO", "PNG", "WEBP"}  # MPO = a JPEG with extra frames, as phones save them


def read_upload(file: UploadFile) -> bytes:
    data = file.file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise ApiError(413, "too_large", "Zdjęcie jest większe niż 30 MB")
    try:
        image_format = Image.open(io.BytesIO(data)).format
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        image_format = None
    if image_format not in FORMATS:
        raise ApiError(422, "invalid_image", "Nieprawidłowy plik obrazu — wyślij JPEG, PNG albo WebP")
    return data


def set_photo(session: Session, wall: Wall, data: bytes, media_root: Path) -> None:
    """Stores the photo, points the wall at it, clears what was derived from the old one and queues its depth.

    The fields are set before the job is added: for a new wall the first flush then inserts it with its photo.
    """
    try:
        stored = store_wall_image(media_root, wall.id, data, next_photo_number(media_root, wall.id))
    except InvalidImage as exc:
        session.rollback()
        raise ApiError(422, "invalid_image", str(exc)) from exc
    wall.image_original_path, wall.image_path, wall.thumb_path = stored.original_path, stored.image_path, stored.thumb_path
    wall.image_width, wall.image_height = stored.width, stored.height
    wall.depth_status, wall.depth_path, wall.depth_model = "pending", None, None
    wall.vegetation_ratio = wall.route_vegetation_ratio = wall.depth_enabled = wall.model_path = None
    enqueue_depth(session, wall.id)
