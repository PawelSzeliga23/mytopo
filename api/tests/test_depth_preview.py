import numpy as np
from PIL import Image

from tests import factories as f
from topo.depth import save_depth_png
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
    wall = f.wall(session, f.crag(session, f.area(session, "R"), crag_name), name="Płn.")
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
    for suffix in ("linie.jpg", "glebia.jpg", "cien.jpg", "zdjecie.jpg", "szara.png"):
        assert (out / f"{wall.id}-{suffix}").exists(), suffix
    assert (out / "view.html").exists()
    html = index.read_text(encoding="utf-8")
    assert "Skała &lt;Test&gt;" in html
    assert f"view.html#id={wall.id}&amp;w=160&amp;h=120" in html
    with Image.open(out / f"{wall.id}-szara.png") as gray:
        assert gray.mode == "L" and gray.size == (160, 120)
