import io
import json
from contextlib import contextmanager
from pathlib import Path

from PIL import Image
from sqlalchemy import func, select, text
from sqlalchemy_continuum import version_class

from topo.importer.fetch import FetchError
from topo.importer.portalgorski.parse import BASE_URL, PATHS_URL, START_URL
from topo.importer.portalgorski.run import format_report, import_portalgorski
from topo.models import Area, Crag, Route, RouteLine, Wall

FIXTURES = Path(__file__).parent / "fixtures" / "portalgorski"
ZABI_URL = BASE_URL + "/Żabi-Koń,Grupa-Żabiego-Konia,Dolina-Kobylańska,Jura-Krakowsko-Częstochowska,skala,111"
SZCZYRZYC_URL = BASE_URL + "/Szczyrzyc,Beskidy,skala,955"
SIZES = {"zabi_kon_3": (1600, 1063), "zabi_kon_1": (1063, 1600), "kapliczka": (1600, 1143),
         "szcz_1": (1008, 1600), "szcz_2": (1600, 990), "szcz_3": (996, 1600), "szcz_4": (1600, 1082)}
EMPTY_PATHS = json.dumps({"status": 1, "data": [], "pathsListBottom": ""}).encode()


class FakeFetcher:
    def __init__(self, failing: set[str] = frozenset()):
        self.failing = failing
        self.requests: list[str] = []
        self.forgotten: list[tuple] = []

    def get(self, url):
        self.requests.append(url)
        if url in self.failing:
            raise FetchError(f"HTTP 503: GET {url}")
        if url == START_URL:
            return json.dumps({"results": [
                {"lat": "50.15598612", "lng": "19.75617396", "title": "Żabi Koń", "type": "rock", "url": ZABI_URL[len(BASE_URL):]},
                {"lat": "49.802559", "lng": "20.169329", "title": "Szczyrzyc", "type": "rock", "url": SZCZYRZYC_URL[len(BASE_URL):]},
                {"lat": "50.1", "lng": "19.8", "title": "Zła", "type": "rock", "url": "/Zla,skala,([0-9]+)"},
            ]}).encode()
        if url == ZABI_URL:
            return (FIXTURES / "skala111.html").read_bytes()
        if url == SZCZYRZYC_URL:
            return (FIXTURES / "skala955.html").read_bytes()
        for key, size in SIZES.items():
            if key in url:
                buffer = io.BytesIO()
                Image.new("RGB", size, (80, 80, 80)).save(buffer, "JPEG")
                return buffer.getvalue()
        raise AssertionError(f"nieoczekiwany adres {url}")

    def post(self, url, data):
        assert url == PATHS_URL
        name = {"46": "paths46.json", "2533": "paths2533.json"}.get(data["imageId"])
        return (FIXTURES / name).read_bytes() if name else EMPTY_PATHS

    def forget(self, method, url, data=None):
        self.forgotten.append((method, url, dict(data or {})))


def factory_for(session):
    @contextmanager
    def factory():
        yield session

    return factory


def run(session, tmp_path, fetcher=None, **kw):
    return import_portalgorski(factory_for(session), fetcher or FakeFetcher(), tmp_path, log=lambda _: None, **kw)


def count(session, model):
    return session.scalar(select(func.count()).select_from(model))


def test_import_two_rocks(session, tmp_path):
    report = run(session, tmp_path)

    assert count(session, Crag) == 2
    assert count(session, Area) == 4
    assert count(session, Route) == 10
    assert count(session, RouteLine) == 10
    assert report.invalid_urls == ["/Zla,skala,([0-9]+)"]
    assert report.errors == []
    region = session.scalar(select(Area).where(Area.source_id == "region:100"))
    crag_count = session.scalar(text("SELECT crag_count FROM area_geom WHERE area_id = :id"), {"id": region.id})
    assert crag_count == 1


def test_reimport_is_idempotent(session, tmp_path):
    run(session, tmp_path)
    slugs = sorted(session.scalars(select(Crag.slug)).all())
    route_ids = sorted(session.scalars(select(Route.id)).all())
    versions = count(session, version_class(Route))

    report = run(session, tmp_path)

    assert sorted(session.scalars(select(Crag.slug)).all()) == slugs
    assert sorted(session.scalars(select(Route.id)).all()) == route_ids
    assert count(session, version_class(Route)) == versions
    assert (report.crags_created, report.crags_updated) == (0, 0)


