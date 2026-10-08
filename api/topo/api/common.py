from topo.config import get_settings
from topo.models import Area
from topo.schemas import AreaRef


def media_url(path: str | None) -> str | None:
    if not path:
        return None
    return f"{get_settings().media_url.rstrip('/')}/{path}"


def area_path(area: Area | None) -> list[AreaRef]:
    """Breadcrumbs from the top-level area down to (and including) `area`."""
    chain: list[AreaRef] = []
    while area is not None:
        chain.append(AreaRef(id=area.id, name=area.name, slug=area.slug, kind=area.kind))
        area = area.parent
    return list(reversed(chain))
