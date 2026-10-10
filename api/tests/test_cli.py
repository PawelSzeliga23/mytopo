from contextlib import nullcontext

import numpy as np
from PIL import Image
from typer.testing import CliRunner

from tests import factories as f
from topo.cli import app
from topo.config import Settings
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


class FakeDepthEstimator:
    name = "depth-anything-v2-large"
    device = "cpu"

    def __init__(self, model="large", device=None):
        pass

    def predict(self, image):
        return np.asarray(image, dtype=np.float32)[:, :, 0]


class FakeSegmenter:
    def __init__(self, device=None):
        pass

    def predict(self, image):
        return np.full((image.height, image.width), 3, dtype=np.uint8)


def _depth_setup(session, tmp_path, monkeypatch, crags=("Pierwsza", "Druga")):
    monkeypatch.setattr("topo.cli.SessionLocal", lambda: nullcontext(session))
    monkeypatch.setattr("topo.cli.get_settings", lambda: Settings(media_root=str(tmp_path), cache_dir=str(tmp_path)))
    monkeypatch.setattr("topo.cli.HFDepthEstimator", FakeDepthEstimator)
    monkeypatch.setattr("topo.cli.HFSegmenter", FakeSegmenter)
    region = f.area(session, "R")
    walls = []
    for name in crags:
        wall = f.wall(session, f.crag(session, region, name))
        (tmp_path / "walls" / str(wall.id)).mkdir(parents=True)
        Image.new("RGB", (40, 30), (wall.id * 20 % 255, 0, 0)).save(tmp_path / "walls" / str(wall.id) / "display.webp")
        wall.image_path = f"walls/{wall.id}/display.webp"
        walls.append(wall)
    session.flush()
    return walls


def test_depth_command_requires_selection():
    result = CliRunner().invoke(app, ["depth"])
    assert result.exit_code != 0
    assert "--all" in result.output


def test_depth_command_rejects_unknown_model():
    result = CliRunner().invoke(app, ["depth", "--all", "--model", "huge"])
    assert result.exit_code != 0
    assert "large" in result.output


def test_depth_command_crags_limit(session, tmp_path, monkeypatch):
    walls = _depth_setup(session, tmp_path, monkeypatch)
    result = CliRunner().invoke(app, ["depth", "--crags", "1"])
    assert result.exit_code == 0, result.output
    assert "Gotowe: 1" in result.output
    assert [w.depth_status for w in walls] == ["ready", "pending"]


def test_depth_command_nothing_to_do(session, tmp_path, monkeypatch):
    walls = _depth_setup(session, tmp_path, monkeypatch)
    for wall in walls:
        wall.depth_status, wall.vegetation_ratio = "ready", 0.0
    session.flush()
    result = CliRunner().invoke(app, ["depth", "--all"])
    assert result.exit_code == 0
    assert "Nic do przeliczenia" in result.output


def test_depth_command_interrupt(session, tmp_path, monkeypatch):
    walls = _depth_setup(session, tmp_path, monkeypatch)
    calls = []

    class Interrupting(FakeDepthEstimator):
        def predict(self, image):
            calls.append(1)
            if len(calls) == 2:
                raise KeyboardInterrupt
            return super().predict(image)

    monkeypatch.setattr("topo.cli.HFDepthEstimator", Interrupting)
    result = CliRunner().invoke(app, ["depth", "--all"])
    assert result.exit_code == 130
    assert "Przerwano" in result.output
    assert walls[0].depth_status == "ready"


def test_cli_help_lists_depth_commands():
    result = CliRunner().invoke(app, ["--help"])
    assert "depth" in result.output and "depth-preview" in result.output


def test_depth_command_also_segments(session, tmp_path, monkeypatch):
    walls = _depth_setup(session, tmp_path, monkeypatch)
    result = CliRunner().invoke(app, ["depth", "--all"])
    assert result.exit_code == 0, result.output
    assert all(w.vegetation_ratio == 0.0 for w in walls)


def test_wall_3d_command(session, tmp_path, monkeypatch):
    walls = _depth_setup(session, tmp_path, monkeypatch)
    wall = walls[0]
    wall.depth_status, wall.vegetation_ratio = "ready", 0.5
    session.flush()
    result = CliRunner().invoke(app, ["wall-3d", str(wall.id), "on"])
    assert result.exit_code == 0, result.output
    assert wall.depth_enabled is True and "2.5D" in result.output
    result = CliRunner().invoke(app, ["wall-3d", str(wall.id), "auto"])
    assert wall.depth_enabled is None and "tylko 2D" in result.output
    assert CliRunner().invoke(app, ["wall-3d", str(wall.id), "maybe"]).exit_code != 0


def test_depth_worker_rejects_unknown_model():
    result = CliRunner().invoke(app, ["depth-worker", "--model", "huge"])
    assert result.exit_code != 0
    assert "large" in result.output
