from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

from topo.config import get_settings
from topo.models import Base

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def include_object(obj, name, type_, reflected, compare_to):
    # PostGIS's own table is not part of our schema
    return not (type_ == "table" and name == "spatial_ref_sys")


def run_migrations_online() -> None:
    url = config.get_main_option("sqlalchemy.url") or get_settings().database_url
    engine = create_engine(url)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, include_object=include_object)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


run_migrations_online()
