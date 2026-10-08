from PIL import Image
from typer.testing import CliRunner

from tests import factories as f
from topo.cli import app
from topo.importer.preview import render_wall_preview


def test_cli_help_lists_commands():
    result = CliRunner().invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "import" in result.output and "draw-wall" in result.output


def test_render_wall_preview_draws_line(session, tmp_path):
    (tmp_path / "walls" / "1").mkdir(parents=True)
    Image.new("RGB", (100, 200), (0, 0, 0)).save(tmp_path / "walls" / "1" / "display.webp", "WEBP")
    wall = f.wall(session, f.crag(session, f.area(session, "R"), "C"), image_path="walls/1/display.webp")
    f.line(session, wall, color="#ff0000", points=((0.5, 0.9, "start"), (0.5, 0.1, "stanowisko")))

    image = render_wall_preview(wall, tmp_path)
    assert image.size == (100, 200)
    red, green, blue = image.getpixel((50, 100))
    assert red > 200 and green < 60 and blue < 60


def _fake_import(*args, report, **kwargs):
    report.crags_created = 2
    report.merged_routes = 1
    return report


def test_import_writes_report_file(tmp_path, monkeypatch):
    monkeypatch.setattr("topo.cli.import_portalgorski", _fake_import)
    path = tmp_path / "raport.txt"
    result = CliRunner().invoke(app, ["import", "portalgorski", "--offline", "--report", str(path)])
    assert result.exit_code == 0, result.output
    text = path.read_text(encoding="utf-8")
    assert "Skały: 2 nowych" in text and "Połączone duplikaty dróg: 1" in text
    assert str(path) in result.output


def test_import_writes_report_file_on_interrupt(tmp_path, monkeypatch):
    def interrupted(*args, report, **kwargs):
        report.crags_created = 1
        raise KeyboardInterrupt

    monkeypatch.setattr("topo.cli.import_portalgorski", interrupted)
    path = tmp_path / "raport.txt"
    result = CliRunner().invoke(app, ["import", "portalgorski", "--offline", "--report", str(path)])
    assert result.exit_code == 130
    assert "Skały: 1 nowych" in path.read_text(encoding="utf-8")
