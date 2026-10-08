from geoalchemy2 import WKTElement

from topo.grades import grade_sort
from topo.models import Area, Crag, LinePoint, Route, RouteLine, Wall
from topo.slugs import make_slug

DEFAULT_POINTS = ((0.5, 0.9, "start"), (0.5, 0.5, "ring"), (0.5, 0.1, "stanowisko"))


def area(session, name, kind="region", parent=None, **kw) -> Area:
    kw.setdefault("slug", make_slug(name))
    obj = Area(name=name, kind=kind, parent=parent, **kw)
    session.add(obj)
    session.flush()
    return obj


def crag(session, area, name, lng=19.75, lat=50.15, **kw) -> Crag:
    kw.setdefault("slug", make_slug(name))
    obj = Crag(area=area, name=name, location=WKTElement(f"POINT({lng} {lat})", srid=4326), **kw)
    session.add(obj)
    session.flush()
    return obj


def route(session, crag, name, grade=None, **kw) -> Route:
    obj = Route(crag=crag, name=name, grade=grade, grade_sort=grade_sort(grade), **kw)
    session.add(obj)
    session.flush()
    return obj


def wall(session, crag, name="Ściana", **kw) -> Wall:
    obj = Wall(crag=crag, name=name, **kw)
    session.add(obj)
    session.flush()
    return obj


def line(session, wall, route=None, points=DEFAULT_POINTS, sort_order=0, **kw) -> RouteLine:
    obj = RouteLine(wall=wall, route=route, sort_order=sort_order, **kw)
    obj.points = [
        LinePoint(sort_order=i, x=x, y=y, kind=kind, visible=kind != "start")
        for i, (x, y, kind) in enumerate(points)
    ]
    session.add(obj)
    session.flush()
    return obj
