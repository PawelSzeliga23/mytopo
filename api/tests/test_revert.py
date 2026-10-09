import numpy as np
from PIL import Image
from sqlalchemy import select

from tests import factories as f
from tests.test_api_edit import last_transaction, make_crag
from tests.test_sectors import make_three_wall_crag
from topo.auth import login_limiter
from topo.changes import transaction_changes
from topo.config import get_settings
from topo.depth import ROCK, VEGETATION
from topo.grades import grade_sort
from topo.history import IMPORT_AUTHOR_PREFIX, is_manually_edited, set_author, transaction_class
from topo.models import Area, Crag, LinePoint, Route, RouteLine, Wall


def login_as(client, nick):
    login_limiter.clear()
    assert client.post("/api/auth/login", json={"password": "tajne", "nick": nick}).status_code == 200


def revert(client, tx_id, **body):
    return client.post(f"/api/changes/{tx_id}/revert", json=body)


def tx_id(session):
    return last_transaction(session).id


def last_changes(session):
    return transaction_changes(session, tx_id(session))


def variant_crag(session):
    """A crag with route A and route B, whose line is a variant branching off A's second point."""
    crag, region = make_crag(session)
    wall = f.wall(session, crag)
    route_a, route_b = f.route(session, crag, "A"), f.route(session, crag, "B")
    line_a = f.line(session, wall, route=route_a)
    line_b = f.line(
        session, wall, route=route_b, parent_line_id=line_a.id, parent_point_id=line_a.points[1].id,
        points=((0.5, 0.5, "start"), (0.6, 0.3, "stanowisko")),
    )  # fmt: skip
    session.commit()
    return crag, wall, route_a, line_a, line_b


def test_revert_field_change(editor, session):
    crag, _ = make_crag(session)
    response = editor.patch(f"/api/crags/{crag.id}", json={"description": "Opis", "approach_minutes": 15})
    assert response.status_code == 200
    original = tx_id(session)

    response = revert(editor, original, comment=" pomyłka ")
    assert response.status_code == 200
    new = session.get(transaction_class(), response.json()["transaction_id"])
    assert (new.author, new.reverts_id, new.comment) == ("ania", original, f"cofnięcie #{original}: pomyłka")
    session.expire_all()
    assert (crag.description, crag.approach_minutes) == (None, None)


def test_conflict_then_safe_then_all(editor, session):
    crag, _ = make_crag(session)
    route = f.route(session, crag, "Kant", grade="VI")
    session.commit()
    editor.patch(f"/api/routes/{route.id}", json={"grade": "VI+", "description": "Opis"})
    ania = tx_id(session)
    login_as(editor, "bartek")
    editor.patch(f"/api/routes/{route.id}", json={"grade": "VI.1"})
    login_as(editor, "ania")
    before = tx_id(session)

    response = revert(editor, ania)
    assert response.status_code == 409
    body = response.json()
    assert (body["code"], body["message"]) == ("revert_conflict", "Część pól zmieniono później")
    [conflict] = body["conflicts"]
    assert {k: conflict[k] for k in ("kind", "id", "name", "field", "author", "current", "restored")} == {
        "kind": "route", "id": route.id, "name": "Kant", "field": "grade", "author": "bartek",
        "current": "VI.1", "restored": "VI",
    }  # fmt: skip
    assert conflict["issued_at"] is not None
    assert tx_id(session) == before
    session.expire_all()
    assert (route.grade, route.description) == ("VI.1", "Opis")

    assert revert(editor, ania, mode="safe").status_code == 200
    session.expire_all()
    assert (route.grade, route.description) == ("VI.1", None)

    assert revert(editor, ania, mode="all").status_code == 200
    session.expire_all()
    assert (route.grade, route.grade_sort, route.description) == ("VI", grade_sort("VI"), None)


