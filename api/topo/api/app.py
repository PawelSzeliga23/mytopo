from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from topo.api import map as map_api
from topo.api.errors import install_error_handlers
from topo.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Topo API")
    install_error_handlers(app)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(map_api.router, prefix="/api/map")
    app.mount(settings.media_url, StaticFiles(directory=settings.media_root, check_dir=False), name="media")
    return app
