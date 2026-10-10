import io

import numpy as np
import pytest
from PIL import Image
from sqlalchemy import func, select

from tests import factories as f
from tests.test_api_photos import jpeg, upload
from topo.config import get_settings
from topo.history import transaction_class
from topo.models import Wall

SIZE = (40, 30)  # width, height of the worker's rasters in these tests


@pytest.fixture
def media(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


def png(array: np.ndarray, mode: str | None = None) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(array, mode).save(buffer, "PNG") if mode else Image.fromarray(array).save(buffer, "PNG")
    return buffer.getvalue()


def depth_png(size=SIZE, value=30000) -> bytes:
    return png(np.full((size[1], size[0]), value, dtype=np.uint16))


def segments_png(size=SIZE, value=3) -> bytes:
    return png(np.full((size[1], size[0]), value, dtype=np.uint8))


def ready_wall(session, media, **kw):
    """A wall whose photo 1 has the worker's depth.png and segments.png."""
    crag = f.crag(session, f.area(session, "Dolina"), "Żabi Koń")
    wall = f.wall(session, crag, "Lewa", **kw)
    folder = media / "walls" / str(wall.id) / "1"
    folder.mkdir(parents=True)
    (folder / "depth.png").write_bytes(depth_png(value=10000))
    (folder / "segments.png").write_bytes(segments_png(value=3))
    wall.image_path = f"walls/{wall.id}/1/display.webp"
    wall.depth_path = f"walls/{wall.id}/1/depth.png"
    wall.depth_status, wall.vegetation_ratio = "ready", 0.0
    session.commit()
    return crag, wall


def wall_out(client, crag):
    [out] = client.get(f"/api/crags/{crag.slug}").json()["walls"]
    return out


def test_wall_out_without_model(client, session, media):
    crag, wall = ready_wall(session, media)
    out = wall_out(client, crag)
    assert out["depth_url"] == out["original_depth_url"] == f"/media/walls/{wall.id}/1/depth.png"
    assert out["segments_url"] == out["original_segments_url"] == f"/media/walls/{wall.id}/1/segments.png"
    assert (out["model_version"], out["rock_color"], out["ground_color"], out["depth_enabled"]) == (None, None, None, None)


def test_wall_out_with_model(client, session, media):
    crag, wall = ready_wall(session, media, rock_color="#112233")
    wall.model_path = f"walls/{wall.id}/1/model-2"
    session.commit()
    out = wall_out(client, crag)
    assert out["depth_url"] == f"/media/walls/{wall.id}/1/model-2-depth.png"
    assert out["segments_url"] == f"/media/walls/{wall.id}/1/model-2-segments.png"
    assert out["original_depth_url"] == f"/media/walls/{wall.id}/1/depth.png"
    assert (out["model_version"], out["rock_color"]) == (2, "#112233")


def test_replacing_photo_drops_model(editor, session, media):
    crag, wall = ready_wall(session, media)
    wall.model_path = f"walls/{wall.id}/1/model-1"
    session.commit()
    assert editor.put(f"/api/walls/{wall.id}/image", **upload(jpeg())).status_code == 200
    session.expire_all()
    assert session.get(Wall, wall.id).model_path is None


def tx_count(session):
    return session.scalar(select(func.count()).select_from(transaction_class()))
