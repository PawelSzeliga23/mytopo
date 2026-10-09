from sqlalchemy import func, select
from sqlalchemy_continuum import version_class

from tests import factories as f
from topo.changes import transaction_changes
from topo.history import transaction_class
from topo.models import LinePoint, Route, RouteLine, Wall


def setup_wall(session):
    """A crag with two routes, a photo with route A's line, and route B on another crag (for the 422 case)."""
    region = f.area(session, "Dolina")
    crag = f.crag(session, region, "Żabi Koń")
    other = f.crag(session, region, "Baszta")
    a = f.route(session, crag, "Rysa", "V+")
    b = f.route(session, crag, "Filar", "VI.2")
    foreign = f.route(session, other, "Obca", "VI")
    wall = f.wall(session, crag)
    line = f.line(session, wall, a)
    session.commit()  # setup must not share the request's history transaction
    return wall, line, a, b, foreign


def last_tx(session):
    tx = transaction_class()
    return session.scalars(select(tx).order_by(tx.id.desc()).limit(1)).one()


def tx_count(session):
    return session.scalar(select(func.count()).select_from(transaction_class()))


def body_of(wall, line, **changes):
    """The current topo as the editor sends it; `changes` overrides top-level keys."""
    points = sorted(line.points, key=lambda p: p.sort_order)
    body = {
        "version": wall.version,
        "new_routes": [],
        "lines": [
            {
                "id": line.id, "route_id": line.route_id, "sort_order": 0, "parent": None,
                "points": [{"id": p.id, "sort_order": i, "x": p.x, "y": p.y, "kind": p.kind} for i, p in enumerate(points)],
            }
        ],
    }  # fmt: skip
    body.update(changes)
    return body


def put(client, wall, body):
    return client.put(f"/api/walls/{wall.id}/lines", json=body)


def test_move_point_and_change_kind_keeps_ids(editor, session):
    wall, line, *_ = setup_wall(session)
    body = body_of(wall, line, comment="poprawka ringu")
    body["lines"][0]["points"][1].update(x=0.42, kind="hak")
    point_ids = [p["id"] for p in body["lines"][0]["points"]]
    response = put(editor, wall, body)
    assert response.status_code == 200
    assert response.json() == {"version": 2, "ids": {}}
    session.expire_all()
    saved = session.get(RouteLine, line.id)
    assert [p.id for p in sorted(saved.points, key=lambda p: p.sort_order)] == point_ids
    moved = session.get(LinePoint, point_ids[1])
    assert (moved.x, moved.kind, moved.visible) == (0.42, "hak", True)
    assert (last_tx(session).author, last_tx(session).comment) == ("ania", "poprawka ringu")


def test_new_route_and_line_in_one_save(editor, session):
    wall, line, *_ = setup_wall(session)
    body = body_of(wall, line)
    body["new_routes"] = [{"ref": "n1", "name": " Nowa ", "grade": "VI.1+"}]
    body["lines"].append({
        "ref": "n2", "route_ref": "n1", "sort_order": 1,
        "points": [{"ref": "n3", "sort_order": 0, "x": 0.7, "y": 0.9, "kind": "start"},
                   {"ref": "n4", "sort_order": 1, "x": 0.7, "y": 0.2, "kind": "stanowisko"}],
    })  # fmt: skip
    response = put(editor, wall, body)
    assert response.status_code == 200
    ids = response.json()["ids"]
    assert set(ids) == {"n1", "n2", "n3", "n4"}
    route = session.get(Route, ids["n1"])
    assert (route.name, route.grade, route.source, route.grade_sort is not None) == ("Nowa", "VI.1+", "manual", True)
    new_line = session.get(RouteLine, ids["n2"])
    assert (new_line.route_id, new_line.wall_id, new_line.sort_order, new_line.color) == (route.id, wall.id, 1, "#0000FF")
    assert session.get(LinePoint, ids["n3"]).visible is False  # start


