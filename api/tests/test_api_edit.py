from sqlalchemy import func, select
from sqlalchemy_continuum import version_class

from tests import factories as f
from topo.config import get_settings
from topo.history import transaction_class
from topo.models import Crag, LinePoint, Route, RouteLine, Wall


def make_crag(session, name="Żabi Koń"):
    region = f.area(session, "Dolina Kobylańska")
    crag = f.crag(session, region, name)
    session.commit()  # setup must not share the request's history transaction
    return crag, region


def last_transaction(session):
    tx = transaction_class()
    return session.scalars(select(tx).order_by(tx.id.desc()).limit(1)).one()


def tx_count(session):
    return session.scalar(select(func.count()).select_from(transaction_class()))


def versions(session, model, **where):
    version = version_class(model)
    return session.scalars(select(version).filter_by(**where).order_by(version.transaction_id)).all()


def test_edit_requires_login(client, session):
    crag, _ = make_crag(session)
    assert client.patch(f"/api/crags/{crag.id}", json={"description": "x"}).status_code == 401
    assert client.delete("/api/routes/1").status_code == 401
    assert client.patch("/api/walls/1", json={}).status_code == 401


def test_patch_crag_description_records_author_and_comment(editor, session):
    crag, _ = make_crag(session)
    response = editor.patch(f"/api/crags/{crag.id}", json={"description": " Nowy opis ", "comment": " poprawka "})
    assert response.status_code == 200
    assert response.json() == {"id": crag.id, "slug": crag.slug, "changed": ["description"]}
    assert editor.get(f"/api/crags/{crag.slug}").json()["description"] == "Nowy opis"
    tx = last_transaction(session)
    assert (tx.author, tx.comment) == ("ania", "poprawka")


def test_rename_keeps_slug(editor, session):
    crag, _ = make_crag(session)
    body = editor.patch(f"/api/crags/{crag.id}", json={"name": "Nowa nazwa"}).json()
    assert body["slug"] == "zabi-kon"
    assert editor.get("/api/crags/zabi-kon").json()["name"] == "Nowa nazwa"


def test_patch_rejects_null_name_and_missing_crag(editor, session):
    crag, _ = make_crag(session)
    assert editor.patch(f"/api/crags/{crag.id}", json={"name": None}).status_code == 422
    assert editor.patch("/api/crags/999999", json={"description": "x"}).status_code == 404


def test_create_crag_unique_slug(editor, session):
    crag, region = make_crag(session)
    response = editor.post("/api/crags", json={"name": "Żabi Koń", "area_id": region.id, "location": [19.7, 50.1]})
    assert response.status_code == 201
    body = response.json()
    assert body["slug"] == "zabi-kon-2"
    created = session.get(Crag, body["id"])
    assert created.source == "manual"
    assert last_transaction(session).author == "ania"


def test_create_crag_rejects_bad_area_and_location(editor, session):
    _, region = make_crag(session)
    obszar = f.area(session, "Jura", kind="obszar")
    base = {"name": "Nowa", "location": [19.7, 50.1]}
    assert editor.post("/api/crags", json={**base, "area_id": obszar.id}).json()["code"] == "invalid_area"
    assert editor.post("/api/crags", json={**base, "area_id": 999999}).status_code == 422
    bad = editor.post("/api/crags", json={"name": "Nowa", "area_id": region.id, "location": [200, 0]})
    assert (bad.status_code, bad.json()["code"]) == (422, "invalid_location")


def test_patch_location_clears_needs_location(editor, session):
    crag, _ = make_crag(session)
    crag.needs_location = True
    session.flush()
    body = editor.patch(f"/api/crags/{crag.id}", json={"location": [19.7, 50.1]}).json()
    assert body["changed"] == ["location"]
    detail = editor.get(f"/api/crags/{crag.slug}").json()
    assert (detail["lng"], detail["lat"], detail["needs_location"]) == (19.7, 50.1, False)
    assert editor.patch(f"/api/crags/{crag.id}", json={"location": [200, 0]}).status_code == 422


def test_patch_area_validated(editor, session):
    crag, _ = make_crag(session)
    obszar = f.area(session, "Jura", kind="obszar")
    sektor = f.area(session, "Grupa", kind="sektor")
    assert editor.patch(f"/api/crags/{crag.id}", json={"area_id": obszar.id}).json()["code"] == "invalid_area"
    assert editor.patch(f"/api/crags/{crag.id}", json={"area_id": sektor.id}).json()["changed"] == ["area_id"]


def test_route_grade_changes(editor, session):
    crag, _ = make_crag(session)
    route = f.route(session, crag, "Kant", grade="VI")
    old_sort = route.grade_sort
    ok = editor.patch(f"/api/routes/{route.id}", json={"grade": "vi.1+"})
    assert ok.json() == {"id": route.id, "changed": ["grade"]}
    session.refresh(route)
    assert route.grade == "VI.1+"
    assert route.grade_sort > old_sort
    bad = editor.patch(f"/api/routes/{route.id}", json={"grade": "VI.x"})
    assert (bad.status_code, bad.json()["code"]) == (422, "invalid_grade")
    assert editor.patch(f"/api/routes/{route.id}", json={"grade": ""}).status_code == 200
    session.refresh(route)
    assert route.grade is None and route.grade_sort is None


