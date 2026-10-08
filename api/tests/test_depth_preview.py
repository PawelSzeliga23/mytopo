import json

import numpy as np
from PIL import Image

from tests import factories as f
from topo.depth import load_depth, save_depth_png
from topo.depth_preview import colorize, hillshade, ready_walls, write_gallery


def test_colorize_far_is_blue_near_is_red():
    depth = np.array([[6554, 58982]], dtype=np.uint16)  # 0.1 and 0.9 — the very ends of turbo are dark
    image = colorize(depth)
    assert image.mode == "RGB" and image.size == (2, 1)
    far, near = image.getpixel((0, 0)), image.getpixel((1, 0))
    assert far[2] > far[0]
    assert near[0] > near[2]


def test_hillshade_flat_is_uniform_and_slopes_differ():
    flat = hillshade(np.full((20, 20), 30000, dtype=np.uint16))
    assert flat.mode == "L" and np.unique(np.asarray(flat)).size == 1
    ramp = np.tile(np.linspace(0, 65535, 40, dtype=np.float64), (40, 1))
    rising = hillshade(ramp.astype(np.uint16))                 # nearer to the right: faces left, towards the light
    falling = hillshade(ramp[:, ::-1].astype(np.uint16))       # faces right, away from the light
    assert np.asarray(rising)[20, 20] > np.asarray(falling)[20, 20]


def _ready_wall(session, media_root, crag_name="Skała <Test>"):
    wall = f.wall(session, f.crag(session, f.area(session, f"R {crag_name}"), crag_name), name="Płn.")
    folder = media_root / "walls" / str(wall.id)
    folder.mkdir(parents=True)
    Image.new("RGB", (160, 120), (90, 90, 90)).save(folder / "display.webp")
    save_depth_png(folder / "depth.png", np.tile(np.linspace(0, 65535, 160, dtype=np.uint16), (120, 1)))
    wall.image_path, wall.depth_path = f"walls/{wall.id}/display.webp", f"walls/{wall.id}/depth.png"
    wall.depth_status, wall.depth_model, wall.image_width, wall.image_height = "ready", "fake", 160, 120
    f.line(session, wall)
    session.flush()
    return wall


def test_ready_walls_only_ready(session, tmp_path):
    wall = _ready_wall(session, tmp_path)
    f.wall(session, wall.crag, name="Bez głębi", image_path="x.webp")
    assert ready_walls(session) == [wall]


def test_write_gallery_creates_files_and_escaped_index(session, tmp_path):
    wall = _ready_wall(session, tmp_path / "media")
    index = write_gallery([wall], tmp_path / "media", tmp_path / "out")
    out = tmp_path / "out"
    for suffix in ("linie.jpg", "glebia.jpg", "cien.jpg", "zdjecie.jpg", "glebia16.png", "linie.json"):
        assert (out / f"{wall.id}-{suffix}").exists(), suffix
    assert (out / "view.html").exists()
    html = index.read_text(encoding="utf-8")
    assert "Skała &lt;Test&gt;" in html
    assert f"view.html#id={wall.id}&amp;w=160&amp;h=120" in html
    with Image.open(out / f"{wall.id}-glebia16.png") as packed:
        rgb = np.asarray(packed).astype(np.uint16)
    assert rgb.shape == (120, 160, 3)
    np.testing.assert_array_equal(rgb[..., 0] * 256 + rgb[..., 1], load_depth(tmp_path / "media" / wall.depth_path))
    lines = json.loads((out / f"{wall.id}-linie.json").read_text(encoding="utf-8"))
    assert lines == [{
        "color": wall.lines[0].color,
        "points": [[0.5, 0.9, "start", False], [0.5, 0.5, "ring", True], [0.5, 0.1, "stanowisko", True]],
    }]


def test_gallery_shows_segments_and_verdict_sorted_by_overgrowth(session, tmp_path):
    media = tmp_path / "media"
    clean = _ready_wall(session, media, crag_name="Czysta")
    overgrown = _ready_wall(session, media, crag_name="Zarośnięta")
    clean.vegetation_ratio, overgrown.vegetation_ratio = 0.05, 0.4
    Image.fromarray(np.full((120, 160), 3, dtype=np.uint8)).save(media / "walls" / str(overgrown.id) / "segments.png")
    session.flush()
    html = write_gallery([clean, overgrown], media, tmp_path / "out").read_text(encoding="utf-8")
    assert html.index("Zarośnięta") < html.index("Czysta")
    assert "roślinność na skale 40%" in html and "tylko 2D" in html and "2.5D</b>" in html
    assert (tmp_path / "out" / f"{overgrown.id}-klasy.jpg").exists()
    assert (tmp_path / "out" / f"{overgrown.id}-klasy.png").exists()
    assert not (tmp_path / "out" / f"{clean.id}-klasy.jpg").exists()
