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


def save(client, wall_id, base="", depth=None, segments=None, **fields):
    files = {}
    if depth is not None:
        files["depth"] = ("depth.png", depth, "image/png")
    if segments is not None:
        files["segments"] = ("segments.png", segments, "image/png")
    return client.put(f"/api/walls/{wall_id}/model", data={"base_model": base, **fields}, files=files or None)


def test_save_model_files(editor, session, media):
    crag, wall = ready_wall(session, media)
    response = save(editor, wall.id, depth=depth_png(), segments=segments_png(value=4), comment="bez drzewa")
    assert response.status_code == 200
    assert response.json() == {"model_version": 1, "changed": ["model_path"]}
    folder = media / "walls" / str(wall.id) / "1"
    assert (folder / "model-1-depth.png").read_bytes() == depth_png()
    assert (folder / "model-1-segments.png").exists()
    assert (folder / "depth.png").read_bytes() == depth_png(value=10000)  # the original stays
    out = wall_out(editor, crag)
    assert out["depth_url"].endswith("/1/model-1-depth.png") and out["original_depth_url"].endswith("/1/depth.png")

    second = save(editor, wall.id, base="1", depth=depth_png(value=5), segments=segments_png())
    assert second.json()["model_version"] == 2
    assert (folder / "model-2-depth.png").exists()


def test_save_model_conflict(editor, session, media):
    _, wall = ready_wall(session, media)
    assert save(editor, wall.id, depth=depth_png(), segments=segments_png()).status_code == 200
    response = save(editor, wall.id, base="", depth=depth_png(), segments=segments_png())
    assert response.status_code == 409
    assert (response.json()["code"], response.json()["current_model"]) == ("model_conflict", 1)


@pytest.mark.parametrize("files", [
    {"depth": depth_png(size=(20, 30)), "segments": segments_png()},
    {"depth": segments_png(), "segments": segments_png()},  # 8-bit depth
    {"depth": depth_png(), "segments": segments_png(value=7)},
    {"depth": depth_png()},
    {"depth": b"nie png", "segments": segments_png()},
])
def test_save_model_invalid(editor, session, media, files):
    _, wall = ready_wall(session, media)
    response = save(editor, wall.id, **files)
    assert response.status_code == 422 and response.json()["code"] == "invalid_model"
    session.expire_all()
    assert session.get(Wall, wall.id).model_path is None


def test_save_model_needs_depth(editor, session, media):
    _, wall = ready_wall(session, media)
    wall.depth_status = "pending"
    session.commit()
    response = save(editor, wall.id, depth=depth_png(), segments=segments_png())
    assert response.status_code == 422 and response.json()["code"] == "no_depth"


def test_settings_only(editor, session, media):
    crag, wall = ready_wall(session, media)
    response = save(editor, wall.id, rock_color="#AABBCC", ground_color="#101010", depth_enabled="off")
    assert response.json() == {"model_version": None, "changed": ["depth_enabled", "ground_color", "rock_color"]}
    out = wall_out(editor, crag)
    assert (out["rock_color"], out["ground_color"], out["depth_enabled"], out["show_3d"]) == ("#aabbcc", "#101010", False, False)
    assert not list((media / "walls" / str(wall.id) / "1").glob("model-*"))
    assert save(editor, wall.id, rock_color="default", depth_enabled="auto").json()["changed"] == ["depth_enabled", "rock_color"]
    assert wall_out(editor, crag)["rock_color"] is None


def test_bad_settings(editor, session, media):
    _, wall = ready_wall(session, media)
    assert save(editor, wall.id, rock_color="zielony").status_code == 422
    assert save(editor, wall.id, depth_enabled="tak").status_code == 422


def test_nothing_to_save(editor, session, media):
    _, wall = ready_wall(session, media)
    before = tx_count(session)
    response = save(editor, wall.id, depth_enabled="auto")
    assert response.json() == {"model_version": None, "changed": []}
    assert tx_count(session) == before


def test_save_model_needs_login(client, session, media):
    _, wall = ready_wall(session, media)
    assert save(client, wall.id, rock_color="#000000").status_code == 401


def test_model_history_and_revert(editor, session, media):
    crag, wall = ready_wall(session, media)
    save(editor, wall.id, depth=depth_png(), segments=segments_png(), rock_color="#123456")
    [item, *_] = editor.get("/api/changes", params={"crag": crag.id}).json()["items"]
    [change] = [o for o in item["objects"] if o["kind"] == "wall"]
    diffs = {d["field"]: (d["before"], d["after"]) for d in change["diffs"]}
    assert diffs == {"model_path": (None, f"walls/{wall.id}/1/model-1"), "rock_color": (None, "#123456")}

    assert editor.post(f"/api/changes/{item['id']}/revert", json={}).status_code == 200
    out = wall_out(editor, crag)
    assert (out["model_version"], out["rock_color"]) == (None, None)
    assert out["depth_url"].endswith("/1/depth.png")
