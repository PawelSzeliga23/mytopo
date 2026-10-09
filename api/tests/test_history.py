from sqlalchemy import func, select
from sqlalchemy_continuum import version_class

from tests import factories as f
from topo.history import IMPORT_AUTHOR_PREFIX, is_manually_edited, set_author, transaction_class
from topo.models import Area, Crag, LinePoint, Route, RouteLine, Wall


def test_insert_records_version_with_author(session):
    set_author(session, "Paweł", "dodanie obszaru")
    region = f.area(session, "Dolina")

    AreaVersion = version_class(Area)
    [version] = session.scalars(select(AreaVersion).where(AreaVersion.id == region.id)).all()
    assert version.operation_type == 0
    assert version.name == "Dolina"
    tx = session.get(transaction_class(), version.transaction_id)
    assert (tx.author, tx.comment) == ("Paweł", "dodanie obszaru")


def test_update_in_next_transaction_adds_version(session):
    set_author(session, IMPORT_AUTHOR_PREFIX + "portalgorski")
    region = f.area(session, "Dolina")
    session.commit()

    set_author(session, "Ola", "poprawka nazwy")
    region.name = "Dolina Kobylańska"
    session.commit()

    AreaVersion = version_class(Area)
    versions = session.scalars(
        select(AreaVersion).where(AreaVersion.id == region.id).order_by(AreaVersion.transaction_id)
    ).all()
    assert [v.name for v in versions] == ["Dolina", "Dolina Kobylańska"]
    assert [v.operation_type for v in versions] == [0, 1]
    assert session.get(transaction_class(), versions[1].transaction_id).author == "Ola"


def test_is_manually_edited(session):
    set_author(session, IMPORT_AUTHOR_PREFIX + "portalgorski")
    crag = f.crag(session, f.area(session, "Dolina"), "Skała")
    session.commit()
    assert not is_manually_edited(session, Crag, [crag.id])

    set_author(session, "Ola")
    crag.rock_type = "wapień"
    session.commit()
    assert is_manually_edited(session, Crag, [crag.id])
    assert not is_manually_edited(session, Crag, [])


def test_change_without_author_counts_as_manual(session):
    crag = f.crag(session, f.area(session, "Dolina"), "Skała")
    session.commit()
    assert is_manually_edited(session, Crag, [crag.id])


def test_all_content_models_are_versioned(session):
    set_author(session, "Paweł")
    crag = f.crag(session, f.area(session, "Dolina"), "Skała")
    route = f.route(session, crag, "Droga", grade="VI")
    f.line(session, f.wall(session, crag), route=route)

    for model, expected in [(Area, 1), (Crag, 1), (Wall, 1), (Route, 1), (RouteLine, 1), (LinePoint, 3)]:
        version = version_class(model)
        assert session.scalar(select(func.count()).select_from(version)) == expected, model.__name__


def test_orphan_version_counts_as_manual(session):
    set_author(session, IMPORT_AUTHOR_PREFIX + "portalgorski")
    crag = f.crag(session, f.area(session, "Dolina"), "Skała")
    session.commit()
    CragVersion = version_class(Crag)
    # A version whose transaction row is gone (left by a rolled-back SAVEPOINT) must not look like import data.
    session.execute(
        CragVersion.__table__.insert().values(
            id=crag.id, transaction_id=999_999, operation_type=1, area_id=crag.area_id, name="x", slug="x",
            location="SRID=4326;POINT(19.7 50.1)",
        )
    )
    assert is_manually_edited(session, Crag, [crag.id])


def test_reverts_id_is_stored(session):
    set_author(session, "ania", "cofnięcie #5", reverts_id=5)
    f.area(session, "Dolina")
    session.commit()
    tx = session.scalars(select(transaction_class()).order_by(transaction_class().id.desc())).first()
    assert (tx.author, tx.reverts_id) == ("ania", 5)


def test_issued_at_has_timezone(session):
    set_author(session, "ania")
    f.area(session, "Dolina")
    session.commit()
    tx = session.scalars(select(transaction_class()).order_by(transaction_class().id.desc())).first()
    assert tx.issued_at.tzinfo is not None