def test_fetch_error_for_one_rock_does_not_stop_import(session, tmp_path):
    report = run(session, tmp_path, FakeFetcher(failing={SZCZYRZYC_URL}))
    assert count(session, Crag) == 1
    assert len(report.errors) == 1 and "Szczyrzyc" in report.errors[0]


def test_only_area_and_limit(session, tmp_path):
    run(session, tmp_path, only_area="Dolina")  # a part of an area name is not enough
    assert count(session, Crag) == 0
    run(session, tmp_path, only_area="Dolina Kobylańska")
    assert session.scalars(select(Crag.name)).all() == ["Żabi Koń"]

    run(session, tmp_path, limit=1)
    assert count(session, Crag) == 1


def test_format_report_is_polish(session, tmp_path):
    text = format_report(run(session, tmp_path))
    assert "Skały: 2 nowych" in text
    assert "Pominięte błędne adresy z listy skał (1)" in text
    assert "Obszary: 4 nowych" in text
    assert "Połączone duplikaty dróg: 0" in text


class PatchedFetcher(FakeFetcher):
    def __init__(self, url, replacement=None, exc=None):
        super().__init__()
        self.url, self.replacement, self.exc = url, replacement, exc

    def get(self, url):
        if url == self.url:
            if self.exc:
                raise self.exc
            if self.replacement is not None:
                return self.replacement
        return super().get(url)


def test_failed_rock_is_rolled_back_in_report(session, tmp_path):
    html = (FIXTURES / "skala955.html").read_bytes().replace("49.80255900000 , 20.16932900000".encode(), b"")
    report = run(session, tmp_path, PatchedFetcher(SZCZYRZYC_URL, html))

    assert report.crags_created == 1
    assert report.routes == 9
    assert len(report.errors) == 1 and "Szczyrzyc" in report.errors[0]
    assert count(session, Crag) == 1


def test_garbage_rock_page_does_not_stop_import(session, tmp_path):
    report = run(session, tmp_path, PatchedFetcher(SZCZYRZYC_URL, b"\x00\x01 nie html"))

    assert count(session, Crag) == 1
    assert any("Szczyrzyc" in error for error in report.errors)


def test_interrupt_keeps_stored_rocks_and_refreshes_geom(session, tmp_path):
    fetcher = PatchedFetcher(SZCZYRZYC_URL, exc=KeyboardInterrupt())
    try:
        run(session, tmp_path, fetcher)
        raise AssertionError("KeyboardInterrupt should propagate")
    except KeyboardInterrupt:
        pass

    assert count(session, Crag) == 1
    region = session.scalar(select(Area).where(Area.source_id == "region:100"))
    crag_count = session.scalar(text("SELECT crag_count FROM area_geom WHERE area_id = :id"), {"id": region.id})
    assert crag_count == 1


def test_empty_selection_is_logged(session, tmp_path):
    messages = []
    import_portalgorski(factory_for(session), FakeFetcher(), tmp_path, only_area="nigdzie", log=messages.append)
    assert "Brak skał pasujących do filtra" in messages


class BrokenTopoFetcher(FakeFetcher):
    def post(self, url, data):
        if data["imageId"] == "46":
            return json.dumps({"status": 0}).encode()
        return super().post(url, data)


def test_failed_topo_keeps_existing_lines_and_is_refetched(session, tmp_path):
    run(session, tmp_path)
    before = sorted(session.execute(
        select(RouteLine.id, RouteLine.source_id).join(Wall).where(Wall.source_id == "46")
    ).all())
    assert len(before) == 9

    fetcher = BrokenTopoFetcher()
    report = run(session, tmp_path, fetcher)

    after = sorted(session.execute(
        select(RouteLine.id, RouteLine.source_id).join(Wall).where(Wall.source_id == "46")
    ).all())
    assert after == before
    assert len(report.errors) == 1 and "topo" in report.errors[0] and "status 0" in report.errors[0]
    assert fetcher.forgotten == [("POST", PATHS_URL, {"imageId": "46", "pathId": "0"})]
