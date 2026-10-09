from sqlalchemy import select
from sqlalchemy_continuum import version_class

from tests import factories as f
from tests.test_api_edit import last_transaction
from topo.models import Area, Crag, Route, RouteLine, Wall


def make_region(session):
    obszar = f.area(session, "Jura", kind="obszar")
    region = f.area(session, "Dolina Kobylańska", parent=obszar)
    session.commit()  # setup must not share the request's history transaction
    return obszar, region


def test_new_sector_from_crags_of_region(editor, session):
    _, region = make_region(session)
    other = f.area(session, "Inny sektor", kind="sektor", parent=region)
    a, b = f.crag(session, region, "A"), f.crag(session, region, "B")
    c = f.crag(session, other, "C")
    session.commit()
    response = editor.post(
        "/api/areas",
        json={"kind": "sektor", "parent_id": region.id, "name": "Nowy", "crag_ids": [a.id, b.id, c.id], "comment": "x"},
    )
    assert response.status_code == 201
    body = response.json()
    sector = session.get(Area, body["id"])
    assert (sector.kind, sector.parent_id, sector.slug, sector.source) == ("sektor", region.id, "nowy", "manual")
    session.expire_all()
    assert {a.area_id, b.area_id, c.area_id} == {sector.id}
    assert last_transaction(session).author == "ania"


def test_sector_rejects_crag_from_other_region(editor, session):
    obszar, region = make_region(session)
    elsewhere = f.area(session, "Inny region", parent=obszar)
    far = f.crag(session, elsewhere, "Daleka")
    session.commit()
    response = editor.post(
        "/api/areas", json={"kind": "sektor", "parent_id": region.id, "name": "Nowy", "crag_ids": [far.id]}
    )
    assert (response.status_code, response.json()["code"]) == (422, "crag_outside_region")
    assert "Daleka" in response.json()["message"]


def test_area_parent_kinds(editor, session):
    obszar, region = make_region(session)
    sector = f.area(session, "Sektor", kind="sektor", parent=region)
    session.commit()
    assert editor.post("/api/areas", json={"kind": "region", "parent_id": obszar.id, "name": "R"}).status_code == 201
    assert editor.post("/api/areas", json={"kind": "sektor", "parent_id": region.id, "name": "S"}).status_code == 201
    assert editor.post("/api/areas", json={"kind": "sektor", "parent_id": sector.id, "name": "S2"}).status_code == 422
    assert editor.post("/api/areas", json={"kind": "region", "parent_id": region.id, "name": "R2"}).status_code == 422
    bad = editor.post("/api/areas", json={"kind": "region", "parent_id": obszar.id, "name": "R3", "crag_ids": [1]})
    assert bad.status_code == 422


def test_patch_area(editor, session):
    obszar, region = make_region(session)
    other = f.area(session, "Inny region", parent=obszar)
    session.commit()
    ok = editor.patch(f"/api/areas/{region.id}", json={"name": "Nowa nazwa", "description": " opis "})
    assert ok.json()["changed"] == ["description", "name"]
    assert ok.json()["slug"] == "dolina-kobylanska"
    assert editor.patch(f"/api/areas/{region.id}", json={"parent_id": other.id}).status_code == 422
    sector = f.area(session, "Sektor", kind="sektor", parent=region)
    session.commit()
    assert editor.patch(f"/api/areas/{sector.id}", json={"parent_id": obszar.id}).status_code == 422
    assert editor.patch(f"/api/areas/{sector.id}", json={"parent_id": other.id}).status_code == 200
    session.expire_all()
    assert sector.parent_id == other.id
    assert editor.patch(f"/api/areas/{sector.id}", json={"name": None}).status_code == 422


def test_delete_area_only_when_empty(editor, session):
    _, region = make_region(session)
    sector = f.area(session, "Sektor", kind="sektor", parent=region)
    empty = f.area(session, "Pusty", kind="sektor", parent=region)
    f.crag(session, sector, "A")
    session.commit()
    for non_empty in (region, sector):
        response = editor.delete(f"/api/areas/{non_empty.id}")
        assert (response.status_code, response.json()["code"]) == (409, "area_not_empty")
    assert editor.delete(f"/api/areas/{empty.id}").status_code == 204
    assert session.get(Area, empty.id) is None


def make_three_wall_crag(session, *, wall_names=("Lewa", "Środek", "Prawa"), in_sector=False, in_obszar=False):
    obszar, region = make_region(session)
    area = f.area(session, "Sektor", kind="sektor", parent=region) if in_sector else region
    if in_obszar:
        region = area = obszar
    crag = f.crag(session, area, "Skała", rock_type="wapień", description="Opis", aspects=["N"])
    walls = [f.wall(session, crag, name, sort_order=i) for i, name in enumerate(wall_names)]
    d1, d2, d3 = (f.route(session, crag, name, "VI", number=i) for i, name in enumerate(("D1", "D2", "D3"), 1))
    f.line(session, walls[0], d1)
    f.line(session, walls[0], d2, sort_order=1)
    l2 = f.line(session, walls[2], d2)
    session.commit()
    return region, crag, walls, (d1, d2, d3), l2


