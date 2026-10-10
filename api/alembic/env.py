from logging.config import fileConfig

from alembic import context
from geoalchemy2 import alembic_helpers
from sqlalchemy import Engine, create_engine, text

from topo.config import get_settings
from topo.models import Base

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata

# Tables owned by extensions (PostGIS's spatial_ref_sys, tiger geocoder, topology) are visible
# through search_path in the postgis image but are not part of our schema.
EXTENSION_TABLES_SQL = text(
    """
    SELECT c.relname
    FROM pg_class c
    JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
    WHERE c.relkind IN ('r', 'p')
    """
)


def extension_tables(engine: Engine) -> set[str]:
    with engine.connect() as connection:
        return set(connection.execute(EXTENSION_TABLES_SQL).scalars())


def run_migrations_online() -> None:
    url = config.get_main_option("sqlalchemy.url") or get_settings().database_url
    engine = create_engine(url)
    skipped = extension_tables(engine) | {"spatial_ref_sys"}

    def include_object(obj, name, type_, reflected, compare_to):
        if type_ == "table":
            return name not in skipped
        if type_ == "index" and reflected and compare_to is None:
            # Created by migrations 0005 (history queries) and 0009 (search); not declared on the models.
            if name and name.startswith("ix_") and name.endswith(("_version_source", "_name_search")):
                return False
            return obj.table.name not in skipped
        return True

    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=include_object,
            compare_type=True,
            compare_server_default=True,
            process_revision_directives=alembic_helpers.writer,
            render_item=alembic_helpers.render_item,
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


run_migrations_online()
