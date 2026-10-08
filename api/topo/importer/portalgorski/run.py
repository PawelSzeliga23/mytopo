"""Portal Górski import: list → rock pages → walls (topo + photo) → database, one transaction per rock."""

import copy
from collections.abc import Callable, Mapping
from contextlib import AbstractContextManager
from dataclasses import fields
from pathlib import Path
from typing import Protocol

from slugify import slugify
from sqlalchemy.orm import Session

from topo.db import refresh_area_geom
from topo.history import set_author
from topo.importer.portalgorski.parse import PATHS_URL, START_URL, parse_paths, parse_rock_page, parse_start
from topo.importer.portalgorski.store import IMPORT_AUTHOR, ImportReport, WallInput, store_rock
from topo.importer.portalgorski.types import RockRef


class Fetcher(Protocol):
    def get(self, url: str) -> bytes: ...

    def post(self, url: str, data: Mapping[str, str]) -> bytes: ...


def import_portalgorski(
    session_factory: Callable[[], AbstractContextManager[Session]],
    fetcher: Fetcher,
    media_root: Path,
    *,
    only_area: str | None = None,
    limit: int | None = None,
    log: Callable[[str], None] = print,
    report: ImportReport | None = None,
) -> ImportReport:
    if report is None:
        report = ImportReport()
    start = parse_start(fetcher.get(START_URL))
    report.invalid_urls.extend(start.invalid_urls)
    rocks = _select(start.rocks, only_area, limit)
    if not rocks:
        log("Brak skał pasujących do filtra")

    try:
        for number, rock in enumerate(rocks, 1):
            log(f"[{number}/{len(rocks)}] {rock.name}")
            try:
                page = parse_rock_page(fetcher.get(rock.url))
            except Exception as exc:  # one broken page must not stop the whole import
                report.errors.append(f"{rock.name}: {exc}")
                continue
            walls = [_fetch_wall(fetcher, rock, ref, report) for ref in page.walls]
            snapshot = copy.deepcopy(report)
            with session_factory() as session:
                set_author(session, IMPORT_AUTHOR)
                try:
                    store_rock(session, media_root, page, walls, report)
                    session.commit()
                except Exception as exc:  # one broken rock must not stop the whole import
                    session.rollback()
                    _restore(report, snapshot)
                    report.errors.append(f"{rock.name}: {exc}")
    finally:
        with session_factory() as session:
            refresh_area_geom(session)
            session.commit()
    return report


def _restore(report: ImportReport, snapshot: ImportReport) -> None:
    for item in fields(report):
        setattr(report, item.name, getattr(snapshot, item.name))


def _select(rocks: list[RockRef], only_area: str | None, limit: int | None) -> list[RockRef]:
    if only_area:
        needle = slugify(only_area)
        rocks = [rock for rock in rocks if needle in slugify(rock.url)]
    return rocks[:limit] if limit is not None else rocks


def _fetch_wall(fetcher: Fetcher, rock: RockRef, ref, report: ImportReport) -> WallInput:
    label = f"{rock.name} / {ref.name or ref.source_id}"
    try:
        topo = parse_paths(fetcher.post(PATHS_URL, {"imageId": str(ref.source_id), "pathId": "0"}))
    except Exception as exc:
        report.errors.append(f"{label}: topo: {exc}")
        topo = parse_paths(b'{"status": 0}')
    image = None
    if ref.image_url:
        try:
            image = fetcher.get(ref.image_url)
        except Exception as exc:
            report.errors.append(f"{label}: zdjęcie: {exc}")
    return WallInput(ref=ref, topo=topo, image=image)


def format_report(report: ImportReport) -> str:
    lines = [
        f"Skały: {report.crags_created} nowych, {report.crags_updated} zaktualizowanych",
        f"Ściany: {report.walls}, drogi: {report.routes}, linie: {report.lines}, punkty: {report.points}",
    ]
    sections = [
        ("Pominięte błędne adresy z listy skał", report.invalid_urls),
        ("Nie nadpisano (ręczne zmiany)", report.skipped_manual),
        ("Nieznane wyceny", report.unknown_grades),
        ("Nieznane typy punktów", report.unknown_point_kinds),
        ("Linie poza zdjęciem lub bez zdjęcia", report.bad_lines),
        ("Błędy", report.errors),
    ]
    for title, items in sections:
        if items:
            lines.append(f"{title} ({len(items)}):")
            lines.extend(f"  - {item}" for item in items)
    return "\n".join(lines)
