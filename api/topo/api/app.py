from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from topo.api import areas as areas_api
from topo.api import auth as auth_api
from topo.api import changes as changes_api
from topo.api import crags as crags_api
from topo.api import map as map_api
from topo.api import routes as routes_api
from topo.api import search as search_api
from topo.api import walls as walls_api
from topo.api.errors import install_error_handlers
from topo.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    if settings.edit_password and not settings.secret_key:
        raise RuntimeError("SECRET_KEY jest wymagany, gdy ustawiono EDIT_PASSWORD")
    docs = settings.api_docs
    app = FastAPI(title="Topo API", docs_url="/docs" if docs else None, redoc_url=None, openapi_url="/openapi.json" if docs else None)
    install_error_handlers(app)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth_api.router, prefix="/api/auth")
    app.include_router(changes_api.router, prefix="/api/changes")
    app.include_router(map_api.router, prefix="/api/map")
    app.include_router(areas_api.router, prefix="/api/areas")
    app.include_router(crags_api.router, prefix="/api/crags")
    app.include_router(routes_api.router, prefix="/api/routes")
    app.include_router(walls_api.router, prefix="/api/walls")
    app.include_router(search_api.router, prefix="/api/search")
    app.mount(settings.media_url, StaticFiles(directory=settings.media_root, check_dir=False), name="media")
    return app