def test_variant_by_refs(editor, session):
    wall, line, a, *_ = setup_wall(session)
    body = body_of(wall, line)
    trunk = body["lines"][0]
    body["lines"].append({
        "ref": "n1", "route_id": a.id, "sort_order": 1,
        "parent": {"line_id": line.id, "point_id": trunk["points"][1]["id"]},
        "points": [{"ref": "n2", "sort_order": 0, "x": 0.5, "y": 0.5, "kind": "przelot"},
                   {"ref": "n3", "sort_order": 1, "x": 0.8, "y": 0.1, "kind": "stanowisko"}],
    })  # fmt: skip
    body["lines"].append({
        "ref": "n4", "route_id": None, "sort_order": 2, "parent": {"line_ref": "n1", "point_ref": "n3"},
        "points": [{"ref": "n5", "sort_order": 0, "x": 0.8, "y": 0.1, "kind": "przelot"},
                   {"ref": "n6", "sort_order": 1, "x": 0.9, "y": 0.05, "kind": "ring"}],
    })  # fmt: skip
    ids = put(editor, wall, body).json()["ids"]
    variant = session.get(RouteLine, ids["n1"])
    assert (variant.parent_line_id, variant.parent_point_id) == (line.id, trunk["points"][1]["id"])
    assert session.get(LinePoint, ids["n2"]).visible is False
    second = session.get(RouteLine, ids["n4"])
    assert (second.parent_line_id, second.parent_point_id) == (ids["n1"], ids["n3"])


def test_missing_line_is_deleted_and_its_variant_kept(editor, session):
    wall, line, a, b, _ = setup_wall(session)
    variant = f.line(session, wall, b, points=((0.5, 0.5, "przelot"), (0.8, 0.1, "stanowisko")), sort_order=1)
    variant.parent_line_id, variant.parent_point_id = line.id, sorted(line.points, key=lambda p: p.sort_order)[1].id
    session.commit()
    vpoints = sorted(variant.points, key=lambda p: p.sort_order)
    body = {
        "version": wall.version, "new_routes": [],
        "lines": [{"id": variant.id, "route_id": b.id, "sort_order": 0, "parent": None,
                   "points": [{"id": p.id, "sort_order": i, "x": p.x, "y": p.y, "kind": p.kind} for i, p in enumerate(vpoints)]}],
    }  # fmt: skip
    assert put(editor, wall, body).status_code == 200
    session.expire_all()
    assert session.get(RouteLine, line.id) is None
    kept = session.get(RouteLine, variant.id)
    assert (kept.parent_line_id, kept.parent_point_id) == (None, None)
    version = version_class(RouteLine)
    ops = session.scalars(select(version.operation_type).where(version.id == line.id).order_by(version.transaction_id)).all()
    assert ops[-1] == 2


def test_delete_parent_point_detaches_variant(editor, session):
    wall, line, a, b, _ = setup_wall(session)
    points = sorted(line.points, key=lambda p: p.sort_order)
    variant = f.line(session, wall, b, points=((0.5, 0.5, "przelot"), (0.8, 0.1, "stanowisko")), sort_order=1)
    variant.parent_line_id, variant.parent_point_id = line.id, points[1].id
    session.commit()
    body = body_of(wall, line)
    del body["lines"][0]["points"][1]  # the branch point goes
    vpoints = sorted(variant.points, key=lambda p: p.sort_order)
    body["lines"].append({
        "id": variant.id, "route_id": b.id, "sort_order": 1, "parent": None,
        "points": [{"id": p.id, "sort_order": i, "x": p.x, "y": p.y, "kind": p.kind} for i, p in enumerate(vpoints)],
    })  # fmt: skip
    assert put(editor, wall, body).status_code == 200
    session.expire_all()
    assert session.get(LinePoint, points[1].id) is None
    assert session.get(RouteLine, variant.id).parent_point_id is None


def test_stale_version_conflict(editor, session):
    wall, line, *_ = setup_wall(session)
    before = tx_count(session)
    body = body_of(wall, line)
    body["version"] = wall.version - 1
    body["lines"][0]["points"][0]["x"] = 0.1
    response = put(editor, wall, body)
    assert response.status_code == 409
    assert response.json() == {"code": "version_conflict", "message": "Ktoś zapisał topo w międzyczasie", "current_version": wall.version}
    session.expire_all()
    assert tx_count(session) == before
    assert sorted(session.get(RouteLine, line.id).points, key=lambda p: p.sort_order)[0].x == 0.5


def test_save_without_changes_makes_no_transaction(editor, session):
    wall, line, *_ = setup_wall(session)
    before = tx_count(session)
    response = put(editor, wall, body_of(wall, line))
    assert response.json() == {"version": 1, "ids": {}}
    assert tx_count(session) == before


