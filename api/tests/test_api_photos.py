import io

import pytest
from PIL import Image
from sqlalchemy import delete, select, update

from tests import factories as f
from topo.config import get_settings
from topo.models import DepthJob, Wall


@pytest.fixture
def media(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


def jpeg(width=640, height=480) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (120, 90, 60)).save(buffer, "JPEG")
    return buffer.getvalue()


def upload(data=None, **fields):
    return {"files": {"file": ("sciana.jpg", data if data is not None else jpeg(), "image/jpeg")}, "data": fields}


def make_crag(session):
    crag = f.crag(session, f.area(session, "Dolina"), "Żabi Koń")
    f.wall(session, crag, "Stara", sort_order=4)
    session.commit()
    return crag


def queued(session, wall_id):
    return session.scalars(select(DepthJob.status).where(DepthJob.wall_id == wall_id)).all()


def test_create_wall(editor, session, media):
    crag = make_crag(session)
    response = editor.post(f"/api/crags/{crag.id}/walls", **upload(name=" Lewa ", comment="nowe zdjęcie"))
    assert response.status_code == 201
    wall = session.get(Wall, response.json()["id"])
    assert (wall.name, wall.sort_order, wall.source, wall.depth_status) == ("Lewa", 5, "manual", "pending")
    assert wall.image_path == f"walls/{wall.id}/1/display.webp"
    assert (wall.image_width, wall.image_height) == (640, 480)
    assert (media / wall.image_path).exists()
    assert queued(session, wall.id) == ["queued"]
    walls = editor.get(f"/api/crags/{crag.slug}").json()["walls"]
    assert walls[-1]["id"] == wall.id and walls[-1]["depth_status"] == "pending"


def test_create_first_wall_and_empty_name(editor, session, media):
    crag = f.crag(session, f.area(session, "Dolina"), "Baszta")
    session.commit()
    response = editor.post(f"/api/crags/{crag.id}/walls", **upload(name="  "))
    wall = session.get(Wall, response.json()["id"])
    assert (wall.name, wall.sort_order) == (None, 0)


def test_create_wall_unknown_crag(editor, session, media):
    assert editor.post("/api/crags/999999/walls", **upload()).status_code == 404


@pytest.mark.parametrize("data", [b"to nie jest obraz", b""])
def test_create_wall_invalid_image(editor, session, media, data):
    crag = make_crag(session)
    response = editor.post(f"/api/crags/{crag.id}/walls", **upload(data))
    assert response.status_code == 422 and response.json()["code"] == "invalid_image"
    assert len(session.scalars(select(Wall).where(Wall.crag_id == crag.id)).all()) == 1
    assert not (media / "walls").exists()


def test_too_large(editor, session, media, monkeypatch):
    monkeypatch.setattr("topo.photos.MAX_UPLOAD", 100)
    crag = make_crag(session)
    response = editor.post(f"/api/crags/{crag.id}/walls", **upload())
    assert response.status_code == 413 and response.json()["code"] == "too_large"
    response = editor.put(f"/api/walls/{crag.walls[0].id}/image", **upload())
    assert response.status_code == 413


def test_upload_needs_login(client, session, media):
    crag = make_crag(session)
    assert client.post(f"/api/crags/{crag.id}/walls", **upload()).status_code == 401
    wall = crag.walls[0]
    assert client.put(f"/api/walls/{wall.id}/image", **upload()).status_code == 401
    assert client.post(f"/api/walls/{wall.id}/depth").status_code == 401


def test_replace_image(editor, session, media):
    crag = make_crag(session)
    wall = crag.walls[0]
    route = f.route(session, crag, "Rysa", "V")
    line = f.line(session, wall, route)
    wall.image_path = f"walls/{wall.id}/display.webp"
    wall.depth_status, wall.depth_path, wall.vegetation_ratio, wall.depth_enabled = "ready", "x", 0.5, True
    session.commit()
    version = wall.version

    first = editor.put(f"/api/walls/{wall.id}/image", **upload(comment="lepsze"))
    second = editor.put(f"/api/walls/{wall.id}/image", **upload(jpeg(800, 600)))
    assert first.status_code == 200 and second.status_code == 200

    session.expire_all()
    wall = session.get(Wall, wall.id)
    assert wall.image_path == f"walls/{wall.id}/2/display.webp"
    assert (wall.image_width, wall.image_height) == (800, 600)
    assert (wall.depth_status, wall.depth_path, wall.vegetation_ratio, wall.depth_enabled) == ("pending", None, None, None)
    assert wall.version == version == second.json()["version"]
    assert [line_.id for line_ in wall.lines] == [line.id]
    assert queued(session, wall.id) == ["queued"]  # the second upload does not add a duplicate


def test_replace_image_invalid_keeps_photo(editor, session, media):
    crag = make_crag(session)
    wall = crag.walls[0]
    wall.image_path = f"walls/{wall.id}/display.webp"
    session.commit()
    assert editor.put(f"/api/walls/{wall.id}/image", **upload(b"zle")).status_code == 422
    session.expire_all()
    assert session.get(Wall, wall.id).image_path == f"walls/{wall.id}/display.webp"
    assert queued(session, wall.id) == []


