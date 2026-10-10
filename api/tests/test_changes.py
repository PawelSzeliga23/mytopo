import sqlalchemy as sa

from tests import factories as f
from tests.test_api_edit import last_transaction
from topo.changes import KIND, MODELS, SKIP_FIELDS, transaction_changes
from topo.history import IMPORT_AUTHOR_PREFIX, set_author
from topo.models import Crag, LinePoint, Route, RouteLine, Wall


def setup_crag(session, name="Żabi Koń", **kw):
    set_author(session, IMPORT_AUTHOR_PREFIX + "test")  # setup transactions stay out of the default list
    region = f.area(session, "Dolina Kobylańska", slug=f"dolina-{name}")
    crag = f.crag(session, region, name, **kw)
    session.commit()  # setup must not share the request's history transaction
    return crag


def edit(session, author, fn, comment=None, reverts_id=None):
    """Run ``fn`` as one history transaction by ``author``; return the transaction id."""
    set_author(session, author, comment, reverts_id)
    fn()
    session.commit()
    return last_transaction(session).id


def changes_for(client, **params):
    response = client.get("/api/changes", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_constants_cover_models():
    assert [KIND[m] for m in MODELS] == ["area", "crag", "wall", "route", "line", "point"]
    assert {"grade_sort", "version", "needs_location"} <= SKIP_FIELDS


def test_update_diffs_skip_internal_fields(session):
    crag = setup_crag(session)
    route = f.route(session, crag, "Filar", grade="VI")
    session.commit()

    def change():
        crag.description = "Nowy opis"
        route.grade, route.grade_sort = "VI.1", 61

    tx_id = edit(session, "ania", change)
    crag_change, route_change = transaction_changes(session, tx_id)
    assert (crag_change.model, crag_change.op) == (Crag, "updated")
    assert [(d.field, d.before, d.after) for d in crag_change.diffs] == [("description", None, "Nowy opis")]
    assert (route_change.model, route_change.op) == (Route, "updated")
    assert [(d.field, d.before, d.after) for d in route_change.diffs] == [("grade", "VI", "VI.1")]
    assert route_change.before["grade_sort"] != route_change.after["grade_sort"]  # kept in the raw values


def test_created_and_deleted_objects(session):
    region = f.area(session, "Dolina")
    session.commit()
    created_tx = edit(session, "ania", lambda: f.crag(session, region, "Nowa", description="Opis"))
    [created] = transaction_changes(session, created_tx)
    assert (created.op, created.before) == ("created", None)
    assert created.after["name"] == "Nowa"
    assert {d.field for d in created.diffs} >= {"name", "slug", "description", "location"}
    assert all(d.before is None for d in created.diffs)
    assert "rock_type" not in {d.field for d in created.diffs}  # empty values are left out

    crag = session.query(Crag).one()
    route = f.route(session, crag, "Filar", grade="VI")
    session.commit()
    deleted_tx = edit(session, "ania", lambda: session.delete(route))
    [deleted] = transaction_changes(session, deleted_tx)
    assert (deleted.op, deleted.after) == ("deleted", None)
    assert deleted.before["name"] == "Filar"
    assert deleted.before["crag_id"] == crag.id and deleted.before["grade_sort"] is not None
    assert {d.field for d in deleted.diffs} >= {"name", "grade"}


def test_location_is_lon_lat(session):
    crag = setup_crag(session, lng=19.75, lat=50.15)

    def move():
        crag.location = f.crag(session, crag.area, "Pomocnicza", lng=19.8, lat=50.2).location

    tx_id = edit(session, "ania", move)
    crag_change = next(c for c in transaction_changes(session, tx_id) if c.id == crag.id)
    assert crag_change.before["location"] == [19.75, 50.15]
    assert crag_change.after["location"] == [19.8, 50.2]
    [diff] = crag_change.diffs
    assert (diff.field, diff.before, diff.after) == ("location", [19.75, 50.15], [19.8, 50.2])


def test_changes_are_public_but_revert_needs_login(client):
    assert client.get("/api/changes").status_code == 200
    assert client.post("/api/changes/1/revert", json={}).status_code == 401


def test_api_returns_objects_and_crag(editor, session):
    crag = setup_crag(session)
    route = f.route(session, crag, "Filar", grade="VI")
    session.commit()
    response = editor.patch(f"/api/crags/{crag.id}", json={"description": "Opis", "comment": "uzupełnienie"})
    assert response.status_code == 200
    editor.patch(f"/api/routes/{route.id}", json={"grade": "VI.1"})

    items = changes_for(editor)["items"]
    assert [i["objects"][0]["kind"] for i in items[:2]] == ["route", "crag"]
    item = items[1]
    assert (item["author"], item["comment"], item["is_import"]) == ("ania", "uzupełnienie", False)
    assert item["crag"] == {"id": crag.id, "name": "Żabi Koń", "slug": crag.slug}
    assert [a["name"] for a in item["area_path"]] == ["Dolina Kobylańska"]
    assert item["objects"][0]["diffs"] == [{"field": "description", "before": None, "after": "Opis"}]
    assert item["reverted_by"] is None and item["reverts_id"] is None


def test_crag_filter_includes_walls_routes_lines_and_deleted(editor, session):
    mine = setup_crag(session, "Moja")
    other = setup_crag(session, "Obca")
    wall = f.wall(session, mine, "Ściana A")
    route = f.route(session, mine, "Filar")
    line = f.line(session, wall, route=route)
    other_wall = f.wall(session, other, "Cudza")
    session.commit()

    edit(session, "ania", lambda: setattr(wall, "name", "Ściana B"))
    wall_tx = last_transaction(session).id
    edit(session, "ania", lambda: setattr(route, "name", "Filarek"))
    route_tx = last_transaction(session).id
    edit(session, "ania", lambda: setattr(line.points[1], "x", 0.4))
    line_tx = last_transaction(session).id
    edit(session, "ania", lambda: setattr(other_wall, "name", "Cudza 2"))
    other_tx = last_transaction(session).id
    mine_id = mine.id
    edit(session, "ania", lambda: session.delete(mine))
    delete_tx = last_transaction(session).id

    ids = {i["id"] for i in changes_for(editor, crag=mine_id, include_import=True)["items"]}
    assert {wall_tx, route_tx, line_tx, delete_tx} <= ids
    assert other_tx not in ids
    deleted = changes_for(editor, crag=mine_id)["items"][0]
    assert deleted["id"] == delete_tx
    assert deleted["crag"] == {"id": mine_id, "name": "Moja", "slug": None}
    assert deleted["area_path"] == []
    assert any(o["kind"] == "crag" and o["op"] == "deleted" for o in deleted["objects"])


def test_kind_deleted_only_deletions(editor, session):
    crag = setup_crag(session)
    route = f.route(session, crag, "Filar")
    session.commit()
    edit(session, "ania", lambda: setattr(crag, "description", "x"))
    delete_tx = edit(session, "ania", lambda: session.delete(route))

    items = changes_for(editor, kind="deleted")["items"]
    assert [i["id"] for i in items] == [delete_tx]
    assert items[0]["objects"][0]["op"] == "deleted"


def test_import_hidden_by_default(editor, session):
    crag = setup_crag(session)
    import_tx = edit(session, IMPORT_AUTHOR_PREFIX + "portalgorski", lambda: setattr(crag, "description", "z importu"))
    manual_tx = edit(session, "ania", lambda: setattr(crag, "description", "ręcznie"))

    assert [i["id"] for i in changes_for(editor)["items"]] == [manual_tx]
    with_import = changes_for(editor, include_import=True)["items"]
    assert [(i["id"], i["is_import"]) for i in with_import[:2]] == [(manual_tx, False), (import_tx, True)]


def test_pagination(editor, session):
    crag = setup_crag(session)
    for n in range(35):
        edit(session, "ania", lambda: setattr(crag, "description", f"opis {n}"))

    first = changes_for(editor, crag=crag.id, limit=30)
    assert len(first["items"]) == 30
    assert first["next_before"] == first["items"][-1]["id"]
    second = changes_for(editor, crag=crag.id, limit=30, before=first["next_before"])
    assert len(second["items"]) == 5 and second["next_before"] is None
    assert second["items"][0]["id"] < first["items"][-1]["id"]
    assert editor.get("/api/changes", params={"limit": 101}).status_code == 422


def test_line_and_point_changes_fold_into_topo_object(editor, session):
    crag = setup_crag(session)
    wall = f.wall(session, crag, "Ściana A")
    line = f.line(session, wall)
    session.commit()

    def move_points():
        line.sort_order = 3
        for point in line.points:
            point.x = 0.2

    edit(session, "ania", move_points)
    [item] = changes_for(editor, crag=crag.id)["items"]
    [topo] = item["objects"]
    assert (topo["kind"], topo["id"], topo["name"]) == ("topo", wall.id, "Ściana A")
    assert topo["diffs"] == []
    assert topo["summary"] == "zmieniono 1 linię, 3 punkty"
    assert item["crag"]["id"] == crag.id

    changes = transaction_changes(session, last_transaction(session).id)
    assert [c.model for c in changes] == [RouteLine] + [LinePoint] * 3
    assert Wall not in {c.model for c in changes}


def test_reverted_by(editor, session):
    crag = setup_crag(session)
    original = edit(session, "ania", lambda: setattr(crag, "description", "x"))
    revert = edit(session, "ola", lambda: setattr(crag, "description", None), reverts_id=original)

    items = {i["id"]: i for i in changes_for(editor)["items"]}
    assert items[original]["reverted_by"] == revert
    assert items[revert]["reverts_id"] == original and items[revert]["reverted_by"] is None



def test_first_versioned_update_of_preexisting_row_stays_updated(editor, session):
    region = f.area(session, "Dolina")
    session.commit()
    # Inserted through Core, so Continuum writes no version row (like data that predates versioning).
    crag_id = session.execute(
        sa.insert(Crag.__table__)
        .values(area_id=region.id, name="Stara", slug="stara", location=sa.func.ST_GeomFromText("POINT(19.7 50.1)", 4326))
        .returning(Crag.__table__.c.id)
    ).scalar_one()
    session.commit()

    assert editor.patch(f"/api/crags/{crag_id}", json={"description": "Opis"}).status_code == 200
    [change] = transaction_changes(session, last_transaction(session).id)
    assert (change.op, change.before) == ("updated", None)
    assert change.after["description"] == "Opis"
    [item] = changes_for(editor)["items"][:1]
    assert item["objects"][0]["op"] == "updated"


def test_area_fields_show_names(editor, session):
    jura = f.area(session, "Jura", kind="obszar")
    first = f.area(session, "Dolina Kobylańska", parent=jura)
    second = f.area(session, "Dolina Będkowska", parent=jura)
    crag = f.crag(session, first, "Żabi Koń")
    session.commit()
    assert editor.patch(f"/api/crags/{crag.id}", json={"area_id": second.id}).status_code == 200
    [item, *_] = editor.get("/api/changes", params={"crag": crag.id}).json()["items"]
    [diff] = [d for o in item["objects"] for d in o["diffs"] if d["field"] == "area_id"]
    assert (diff["before"], diff["after"]) == ("Dolina Kobylańska", "Dolina Będkowska")