def test_validation(editor, session):
    wall, line, a, b, foreign = setup_wall(session)
    other_wall = f.wall(session, wall.crag, "Druga")
    other_line = f.line(session, other_wall, a)
    session.commit()

    def check(mutate, message=None):
        body = body_of(wall, line)
        mutate(body)
        response = put(editor, wall, body)
        assert response.status_code == 422, response.json()
        if message:
            assert response.json()["message"] == message

    check(lambda b: b["lines"][0]["points"][0].update(x=1.2))
    check(lambda b: b["lines"][0]["points"][0].update(kind="spit"))
    check(lambda b: b["lines"][0].update(points=b["lines"][0]["points"][:1]))
    check(lambda b: b["lines"][0].update(route_id=foreign.id), "Droga nie należy do tej skały")
    check(lambda b: b["lines"][0]["points"][0].update(id=other_line.points[0].id), "Punkt nie należy do tej linii")
    check(lambda b: b["lines"][0].update(id=other_line.id), "Linia nie należy do tej ściany")

    def cycle(body):
        first = body["lines"][0]
        body["lines"].append({
            "ref": "n1", "route_id": None, "sort_order": 1, "parent": {"line_id": line.id, "point_id": first["points"][0]["id"]},
            "points": [{"ref": "n2", "sort_order": 0, "x": 0.1, "y": 0.1, "kind": "ring"}, {"ref": "n3", "sort_order": 1, "x": 0.2, "y": 0.1, "kind": "ring"}],
        })  # fmt: skip
        first["parent"] = {"line_ref": "n1", "point_ref": "n2"}

    check(cycle, "Wariant nie może pochodzić od samego siebie")

    def duplicate(body):
        body["new_routes"] = [{"ref": "x", "name": "A"}, {"ref": "x", "name": "B"}]

    check(duplicate, "Powtórzony identyfikator obiektu (ref)")


def test_requires_login_and_existing_wall(editor, session):
    wall, line, *_ = setup_wall(session)
    assert editor.put("/api/walls/999999/lines", json=body_of(wall, line)).status_code == 404
    editor.cookies.clear()
    assert editor.put(f"/api/walls/{wall.id}/lines", json=body_of(wall, line)).status_code == 401


def test_history_summarises_topo_and_skips_wall(editor, session):
    wall, line, *_ = setup_wall(session)
    body = body_of(wall, line)
    body["lines"][0]["points"][1]["x"] = 0.3
    put(editor, wall, body)
    changes = transaction_changes(session, last_tx(session).id)
    assert {change.model for change in changes} == {LinePoint}
    assert Wall not in {change.model for change in changes}
    listed = editor.get(f"/api/changes?crag={wall.crag_id}").json()["items"][0]
    assert [obj["kind"] for obj in listed["objects"]] == ["topo"]


def test_point_added_to_existing_line_is_kept(editor, session):
    wall, line, *_ = setup_wall(session)
    body = body_of(wall, line)
    points = body["lines"][0]["points"]
    points.insert(1, {"ref": "n1", "sort_order": 1, "x": 0.45, "y": 0.7, "kind": "przelot"})
    for i, point in enumerate(points):
        point["sort_order"] = i
    response = put(editor, wall, body)
    new_id = response.json()["ids"]["n1"]
    session.expire_all()
    assert session.get(LinePoint, new_id) is not None
    # The next save sends the new point by its id and must be accepted.
    del points[1]["ref"]
    points[1]["id"] = new_id
    points[1]["x"] = 0.46
    body["version"] = response.json()["version"]
    second = put(editor, wall, body)
    assert second.status_code == 200, second.json()
    assert session.get(LinePoint, new_id).x == 0.46


def test_unchanged_imported_sort_order_and_hidden_bolt_stay(editor, session):
    wall, line, *_ = setup_wall(session)
    line.sort_order = 10
    hidden = sorted(line.points, key=lambda p: p.sort_order)[1]
    hidden.visible = False
    session.commit()
    before = tx_count(session)
    body = body_of(wall, line)
    body["lines"][0]["sort_order"] = 10
    assert put(editor, wall, body).json() == {"version": 1, "ids": {}}
    assert tx_count(session) == before
    body["lines"][0]["points"][0]["x"] = 0.4
    put(editor, wall, body)
    session.expire_all()
    assert session.get(LinePoint, hidden.id).visible is False


def test_deleting_a_route_bumps_wall_version(editor, session):
    wall, line, a, *_ = setup_wall(session)
    assert editor.delete(f"/api/routes/{a.id}").status_code == 204
    session.expire_all()
    assert session.get(Wall, wall.id).version == 2
