from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from topo.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Topo API")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.mount(settings.media_url, StaticFiles(directory=settings.media_root, check_dir=False), name="media")
    return app