def test_create_route(editor, session):
    crag, _ = make_crag(session)
    response = editor.post(
        f"/api/crags/{crag.id}/routes", json={"name": " Nowa ", "grade": "V+", "year": 2020, "length_m": 20}
    )
    assert response.status_code == 201
    route = session.get(Route, response.json()["id"])
    assert (route.name, route.grade, route.year, route.source, route.crag_id) == ("Nowa", "V+", 2020, "manual", crag.id)
    assert editor.post(f"/api/crags/{crag.id}/routes", json={"name": "X", "year": 1800}).status_code == 422
    assert editor.post("/api/crags/999999/routes", json={"name": "X"}).status_code == 404


def test_patch_without_changes_adds_no_transaction(editor, session):
    crag, _ = make_crag(session)
    route = f.route(session, crag, "Kant", grade="VI")
    wall = f.wall(session, crag, name="A")
    session.commit()
    before = tx_count(session)
    for url, body in [
        (f"/api/crags/{crag.id}", {"name": crag.name, "comment": "nic"}),
        (f"/api/routes/{route.id}", {"grade": "VI"}),
        (f"/api/walls/{wall.id}", {"name": "A"}),
    ]:
        response = editor.patch(url, json=body)
        assert response.status_code == 200 and response.json()["changed"] == []
    assert tx_count(session) == before


def test_delete_route_detaches_variants(editor, session):
    crag, _ = make_crag(session)
    wall = f.wall(session, crag)
    route_a = f.route(session, crag, "A")
    route_b = f.route(session, crag, "B")
    line_a = f.line(session, wall, route=route_a)
    line_b = f.line(
        session, wall, route=route_b, parent_line_id=line_a.id, parent_point_id=line_a.points[1].id,
        points=((0.5, 0.5, "start"), (0.6, 0.3, "stanowisko")),
    )
    a_id, line_a_id, b_id, line_b_id = route_a.id, line_a.id, route_b.id, line_b.id
    session.commit()

    assert editor.delete(f"/api/routes/{a_id}?comment=duplikat").status_code == 204
    session.expire_all()
    assert session.get(Route, a_id) is None and session.get(RouteLine, line_a_id) is None
    assert session.get(Route, b_id) is not None
    line_b = session.get(RouteLine, line_b_id)
    assert line_b.parent_line_id is None and line_b.parent_point_id is None
    assert versions(session, RouteLine, id=line_b_id)[-1].operation_type == 1
    assert versions(session, RouteLine, id=line_a_id)[-1].operation_type == 2
    assert last_transaction(session).comment == "duplikat"


def test_delete_crag_versions_everything(editor, session):
    crag, _ = make_crag(session)
    wall = f.wall(session, crag)
    route = f.route(session, crag, "A")
    line = f.line(session, wall, route=route)
    ids = (crag.id, wall.id, route.id, line.id, [p.id for p in line.points])
    session.commit()

    assert editor.delete(f"/api/crags/{ids[0]}").status_code == 204
    session.expire_all()
    assert session.get(Crag, ids[0]) is None
    tx_id = last_transaction(session).id
    for model, obj_ids in [
        (Crag, [ids[0]]), (Wall, [ids[1]]), (Route, [ids[2]]), (RouteLine, [ids[3]]), (LinePoint, ids[4]),
    ]:
        for obj_id in obj_ids:
            last = versions(session, model, id=obj_id)[-1]
            assert (last.operation_type, last.transaction_id) == (2, tx_id), model.__name__


def test_delete_crag_leaves_media_files(editor, session, tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    get_settings.cache_clear()
    crag, _ = make_crag(session)
    wall = f.wall(session, crag)
    image = tmp_path / "walls" / str(wall.id) / "display.webp"
    image.parent.mkdir(parents=True)
    image.write_bytes(b"x")
    session.commit()
    assert editor.delete(f"/api/crags/{crag.id}").status_code == 204
    assert image.exists()
    get_settings.cache_clear()


def test_patch_and_delete_wall(editor, session):
    crag, _ = make_crag(session)
    wall = f.wall(session, crag, name="Stara")
    route = f.route(session, crag, "A")
    f.line(session, wall, route=route)
    session.commit()
    wall_id, route_id = wall.id, route.id

    body = editor.patch(f"/api/walls/{wall_id}", json={"name": "Nowa", "description": "Opis"}).json()
    assert body["changed"] == ["description", "name"]
    assert editor.patch(f"/api/walls/{wall_id}", json={"sort_order": None}).status_code == 422

    assert editor.delete(f"/api/walls/{wall_id}").status_code == 204
    session.expire_all()
    assert session.get(Wall, wall_id) is None
    assert session.get(Route, route_id) is not None
    assert session.scalar(select(func.count()).select_from(RouteLine).where(RouteLine.wall_id == wall_id)) == 0
    assert editor.delete(f"/api/walls/{wall_id}").status_code == 404


def test_map_crags_has_needs_location(client, session):
    crag, _ = make_crag(session)
    crag.needs_location = True
    session.flush()
    [feature] = client.get("/api/map/crags").json()["features"]
    assert feature["properties"]["needs_location"] is True
