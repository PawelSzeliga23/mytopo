from pathlib import Path

import pytest

from topo.importer.portalgorski.parse import BASE_URL, map_point, parse_paths, parse_rock_page, parse_start

FIXTURES = Path(__file__).parent / "fixtures" / "portalgorski"


def load(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def test_parse_start_lists_rocks_and_invalid_urls():
    start = parse_start(load("start.json"))
    assert len(start.rocks) == 635
    assert len(start.invalid_urls) == 3
    zabi = next(r for r in start.rocks if r.source_id == 111)
    assert zabi.name == "Żabi Koń"
    assert zabi.url == BASE_URL + "/Żabi-Koń,Grupa-Żabiego-Konia,Dolina-Kobylańska,Jura-Krakowsko-Częstochowska,skala,111"
    assert (zabi.lat, zabi.lng) == pytest.approx((50.15598612, 19.75617396))


def test_parse_rock_page_details_and_path():
    page = parse_rock_page(load("skala111.html"))
    assert (page.source_id, page.name) == (111, "Żabi Koń")
    assert [(p.kind, p.source_id, p.name) for p in page.path] == [
        ("obszar", 34, "Jura Krakowsko Częstochowska"),
        ("region", 100, "Dolina Kobylańska"),
        ("sektor", 102, "Grupa Żabiego Konia"),
    ]
    assert (page.lat, page.lng) == pytest.approx((50.15598612, 19.75617396))
    assert page.rock_type == "wapień"
    assert (page.height_min, page.height_max) == (10.0, 40.0)
    assert page.aspects == ["W", "NW"]
    assert page.formations == ["filar", "pion", "połóg", "przewieszenie", "zacięcie"]
    assert page.approach_minutes == 10
    assert page.child_friendly is True
    assert page.surroundings == "Otwarta przestrzeń"
    assert page.description is None


def test_parse_rock_page_walls():
    page = parse_rock_page(load("skala111.html"))
    assert [(w.source_id, w.name) for w in page.walls] == [
        (45, "Mur przy Żabim Koniu"), (46, "Żabi Koń"), (2531, "Kapliczka"),
    ]
    assert page.walls[1].image_url == BASE_URL + "/images/original/100/9ef/a98/9ef8a98_zabi_kon_1_JPG"
    assert page.walls[1].description is None


def test_parse_rock_directly_under_area_with_description():
    page = parse_rock_page(load("skala955.html"))
    assert [(p.kind, p.source_id) for p in page.path] == [("obszar", 737)]
    assert page.rock_type == "piaskowiec"
    assert page.aspects == ["W", "NW", "NE"]
    assert page.approach_minutes == 4
    assert page.description.startswith("Diabli Kamień koło Szczyrzyca to spory, piaskowcowy mur skalny.")
    assert "zarówno" in page.description
    assert "\nSkała znajduje sięna wzgórzu" in page.description
    assert [w.source_id for w in page.walls] == [2533, 2534, 2535, 2536]


def test_parse_paths_lines_and_variant():
    topo = parse_paths(load("paths46.json"))
    assert [line.source_id for line in topo.lines] == [287, 13489, 288, 289, 290, 291, 292, 293, 13490]
    first = topo.lines[0]
    assert (first.order, first.branch_order, first.color, len(first.points)) == (1, 0, "#00BFFF", 11)
    assert (first.points[0].x, first.points[0].y) == (312.0, 711.0)
    assert (first.points[0].kind, first.points[0].visible) == ("start", False)
    assert (first.points[1].kind, first.points[1].visible) == ("ring", True)

    variant = next(line for line in topo.lines if line.source_id == 291)
    assert (variant.order, variant.branch_order) == (5, 1)
    assert (variant.parent_source_id, variant.parent_point_source_id) == (290, 2022)
    assert (variant.points[0].kind, variant.points[0].visible) == ("ring", True)
    assert (variant.points[1].kind, variant.points[1].visible) == ("przelot", False)

    kinds = {p.kind for line in topo.lines for p in line.points}
    assert {"hak", "stanowisko", "ucho"} <= kinds


def test_parse_paths_route_table():
    topo = parse_paths(load("paths46.json"))
    assert len(topo.routes) == 9
    kant = topo.routes[0]
    assert (kant.source_id, kant.name, kant.protection, kant.grade) == (287, "Lewy kant Żabiego Konia", "9r + ST", "V+")
    assert (kant.first_ascent, kant.year, kant.length_m) == ("R. Malczyk, W. Sas-Nowosielski", 1972, 25.0)
    superdir = next(r for r in topo.routes if r.source_id == 288)
    assert superdir.year is None
    trawers = next(r for r in topo.routes if r.source_id == 291)
    assert (trawers.name, trawers.first_ascent) == ("Górny trawers Żabiego Konia", None)


def test_parse_paths_ogranicznik():
    topo = parse_paths(load("paths2533.json"))
    [line] = topo.lines
    assert line.source_id == 13565
    assert [p.kind for p in line.points] == [
        "start", "przelot", "ring", "ogranicznik", "ring", "ring", "ring", "ring", "ring", "stanowisko",
    ]
    [route] = topo.routes
    assert (route.source_id, route.name, route.grade, route.length_m) == (13565, "Droga krzyżowa", "VI.3+", 11.0)


def test_parse_paths_failed_status_is_empty():
    topo = parse_paths(b'{"status": 0, "message": "brak"}')
    assert topo.lines == [] and topo.routes == []


@pytest.mark.parametrize(
    ("kind_name", "type_id", "index", "expected"),
    [
        ("ring", 1, 0, ("start", False)),
        ("ring", 1, 3, ("przelot", False)),
        (" hak", 2, 3, ("hak", True)),
        ("dwa ringi zjazdowe", 2, 5, ("stanowisko", True)),
        ("stanowisko zjazdowe", 1, 5, ("stanowisko", False)),
        ("spit", 2, 2, ("przelot", True)),
    ],
)
def test_map_point(kind_name, type_id, index, expected):
    assert map_point(kind_name, type_id, index) == expected
