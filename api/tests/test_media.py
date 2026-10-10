import io

import pytest
from PIL import Image

from topo.media import InvalidImage, next_photo_number, store_wall_image


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


def test_phone_mpo_photo_keeps_jpg_extension(tmp_path):
    buffer = io.BytesIO()
    Image.new("RGB", (40, 30)).save(buffer, "MPO", save_all=True, append_images=[Image.new("RGB", (40, 30))])
    assert Image.open(io.BytesIO(buffer.getvalue())).format == "MPO"
    stored = store_wall_image(tmp_path, 7, buffer.getvalue(), number=1)
    assert stored.original_path == "walls/7/1/original.jpg"