def test_crag_to_sector(editor, session):
    region, crag, walls, (d1, d2, d3), l2 = make_three_wall_crag(session)
    crag_id, wall_ids = crag.id, [w.id for w in walls]
    response = editor.post(f"/api/crags/{crag_id}/to-sector", json={"comment": "podział"})
    assert response.status_code == 200
    body = response.json()
    assert [c["needs_location"] for c in body["crags"]] == [False, True, True]
    assert [c["name"] for c in body["crags"]] == ["Lewa", "Środek", "Prawa"]
    session.expire_all()
    sector = session.get(Area, body["sector"]["id"])
    assert (sector.name, sector.parent_id, sector.description) == ("Skała", region.id, "Opis")
    first, middle, last = (session.get(Crag, c["id"]) for c in body["crags"])
    assert all(c.area_id == sector.id and c.source == "manual" for c in (first, middle, last))
    assert (first.rock_type, first.aspects, first.description) == ("wapień", ["N"], "Opis")
    assert session.get(Crag, crag_id) is None
    # walls are moved, not recreated
    assert [session.get(Wall, wid).crag_id for wid in wall_ids] == [first.id, middle.id, last.id]
    # D1 and D2 stay in the first crag (same ids), D3 (no lines) too; D2's copy lives on the third wall
    assert {session.get(Route, r.id).crag_id for r in (d1, d2, d3)} == {first.id}
    copy = session.scalars(select(Route).where(Route.crag_id == last.id)).one()
    assert (copy.name, copy.grade, copy.number, copy.source) == ("D2", "VI", 2, "manual")
    assert copy.id != d2.id
    assert session.get(RouteLine, l2.id).route_id == copy.id
    # one request, one history transaction
    tx = last_transaction(session)
    assert tx.comment == "podział"
    for model in (Area, Crag, Wall, Route):
        txs = set(session.scalars(select(version_class(model).transaction_id).distinct()))
        assert tx.id in txs
    created = session.scalars(select(version_class(Crag)).where(version_class(Crag).transaction_id == tx.id)).all()
    assert len(created) == 4  # three new, one deleted


def test_crag_to_sector_unnamed_walls(editor, session):
    _, crag, _, _, _ = make_three_wall_crag(session, wall_names=(None, "Druga", None))
    body = editor.post(f"/api/crags/{crag.id}/to-sector", json={}).json()
    assert [c["name"] for c in body["crags"]] == ["Skała — ściana 1", "Druga", "Skała — ściana 3"]


def test_crag_to_sector_preview(editor, session):
    _, crag, _, _, _ = make_three_wall_crag(session)
    response = editor.get(f"/api/crags/{crag.id}/to-sector/preview")
    assert response.json() == {
        "kind": "sektor",
        "sector_name": "Skała",
        "crags": ["Lewa", "Środek", "Prawa"],
        "copied_routes": 1,
        "unplaced": 2,
    }


def test_crag_to_sector_needs_login_and_two_walls(client, editor, session):
    _, region = make_region(session)
    crag = f.crag(session, region, "Jedna")
    f.wall(session, crag)
    session.commit()
    for call in (
        lambda: editor.post(f"/api/crags/{crag.id}/to-sector", json={}),
        lambda: editor.get(f"/api/crags/{crag.id}/to-sector/preview"),
    ):
        response = call()
        assert (response.status_code, response.json()["code"]) == (422, "single_wall")
    client.cookies.clear()
    assert client.get(f"/api/crags/{crag.id}/to-sector/preview").status_code == 401


def test_crag_in_obszar_gives_region_inside_it(editor, session):
    obszar, crag, _, _, _ = make_three_wall_crag(session, in_obszar=True)
    crag_id = crag.id
    preview = editor.get(f"/api/crags/{crag_id}/to-sector/preview").json()
    assert (preview["kind"], preview["sector_name"]) == ("region", "Skała")
    response = editor.post(f"/api/crags/{crag_id}/to-sector", json={})
    assert response.status_code == 200
    body = response.json()
    assert body["sector"]["kind"] == "region"
    session.expire_all()
    region = session.get(Area, body["sector"]["id"])
    assert (region.kind, region.parent_id, region.name, region.description, region.source) == (
        "region", obszar.id, "Skała", "Opis", "manual",
    )  # fmt: skip
    assert all(session.get(Crag, c["id"]).area_id == region.id for c in body["crags"])
    assert session.get(Crag, crag_id) is None


def test_crag_in_sector_gives_sector_beside(editor, session):
    region, crag, _, _, _ = make_three_wall_crag(session, in_sector=True)
    body = editor.post(f"/api/crags/{crag.id}/to-sector", json={}).json()
    assert session.get(Area, body["sector"]["id"]).parent_id == region.id
