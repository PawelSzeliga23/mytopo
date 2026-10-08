from sqlalchemy.orm import configure_mappers

from topo.models.area import Area
from topo.models.base import Base
from topo.models.crag import Crag
from topo.models.depth_job import DepthJob
from topo.models.route import LinePoint, Route, RouteLine
from topo.models.wall import Wall

configure_mappers()

__all__ = ["Area", "Base", "Crag", "DepthJob", "LinePoint", "Route", "RouteLine", "Wall"]