def test_retry_depth(editor, session, media):
    crag = make_crag(session)
    wall = crag.walls[0]
    wall.image_path, wall.depth_status = f"walls/{wall.id}/display.webp", "failed"
    session.commit()
    response = editor.post(f"/api/walls/{wall.id}/depth")
    assert response.status_code == 202
    session.expire_all()
    assert session.get(Wall, wall.id).depth_status == "pending"
    assert queued(session, wall.id) == ["queued"]


def test_retry_depth_without_photo(editor, session, media):
    crag = make_crag(session)
    response = editor.post(f"/api/walls/{crag.walls[0].id}/depth")
    assert response.status_code == 422 and response.json()["code"] == "no_image"


def photo_history(editor, crag_id):
    [item, *_] = editor.get("/api/changes", params={"crag": crag_id}).json()["items"]
    return item


def test_replace_shows_in_history_and_reverts(editor, session, media):
    crag = make_crag(session)
    wall_id = crag.walls[0].id
    editor.put(f"/api/walls/{wall_id}/image", **upload())
    Image.new("I;16", (32, 24)).save(media / "walls" / str(wall_id) / "1" / "depth.png")  # the worker computed photo 1
    session.execute(
        update(Wall).where(Wall.id == wall_id).values(depth_status="ready", depth_path=f"walls/{wall_id}/1/depth.png")
    )
    session.commit()
    editor.put(f"/api/walls/{wall_id}/image", **upload(jpeg(800, 600)))

    item = photo_history(editor, crag.id)
    [wall_change] = [o for o in item["objects"] if o["kind"] == "wall"]
    assert [(d["field"], d["before"], d["after"]) for d in wall_change["diffs"]] == [
        ("image_path", f"walls/{wall_id}/1/display.webp", f"walls/{wall_id}/2/display.webp")
    ]

    assert editor.post(f"/api/changes/{item['id']}/revert", json={}).status_code == 200
    session.expire_all()
    wall = session.get(Wall, wall_id)
    assert (wall.image_path, wall.thumb_path) == (f"walls/{wall_id}/1/display.webp", f"walls/{wall_id}/1/thumb.webp")
    assert wall.image_original_path == f"walls/{wall_id}/1/original.jpg"
    assert (wall.image_width, wall.image_height) == (640, 480)
    assert (wall.depth_status, wall.depth_path) == ("ready", f"walls/{wall_id}/1/depth.png")


def test_revert_to_photo_without_depth_queues_job(editor, session, media):
    crag = make_crag(session)
    wall_id = crag.walls[0].id
    editor.put(f"/api/walls/{wall_id}/image", **upload())
    editor.put(f"/api/walls/{wall_id}/image", **upload())
    session.execute(delete(DepthJob))
    session.commit()
    item = photo_history(editor, crag.id)
    assert editor.post(f"/api/changes/{item['id']}/revert", json={}).status_code == 200
    session.expire_all()
    wall = session.get(Wall, wall_id)
    assert (wall.image_path, wall.depth_status) == (f"walls/{wall_id}/1/display.webp", "pending")
    assert queued(session, wall_id) == ["queued"]


def test_revert_wall_creation(editor, session, media):
    crag = make_crag(session)
    wall_id = editor.post(f"/api/crags/{crag.id}/walls", **upload(name="Lewa")).json()["id"]
    item = photo_history(editor, crag.id)
    assert any(o["kind"] == "wall" and o["op"] == "created" for o in item["objects"]), item["objects"]
    assert editor.post(f"/api/changes/{item['id']}/revert", json={}).status_code == 200
    session.expire_all()
    assert session.get(Wall, wall_id) is None


def image_bytes(fmt: str) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (40, 30), (1, 2, 3)).save(buffer, fmt)
    return buffer.getvalue()


@pytest.mark.parametrize("fmt", ["GIF", "TIFF", "BMP"])
def test_only_jpeg_png_webp(editor, session, media, fmt):
    crag = make_crag(session)
    response = editor.post(f"/api/crags/{crag.id}/walls", **upload(image_bytes(fmt)))
    assert response.status_code == 422 and response.json()["code"] == "invalid_image"


@pytest.mark.parametrize("fmt", ["PNG", "WEBP"])
def test_png_and_webp_accepted(editor, session, media, fmt):
    crag = make_crag(session)
    assert editor.post(f"/api/crags/{crag.id}/walls", **upload(image_bytes(fmt))).status_code == 201


def test_phone_mpo_accepted(editor, session, media):
    buffer = io.BytesIO()
    Image.new("RGB", (40, 30)).save(buffer, "MPO", save_all=True, append_images=[Image.new("RGB", (40, 30))])
    crag = make_crag(session)
    assert editor.post(f"/api/crags/{crag.id}/walls", **upload(buffer.getvalue())).status_code == 201
