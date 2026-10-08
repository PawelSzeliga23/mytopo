from datetime import datetime
from pathlib import Path

import typer

from topo.config import get_settings
from topo.db import SessionLocal
from topo.importer.fetch import CachedFetcher, FetchError
from topo.importer.portalgorski.store import ImportReport
from topo.importer.portalgorski.run import format_report, import_portalgorski
from topo.importer.preview import render_wall_preview
from topo.models import Wall

app = typer.Typer(help="Narzędzia projektu Topo", no_args_is_help=True)
import_app = typer.Typer(help="Import danych z zewnętrznych portali", no_args_is_help=True)
app.add_typer(import_app, name="import")


@import_app.command("portalgorski")
def import_portalgorski_command(
    only_area: str | None = typer.Option(None, "--only-area", help="Tylko skały, których adres zawiera ten obszar"),
    limit: int | None = typer.Option(None, "--limit", help="Najwyżej tyle skał"),
    offline: bool = typer.Option(False, "--offline", help="Tylko z cache, bez sieci"),
    delay: float = typer.Option(1.5, "--delay", help="Przerwa między zapytaniami [s]"),
    report_path: Path | None = typer.Option(
        None, "--report",
        help="Plik na raport (domyślnie /data/cache/import-portalgorski-<data>-<godzina>.txt)",
    ),
) -> None:
    """Importuje skały, ściany, zdjęcia i drogi z topo.portalgorski.pl."""
    settings = get_settings()
    if report_path is None:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        report_path = Path(settings.cache_dir) / f"import-portalgorski-{stamp}.txt"
    fetcher = CachedFetcher(Path(settings.cache_dir) / "portalgorski", delay=delay, offline=offline)
    report = ImportReport()
    try:
        import_portalgorski(
            SessionLocal, fetcher, Path(settings.media_root),
            only_area=only_area, limit=limit, log=typer.echo, report=report,
        )
    except KeyboardInterrupt:
        typer.echo("Przerwano — zapisane skały zostają, ponowne uruchomienie dokończy z cache.")
        _finish(report, report_path)
        raise typer.Exit(130)
    except FetchError as exc:
        typer.echo(f"Błąd pobierania: {exc}", err=True)
        report.errors.append(f"Błąd pobierania: {exc}")
        _finish(report, report_path)
        raise typer.Exit(1)
    _finish(report, report_path)


def _finish(report: ImportReport, path: Path) -> None:
    text = format_report(report)
    typer.echo(text)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text + "\n", encoding="utf-8")
    typer.echo(f"Raport zapisano w {path}")


@app.command("draw-wall")
def draw_wall_command(wall_id: int, output: Path) -> None:
    """Zapisuje zdjęcie ściany z narysowanymi liniami i wpinkami (do sprawdzenia importu)."""
    settings = get_settings()
    with SessionLocal() as session:
        wall = session.get(Wall, wall_id)
        if wall is None or wall.image_path is None:
            raise typer.BadParameter("Nie ma takiej ściany albo nie ma zdjęcia")
        render_wall_preview(wall, Path(settings.media_root)).save(output)
    typer.echo(f"Zapisano {output}")