def test_restore_deleted_crag_with_depth_files(editor, session, tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    get_settings.cache_clear()
    crag, _ = make_crag(session)
    wall = f.wall(session, crag, "Lewa", depth_status="ready", depth_path="walls/x/depth.png", vegetation_ratio=0.5)
    bare = f.wall(session, crag, "Prawa", sort_order=1, depth_status="ready", vegetation_ratio=0.5)
    route = f.route(session, crag, "Kant", grade="VI")
    line = f.line(session, wall, route=route)
    ids = {"crag": crag.id, "walls": [wall.id, bare.id], "route": route.id, "line": line.id}
    point_ids = [p.id for p in line.points]
    folder = tmp_path / "walls" / str(wall.id)
    folder.mkdir(parents=True)
    Image.fromarray(np.zeros((40, 30), dtype=np.uint16)).save(folder / "depth.png")
    classes = np.full((40, 30), ROCK, dtype=np.uint8)
    classes[15:25] = VEGETATION  # vegetation inside the rock region
    Image.fromarray(classes).save(folder / "segments.png")
    session.commit()

    assert editor.delete(f"/api/crags/{crag.id}").status_code == 204
    response = revert(editor, tx_id(session))
    assert response.status_code == 200

    detail = editor.get("/api/crags/zabi-kon")
    assert detail.status_code == 200
    body = detail.json()
    assert body["id"] == ids["crag"]
    assert [w["id"] for w in body["walls"]] == ids["walls"]
    assert [r["id"] for r in body["routes"]] == [ids["route"]]
    [restored_line] = body["walls"][0]["lines"]
    assert restored_line["id"] == ids["line"] and restored_line["route_id"] == ids["route"]
    session.expire_all()
    assert [p.id for p in session.get(RouteLine, ids["line"]).points] == point_ids
    restored = session.get(Wall, ids["walls"][0])
    assert (restored.depth_status, restored.depth_path) == ("ready", f"walls/{restored.id}/depth.png")
    assert restored.vegetation_ratio is not None and restored.vegetation_ratio > 0
    assert restored.route_vegetation_ratio is not None
    no_files = session.get(Wall, ids["walls"][1])
    assert (no_files.depth_status, no_files.depth_path, no_files.vegetation_ratio) == ("pending", None, None)


def test_restore_crag_with_variant_line(editor, session):
    crag, _, _, line_a, line_b = variant_crag(session)
    line_a_id, line_b_id, point_id = line_a.id, line_b.id, line_a.points[1].id
    assert editor.delete(f"/api/crags/{crag.id}").status_code == 204

    assert revert(editor, tx_id(session)).status_code == 200
    session.expire_all()
    variant = session.get(RouteLine, line_b_id)
    assert (variant.parent_line_id, variant.parent_point_id) == (line_a_id, point_id)
    created = {c.id: c.op for c in last_changes(session) if c.model is RouteLine}
    assert created == {line_a_id: "created", line_b_id: "created"}


def test_restore_route_reattaches_variant(editor, session):
    _, _, route_a, line_a, line_b = variant_crag(session)
    route_a_id, line_a_id, line_b_id, point_id = route_a.id, line_a.id, line_b.id, line_a.points[1].id
    assert editor.delete(f"/api/routes/{route_a_id}").status_code == 204
    session.expire_all()
    assert session.get(RouteLine, line_b_id).parent_line_id is None

    assert revert(editor, tx_id(session)).status_code == 200
    session.expire_all()
    assert session.get(Route, route_a_id) is not None
    assert session.get(RouteLine, line_a_id).route_id == route_a_id
    variant = session.get(RouteLine, line_b_id)
    assert (variant.parent_line_id, variant.parent_point_id) == (line_a_id, point_id)


def test_revert_crag_creation(editor, session):
    _, region = make_crag(session)
    created = editor.post("/api/crags", json={"name": "Nowa", "area_id": region.id, "location": [19.7, 50.1]}).json()
    assert revert(editor, tx_id(session)).status_code == 200
    assert session.get(Crag, created["id"]) is None

    edited = editor.post("/api/crags", json={"name": "Druga", "area_id": region.id, "location": [19.7, 50.1]}).json()
    creation = tx_id(session)
    editor.patch(f"/api/crags/{edited['id']}", json={"description": "Opis"})
    response = revert(editor, creation)
    assert response.status_code == 409
    [conflict] = response.json()["conflicts"]
    assert [conflict[k] for k in ("kind", "id", "field", "author")] == ["crag", edited["id"], "*", "ania"]
    assert revert(editor, creation, mode="safe").json()["transaction_id"] is None
    assert session.get(Crag, edited["id"]) is not None
    assert revert(editor, creation, mode="all").status_code == 200
    session.expire_all()
    assert session.get(Crag, edited["id"]) is None


def test_revert_creation_with_routes_added_later_conflicts(editor, session):
    _, region = make_crag(session)
    created = editor.post("/api/crags", json={"name": "Nowa", "area_id": region.id, "location": [19.7, 50.1]}).json()
    creation = tx_id(session)
    editor.post(f"/api/crags/{created['id']}/routes", json={"name": "Później"})
    response = revert(editor, creation)
    assert response.status_code == 409
    assert response.json()["conflicts"][0]["field"] == "*"


def test_missing_parent(editor, session):
    crag, _ = make_crag(session)
    route = f.route(session, crag, "Kant")
    session.commit()
    editor.delete(f"/api/routes/{route.id}")
    route_deleted = tx_id(session)
    editor.delete(f"/api/crags/{crag.id}")
    crag_deleted = tx_id(session)

    response = revert(editor, route_deleted)
    assert response.status_code == 409
    assert response.json() == {
        "code": "missing_parent", "message": "Najpierw przywróć: Żabi Koń", "transaction_id": crag_deleted,
    }  # fmt: skip
    assert tx_id(session) == crag_deleted


def test_restored_crag_gets_free_slug(editor, session):
    _, region = make_crag(session)
    baszta = f.crag(session, region, "Baszta")
    session.commit()
    baszta_id = baszta.id
    editor.delete(f"/api/crags/{baszta_id}")
    deleted = tx_id(session)
    assert editor.post("/api/crags", json={"name": "Baszta", "area_id": region.id, "location": [19.7, 50.1]}).json()[
        "slug"
    ] == "baszta"

    assert revert(editor, deleted).status_code == 200
    session.expire_all()
    assert session.get(Crag, baszta_id).slug == "baszta-2"
    assert editor.get("/api/crags/baszta-2").json()["id"] == baszta_id


def test_revert_crag_to_sector(editor, session):
    region, crag, walls, (d1, d2, d3), l2 = make_three_wall_crag(session)
    crag_id, wall_ids, route_ids, l2_id = crag.id, [w.id for w in walls], [d1.id, d2.id, d3.id], l2.id
    body = editor.post(f"/api/crags/{crag_id}/to-sector", json={}).json()
    split = tx_id(session)
    copy_id = session.scalars(select(Route.id).where(Route.crag_id == body["crags"][2]["id"])).one()

    assert revert(editor, split).status_code == 200
    session.expire_all()
    restored = session.get(Crag, crag_id)
    assert (restored.name, restored.slug, restored.area_id) == ("Skała", "skala", region.id)
    assert [w.id for w in restored.walls] == wall_ids
    assert [r.id for r in restored.routes] == route_ids
    assert session.get(RouteLine, l2_id).route_id == d2.id
    assert session.get(Route, copy_id) is None
    assert session.get(Area, body["sector"]["id"]) is None
    assert all(session.get(Crag, c["id"]) is None for c in body["crags"])


def test_revert_crag_in_obszar_to_region(editor, session):
    obszar, crag, walls, _, _ = make_three_wall_crag(session, in_obszar=True)
    crag_id, wall_ids = crag.id, [w.id for w in walls]
    body = editor.post(f"/api/crags/{crag_id}/to-sector", json={}).json()

    assert revert(editor, tx_id(session)).status_code == 200
    session.expire_all()
    restored = session.get(Crag, crag_id)
    assert (restored.area_id, [w.id for w in restored.walls]) == (obszar.id, wall_ids)
    assert session.get(Area, body["sector"]["id"]) is None
    assert all(session.get(Crag, c["id"]) is None for c in body["crags"])


def test_revert_crag_to_sector_after_pin_moved(editor, session):
    _, crag, walls, _, _ = make_three_wall_crag(session)
    crag_id, wall_ids = crag.id, [w.id for w in walls]
    body = editor.post(f"/api/crags/{crag_id}/to-sector", json={}).json()
    split = tx_id(session)
    moved = body["crags"][1]["id"]
    editor.patch(f"/api/crags/{moved}", json={"location": [19.8, 50.2]})

    response = revert(editor, split)
    assert response.status_code == 409
    assert [(c["kind"], c["id"], c["field"]) for c in response.json()["conflicts"]] == [("crag", moved, "*")]
    assert revert(editor, split, mode="all").status_code == 200
    session.expire_all()
    assert [w.id for w in session.get(Crag, crag_id).walls] == wall_ids
    assert session.get(Crag, moved) is None
    assert session.get(Area, body["sector"]["id"]) is None


def test_revert_new_sector(editor, session):
    _, region = make_crag(session)
    other = f.area(session, "Inny", kind="sektor", parent=region)
    a, b = f.crag(session, region, "A"), f.crag(session, other, "B")
    session.commit()
    sector = editor.post(
        "/api/areas", json={"kind": "sektor", "parent_id": region.id, "name": "Nowy", "crag_ids": [a.id, b.id]}
    ).json()

    assert revert(editor, tx_id(session)).status_code == 200
    session.expire_all()
    assert (a.area_id, b.area_id) == (region.id, other.id)
    assert session.get(Area, sector["id"]) is None


def test_revert_twice_is_harmless(editor, session):
    crag, _ = make_crag(session)
    route = f.route(session, crag, "Kant", grade="VI")
    session.commit()
    crag_id, route_id = crag.id, route.id
    editor.patch(f"/api/crags/{crag_id}", json={"description": "Opis"})
    edit = tx_id(session)
    editor.delete(f"/api/crags/{crag_id}")
    deletion = tx_id(session)

    for original in (deletion, edit):
        assert revert(editor, original).status_code == 200
        last = tx_id(session)
        second = revert(editor, original)
        assert second.status_code in (200, 409)
        if second.status_code == 200:
            assert second.json() == {"transaction_id": None}
        assert tx_id(session) == last
    session.expire_all()
    assert session.get(Crag, crag_id).description is None
    assert session.get(Route, route_id).grade == "VI"


def test_revert_of_revert(editor, session):
    crag, _ = make_crag(session)
    route = f.route(session, crag, "Kant", grade="VI")
    session.commit()
    crag_id, route_id = crag.id, route.id
    editor.patch(f"/api/routes/{route_id}", json={"grade": "VI.1", "description": "Opis"})
    first = revert(editor, tx_id(session)).json()["transaction_id"]
    assert revert(editor, first).status_code == 200
    session.expire_all()
    restored = session.get(Route, route_id)
    assert (restored.grade, restored.grade_sort, restored.description) == ("VI.1", grade_sort("VI.1"), "Opis")

    editor.delete(f"/api/crags/{crag_id}")
    undelete = revert(editor, tx_id(session)).json()["transaction_id"]
    assert session.get(Crag, crag_id) is not None
    assert revert(editor, undelete).status_code == 200
    session.expire_all()
    assert session.get(Crag, crag_id) is None and session.get(Route, route_id) is None


def test_revert_errors(client, editor, session):
    set_author(session, IMPORT_AUTHOR_PREFIX + "portalgorski")
    make_crag(session)
    imported = tx_id(session)
    response = revert(editor, imported)
    assert (response.status_code, response.json()["code"]) == (403, "import_revert")
    assert response.json()["message"] == "Danych z importu nie cofa się — popraw je ręcznie"
    assert revert(editor, 999_999).status_code == 404
    assert revert(editor, imported, mode="check").status_code == 422
    client.cookies.clear()
    assert revert(client, imported).status_code == 401


def test_import_keeps_away_after_revert(editor, session):
    set_author(session, IMPORT_AUTHOR_PREFIX + "portalgorski")
    crag, _ = make_crag(session)
    assert not is_manually_edited(session, Crag, [crag.id])
    crag_id = crag.id
    editor.delete(f"/api/crags/{crag_id}")
    assert revert(editor, tx_id(session)).status_code == 200
    assert is_manually_edited(session, Crag, [crag_id])
    assert session.get(transaction_class(), tx_id(session)).author == "ania"


def test_restored_line_points_keep_ids(editor, session):
    _, _, route_a, line_a, _ = variant_crag(session)
    point_ids, line_a_id = [p.id for p in line_a.points], line_a.id
    editor.delete(f"/api/routes/{route_a.id}")
    revert(editor, tx_id(session))
    session.expire_all()
    restored = session.scalars(select(LinePoint.id).where(LinePoint.line_id == line_a_id).order_by(LinePoint.id))
    assert restored.all() == point_ids


def test_revert_of_topo_save_bumps_version(editor, session):
    crag, _ = make_crag(session)
    wall = f.wall(session, crag)
    session.commit()
    wall_id = wall.id
    body = {
        "version": 1, "new_routes": [{"ref": "r", "name": "Nowa", "grade": "VI"}],
        "lines": [{"ref": "l", "route_ref": "r", "sort_order": 0,
                   "points": [{"ref": "a", "sort_order": 0, "x": 0.2, "y": 0.9, "kind": "start"},
                              {"ref": "b", "sort_order": 1, "x": 0.3, "y": 0.1, "kind": "stanowisko"}]}],
    }  # fmt: skip
    ids = editor.put(f"/api/walls/{wall_id}/lines", json=body).json()["ids"]
    assert revert(editor, tx_id(session)).status_code == 200
    session.expire_all()
    assert session.get(RouteLine, ids["l"]) is None and session.get(Route, ids["r"]) is None
    assert session.get(Wall, wall_id).version == 3  # 1 → save → 2 → revert → 3
    stale = editor.put(f"/api/walls/{wall_id}/lines", json={"version": 2, "new_routes": [], "lines": []})
    assert stale.status_code == 409
