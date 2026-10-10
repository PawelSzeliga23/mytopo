from pathlib import Path

import numpy as np
from PIL import Image
import pytest
from sqlalchemy import func, select
from sqlalchemy_continuum import version_class

from tests import factories as f
from topo.depth import (
    DEPTH_MAX,
    GROUND,
    ROCK,
    SKY,
    VEGETATION,
    compute_depth,
    depth_size,
    load_depth,
    photo_folder,
    normalize_depth,
    process_wall,
    run_depth,
    save_depth_png,
    select_walls,
    vegetation_stats,
    wants_3d,
)
from topo.models import Wall


class FakeEstimator:
    """Depth = brightness of the photo's red channel, at half resolution (like a real model's own size)."""

    name = "fake-model"

    def predict(self, image):
        small = image.resize((image.width // 2, image.height // 2))
        return np.asarray(small, dtype=np.float32)[:, :, 0]


def photo(media_root: Path, wall_id: int, size=(1600, 1200)) -> str:
    relative = f"walls/{wall_id}/display.webp"
    (media_root / "walls" / str(wall_id)).mkdir(parents=True, exist_ok=True)
    gradient = np.tile(np.linspace(0, 255, size[0], dtype=np.uint8), (size[1], 1))
    Image.fromarray(np.stack([gradient] * 3, axis=-1)).save(media_root / relative, "WEBP")
    return relative


def test_depth_size_limits_longer_side_without_upscaling():
    assert depth_size(1600, 1200) == (768, 576)
    assert depth_size(1200, 1600) == (576, 768)
    assert depth_size(640, 480) == (640, 480)
    assert max(depth_size(1600, 7)) == DEPTH_MAX and min(depth_size(1600, 7)) >= 1


def test_normalize_spreads_to_full_range_and_keeps_near_bright():
    raw = np.linspace(0.0, 10.0, 1000, dtype=np.float32).reshape(10, 100)
    depth = normalize_depth(raw)
    assert depth.dtype == np.uint16
    assert depth.min() == 0 and depth.max() == 65535
    assert depth[0, 0] < depth[-1, -1]


def test_normalize_constant_input_gives_zeros():
    depth = normalize_depth(np.full((4, 4), 3.0, dtype=np.float32))
    assert depth.dtype == np.uint16 and not depth.any()


def test_normalize_survives_nan_and_inf():
    raw = np.linspace(0.0, 1.0, 100, dtype=np.float32).reshape(10, 10)
    raw[0, 0], raw[0, 1], raw[0, 2] = np.nan, np.inf, -np.inf
    depth = normalize_depth(raw)
    assert depth.dtype == np.uint16 and depth.max() == 65535


def test_compute_depth_resizes_to_depth_size():
    image = Image.new("RGB", (1600, 1200), (200, 10, 10))
    assert compute_depth(image, FakeEstimator()).shape == (576, 768)


def test_png_roundtrip_keeps_16_bits(tmp_path):
    depth = np.array([[0, 1, 65535], [300, 40000, 7]], dtype=np.uint16)
    save_depth_png(tmp_path / "d.png", depth)
    np.testing.assert_array_equal(load_depth(tmp_path / "d.png"), depth)


def _walls(session, media_root):
    region = f.area(session, "R")
    first, second = f.crag(session, region, "Pierwsza"), f.crag(session, region, "Druga")
    walls = []
    for crag in (first, first, second):
        wall = f.wall(session, crag)
        wall.image_path = photo(media_root, wall.id, size=(64, 48))
        walls.append(wall)
    no_photo = f.wall(session, second)
    session.flush()
    return walls, no_photo


def test_select_skips_ready_and_walls_without_photo(session, tmp_path):
    walls, no_photo = _walls(session, tmp_path)
    walls[0].depth_status = "ready"
    session.flush()
    selected = select_walls(session)
    assert walls[0] not in selected and no_photo not in selected
    assert set(selected) == {walls[1], walls[2]}


def test_select_force_includes_ready(session, tmp_path):
    walls, _ = _walls(session, tmp_path)
    walls[0].depth_status = "ready"
    session.flush()
    assert set(select_walls(session, force=True)) == set(walls)


def test_select_only_model(session, tmp_path):
    walls, _ = _walls(session, tmp_path)
    walls[0].depth_status, walls[0].depth_model = "ready", "depth-anything-v2-small"
    walls[1].depth_status, walls[1].depth_model = "ready", "depth-anything-v2-large"
    session.flush()
    assert select_walls(session, only_model="depth-anything-v2-small") == [walls[0]]


def test_select_crag_limit_takes_first_crags_with_photos(session, tmp_path):
    walls, _ = _walls(session, tmp_path)
    assert select_walls(session, crag_limit=1) == walls[:2]


def test_select_wall_ids(session, tmp_path):
    walls, _ = _walls(session, tmp_path)
    assert select_walls(session, wall_ids=[walls[2].id]) == [walls[2]]


def test_process_wall_writes_png_and_marks_ready(session, tmp_path):
    walls, _ = _walls(session, tmp_path)
    wall = walls[0]
    process_wall(session, wall, tmp_path, FakeEstimator())
    assert (wall.depth_status, wall.depth_model) == ("ready", "fake-model")
    assert wall.depth_path == f"walls/{wall.id}/depth.png"
    depth = load_depth(tmp_path / wall.depth_path)
    assert depth.shape == (48, 64)
    assert depth[:, 0].mean() < depth[:, -1].mean()


def test_process_wall_does_not_create_history_version(session, tmp_path):
    # Factories already wrote versions without an author, so compare counts instead of is_manually_edited.
    walls, _ = _walls(session, tmp_path)
    versions = version_class(Wall)

    def count():
        return session.scalar(select(func.count()).select_from(versions).where(versions.id == walls[0].id))

    before = count()
    process_wall(session, walls[0], tmp_path, FakeEstimator())
    assert count() == before


def test_run_marks_broken_wall_failed_and_continues(session, tmp_path):
    walls, _ = _walls(session, tmp_path)
    (tmp_path / walls[1].image_path).write_bytes(b"to nie jest obraz")
    lines = []
    report = run_depth(session, walls, tmp_path, FakeEstimator(), log=lines.append)
    assert report.done == 2 and len(report.failed) == 1
    assert f"#{walls[1].id}" in report.failed[0]
    assert [w.depth_status for w in walls] == ["ready", "failed", "ready"]
    assert lines[0].startswith("[1/3] Pierwsza")


def test_run_marks_missing_photo_failed(session, tmp_path):
    walls, _ = _walls(session, tmp_path)
    (tmp_path / walls[0].image_path).unlink()
    report = run_depth(session, walls[:1], tmp_path, FakeEstimator(), log=lambda _: None)
    assert report.done == 0 and walls[0].depth_status == "failed"


class FakeSegmenter:
    """Left quarter sky, second quarter vegetation, third rock, right quarter ground (at its own half resolution)."""

    def predict(self, image):
        width, height = image.width // 2, image.height // 2
        classes = np.full((height, width), GROUND, dtype=np.uint8)
        quarter = width // 4
        classes[:, :quarter], classes[:, quarter:2 * quarter], classes[:, 2 * quarter:3 * quarter] = SKY, VEGETATION, ROCK
        return classes


def test_segmentation_error_marks_wall_failed(session, tmp_path):
    walls, _ = _walls(session, tmp_path)

    class BrokenSegmenter:
        def predict(self, image):
            raise RuntimeError("brak pamięci GPU")

    with pytest.raises(RuntimeError):
        process_wall(session, walls[0], tmp_path, FakeEstimator(), BrokenSegmenter())
    assert (walls[0].depth_status, walls[0].vegetation_ratio) == ("failed", None)


def test_vegetation_stats_counts_only_vegetation_over_the_rock():
    classes = np.full((40, 40), ROCK, dtype=np.uint8)
    classes[:5, :] = SKY
    classes[:5, 30:] = VEGETATION     # tree above the rock, in the background
    classes[30:, :] = GROUND
    classes[20:30, :10] = VEGETATION  # bush in front of the base of the rock
    ratio, route_ratio = vegetation_stats(classes, [])
    assert ratio == 100 / 1000
    assert route_ratio is None


def test_vegetation_beside_the_rock_does_not_count_but_routes_through_it_do():
    classes = np.full((40, 40), ROCK, dtype=np.uint8)
    classes[:, :20] = VEGETATION
    ratio, route_ratio = vegetation_stats(classes, [[(0.25, 0.1), (0.25, 0.9)], [(0.8, 0.1), (0.8, 0.9)]])
    assert ratio == 0.0
    assert route_ratio == 0.5


def test_vegetation_stats_without_routes():
    ratio, route_ratio = vegetation_stats(np.full((10, 10), VEGETATION, dtype=np.uint8), [])
    assert (ratio, route_ratio) == (1.0, None)


def test_vegetation_stats_clamps_points_outside_photo():
    _, route_ratio = vegetation_stats(np.full((10, 10), ROCK, dtype=np.uint8), [[(-0.2, 1.3), (1.4, -0.1)]])
    assert route_ratio == 0.0


def test_wants_3d(session):
    wall = Wall(depth_status="ready", vegetation_ratio=0.08, route_vegetation_ratio=0.9)
    assert wants_3d(wall)
    wall.vegetation_ratio = 0.25
    assert not wants_3d(wall)
    wall.depth_enabled = True
    assert wants_3d(wall)
    assert not wants_3d(Wall(depth_status="ready", vegetation_ratio=0.0, depth_enabled=False))
    assert not wants_3d(Wall(depth_status="pending", depth_enabled=True))
    assert wants_3d(Wall(depth_status="ready"))


def test_process_wall_with_segmenter_saves_classes_and_ratios(session, tmp_path):
    walls, _ = _walls(session, tmp_path)
    wall = walls[0]
    f.line(session, wall, points=((0.6, 0.9, "start"), (0.6, 0.1, "stanowisko")))
    process_wall(session, wall, tmp_path, FakeEstimator(), FakeSegmenter())
    with Image.open(tmp_path / "walls" / str(wall.id) / "segments.png") as segments:
        classes = np.asarray(segments)
    assert classes.shape == (48, 64) and set(np.unique(classes)) == {SKY, VEGETATION, ROCK, GROUND}
    assert wall.vegetation_ratio == 0.0  # vegetation beside the rock only
    assert wall.route_vegetation_ratio == 0.0
    assert wall.depth_status == "ready"


def test_process_wall_only_adds_missing_segments(session, tmp_path):
    walls, _ = _walls(session, tmp_path)
    wall = walls[0]
    process_wall(session, wall, tmp_path, FakeEstimator())
    depth_file = tmp_path / wall.depth_path
    depth_file.write_bytes(b"stara")

    class NoDepth(FakeEstimator):
        def predict(self, image):
            raise AssertionError("depth should not be recomputed")

    process_wall(session, wall, tmp_path, NoDepth(), FakeSegmenter())
    assert wall.vegetation_ratio is not None and depth_file.read_bytes() == b"stara"


def test_select_with_segments_picks_ready_walls_without_segmentation(session, tmp_path):
    walls, _ = _walls(session, tmp_path)
    for wall in walls:
        wall.depth_status = "ready"
    walls[0].vegetation_ratio = 0.1
    session.flush()
    assert select_walls(session) == []
    assert select_walls(session, with_segments=True) == walls[1:]


def test_process_wall_writes_next_to_numbered_photo(session, tmp_path):
    crag = f.crag(session, f.area(session, "Dolina"), "Skała")
    wall = f.wall(session, crag)
    (tmp_path / "walls" / str(wall.id) / "2").mkdir(parents=True)
    relative = f"walls/{wall.id}/2/display.webp"
    Image.new("RGB", (64, 48), (90, 90, 90)).save(tmp_path / relative, "WEBP")
    wall.image_path = relative
    session.commit()

    process_wall(session, wall, tmp_path, FakeEstimator(), FakeSegmenter())

    assert wall.depth_path == f"walls/{wall.id}/2/depth.png"
    assert (tmp_path / "walls" / str(wall.id) / "2" / "segments.png").exists()
    assert not (tmp_path / "walls" / str(wall.id) / "depth.png").exists()


def test_photo_folder(session):
    crag = f.crag(session, f.area(session, "Dolina"), "Skała")
    wall = f.wall(session, crag)
    assert photo_folder(wall).as_posix() == f"walls/{wall.id}"
    wall.image_path = f"walls/{wall.id}/3/display.webp"
    assert photo_folder(wall).as_posix() == f"walls/{wall.id}/3"
