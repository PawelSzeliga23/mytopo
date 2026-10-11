from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://topo:topo@db:5432/topo"
    test_database_url: str = "postgresql+psycopg://topo:topo@db:5432/topo_test"
    public_url: str = "http://localhost:5173"
    media_url: str = "/media"
    media_root: str = "/data/media"
    cache_dir: str = "/data/cache"
    edit_password: str | None = None
    secret_key: str | None = None
    # /docs and /openapi.json; off in production.
    api_docs: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
