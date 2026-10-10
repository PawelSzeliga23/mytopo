import pytest

from tests import factories as f


def make_crag(session):
    jura = f.area(session, "Jura Krakowsko-Częstochowska", kind="obszar")
    region = f.area(session, "Dolina Kobylańska", parent=jura)
    sektor = f.area(session, "Grupa Żabiego Konia", kind="sektor", parent=region)
    return f.crag(
        session, sektor, "Żabi Koń", lng=19.75617, lat=50.15599,
        rock_type="wapień", aspects=["W", "NW"], height_min=10, height_max=40, approach_minutes=10,
        child_friendly=True, surroundings="Otwarta przestrzeń",
        source="portalgorski", source_id="111", source_url="https://topo.portalgorski.pl/x,skala,111",
    )


def test_crag_detail_full(client, session):
    crag = make_crag(session)
    kant = f.route(session, crag, "Lewy kant Żabiego Konia", grade="V+", number=1, protection="9r + ST")
    wall = f.wall(
        session, crag, name="Żabi Koń", description="Lewa część",
        image_path="walls/1/display.webp", thumb_path="walls/1/thumb.webp",
        image_width=1063, image_height=1600, depth_path="walls/1/depth.png", depth_status="ready",
    )
    main = f.line(session, wall, route=kant, sort_order=1)
    f.line(
        session, wall, route=None, sort_order=2,
        parent_line_id=main.id, parent_point_id=main.points[1].id,
        points=((0.5, 0.5, "start"), (0.6, 0.3, "stanowisko")),
    )

    response = client.get(f"/api/crags/{crag.slug}")
    assert response.status_code == 200
    body = response.json()

    assert [p["name"] for p in body["path"]] == [
        "Jura Krakowsko-Częstochowska", "Dolina Kobylańska", "Grupa Żabiego Konia",
    ]
    assert (body["lng"], body["lat"]) == pytest.approx((19.75617, 50.15599))
    assert body["aspects"] == ["W", "NW"]
    assert body["source_url"] == "https://topo.portalgorski.pl/x,skala,111"

    assert (body["child_friendly"], body["surroundings"]) == (True, "Otwarta przestrzeń")
    [wall_out] = body["walls"]
    assert wall_out["description"] == "Lewa część"
    assert wall_out["image_url"] == "/media/walls/1/display.webp"
    assert wall_out["thumb_url"] == "/media/walls/1/thumb.webp"
    assert wall_out["depth_url"] == "/media/walls/1/depth.png"
    first, variant = wall_out["lines"]
    assert first["route_id"] == kant.id
    assert [p["kind"] for p in first["points"]] == ["start", "ring", "stanowisko"]
    assert first["points"][0]["visible"] is False
    assert variant["route_id"] is None
    assert variant["parent_point_id"] == first["points"][1]["id"]

    [route_out] = body["routes"]
    assert route_out["grade"] == "V+"
    assert route_out["grade_fr"] == "5b"
    assert route_out["protection"] == "9r + ST"


def test_crag_without_photos(client, session):
    crag = make_crag(session)
    f.wall(session, crag, name="Nowa ściana")

    [wall_out] = client.get(f"/api/crags/{crag.slug}").json()["walls"]
    assert wall_out["image_url"] is None
    assert wall_out["thumb_url"] is None
    assert wall_out["depth_url"] is None
    assert wall_out["depth_status"] == "pending"
    assert wall_out["lines"] == []


def test_depth_url_hidden_until_ready(client, session):
    crag = make_crag(session)
    f.wall(session, crag, image_path="walls/2/display.webp", depth_path="walls/2/depth.png", depth_status="failed")

    [wall_out] = client.get(f"/api/crags/{crag.slug}").json()["walls"]
    assert wall_out["depth_url"] is None


def test_crag_not_found(client):
    response = client.get("/api/crags/nie-ma")
    assert response.status_code == 404
    assert response.json() == {"code": "not_found", "message": "Nie znaleziono: skała"}


def _ready_wall(session, crag, **kw):
    return f.wall(
        session, crag, image_path="walls/9/display.webp", depth_path="walls/9/depth.png", depth_status="ready", **kw
    )


def test_clean_wall_shows_3d_with_segments(client, session):
    crag = make_crag(session)
    wall = _ready_wall(session, crag, vegetation_ratio=0.04)

    [wall_out] = client.get(f"/api/crags/{crag.slug}").json()["walls"]
    assert wall_out["show_3d"] is True
    assert wall_out["segments_url"] == "/media/walls/9/segments.png"  # next to the photo
    assert wall_out["vegetation_ratio"] == 0.04


def test_overgrown_wall_is_2d_unless_enabled_by_hand(client, session):
    crag = make_crag(session)
    wall = _ready_wall(session, crag, vegetation_ratio=0.4)
    assert client.get(f"/api/crags/{crag.slug}").json()["walls"][0]["show_3d"] is False

    wall.depth_enabled = True
    session.flush()
    assert client.get(f"/api/crags/{crag.slug}").json()["walls"][0]["show_3d"] is True


def test_wall_without_depth_has_no_segments_and_no_3d(client, session):
    crag = make_crag(session)
    f.wall(session, crag, image_path="walls/3/display.webp", vegetation_ratio=0.0)

    [wall_out] = client.get(f"/api/crags/{crag.slug}").json()["walls"]
    assert wall_out["segments_url"] is None and wall_out["show_3d"] is False


def test_segments_url_next_to_photo(client, session):
    crag = f.crag(session, f.area(session, "Dolina"), "Skała")
    f.wall(session, crag, image_path="walls/1/2/display.webp", depth_status="ready",
           depth_path="walls/1/2/depth.png", vegetation_ratio=0.0)
    session.commit()
    [out] = client.get(f"/api/crags/{crag.slug}").json()["walls"]
    assert out["segments_url"].endswith("walls/1/2/segments.png")
