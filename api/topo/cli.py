from datetime import datetime
from pathlib import Path

import typer

from topo.config import get_settings
from topo.db import SessionLocal
from topo.depth import MODELS, DepthReport, HFDepthEstimator, model_name, run_depth, select_walls
from topo.depth_preview import ready_walls, write_gallery
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


@app.command("depth")
def depth_command(
    all_walls: bool = typer.Option(False, "--all", help="Wszystkie ściany ze zdjęciem bez gotowej mapy głębi"),
    crags: int | None = typer.Option(None, "--crags", help="Tylko ściany pierwszych N skał (próbnie)"),
    wall_ids: list[int] | None = typer.Option(None, "--wall", help="Tylko ta ściana (można powtórzyć)"),
    model: str = typer.Option("large", "--model", help="large (GPU) albo small (CPU)"),
    only_model: str | None = typer.Option(None, "--only-model", help="Przelicz ściany zrobione tym modelem (large/small)"),
    force: bool = typer.Option(False, "--force", help="Licz od nowa także gotowe"),
) -> None:
    """Liczy mapy głębi zdjęć ścian (Depth Anything V2)."""
    for key in (model, only_model):
        if key is not None and key not in MODELS:
            raise typer.BadParameter(f"Nieznany model {key!r} — dostępne: {', '.join(MODELS)}")
    if not (all_walls or crags or wall_ids or only_model):
        raise typer.BadParameter("Podaj --all, --crags N, --wall ID albo --only-model")
    settings = get_settings()
    with SessionLocal() as session:
        walls = select_walls(
            session, wall_ids=wall_ids or None, crag_limit=crags,
            only_model=model_name(only_model) if only_model else None, force=force,
        )
        if not walls:
            typer.echo("Nic do przeliczenia.")
            return
        typer.echo(f"Ścian do przeliczenia: {len(walls)}. Wczytuję model {model}…")
        estimator = HFDepthEstimator(model)
        typer.echo(f"Model {estimator.name} na {estimator.device}.")
        try:
            report = run_depth(session, walls, Path(settings.media_root), estimator, log=typer.echo)
        except KeyboardInterrupt:
            typer.echo("Przerwano — gotowe mapy głębi zostają, ponowne uruchomienie dokończy resztę.")
            raise typer.Exit(130)
    _print_depth_report(report)


def _print_depth_report(report: DepthReport) -> None:
    typer.echo(f"Gotowe: {report.done}, błędy: {len(report.failed)}")
    for line in report.failed:
        typer.echo(f"  {line}")


@app.command("depth-preview")
def depth_preview_command(
    output: Path = typer.Argument(Path("/data/cache/glebia"), help="Katalog galerii"),
    crags: int | None = typer.Option(None, "--crags", help="Tylko ściany pierwszych N skał z gotową głębią"),
) -> None:
    """Zapisuje galerię map głębi do oceny (zdjęcie z liniami, głębia, cieniowanie, podgląd 2.5D)."""
    settings = get_settings()
    with SessionLocal() as session:
        walls = ready_walls(session, crag_limit=crags)
        if not walls:
            typer.echo("Brak ścian z gotową mapą głębi.")
            return
        index = write_gallery(walls, Path(settings.media_root), output)
    typer.echo(f"Galeria: {len(walls)} ścian, {index}")
