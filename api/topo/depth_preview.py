"""Static gallery for judging depth maps: photo with lines, coloured depth, relief shading and a 2.5D viewer."""

import html
from pathlib import Path

import numpy as np
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from topo.depth import load_depth
from topo.importer.preview import render_wall_preview
from topo.models import Wall

PREVIEW_MAX = 900

# Polynomial approximation of Google's Turbo colormap (coefficients for x^0..x^5).
_TURBO = np.array([
    [0.13572138, 4.61539260, -42.66032258, 132.13108234, -152.94239396, 59.28637943],
    [0.09140261, 2.19418839, 4.84296658, -14.18503333, 4.27729857, 2.82956604],
    [0.10667330, 12.64194608, -60.58204836, 110.36276771, -89.90310912, 27.34824973],
])


def colorize(depth: np.ndarray) -> Image.Image:
    x = depth.astype(np.float64) / 65535
    powers = np.stack([x**i for i in range(6)], axis=-1)
    rgb = np.clip(powers @ _TURBO.T, 0, 1)
    return Image.fromarray(np.round(rgb * 255).astype(np.uint8), "RGB")


def hillshade(depth: np.ndarray, relief: float = 0.15) -> Image.Image:
    height = depth.astype(np.float64) / 65535 * relief * depth.shape[1]
    dy, dx = np.gradient(height)
    normal = np.stack([-dx, -dy, np.ones_like(height)], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    light = np.array([-1.0, -1.0, 1.5])
    shade = np.clip(normal @ (light / np.linalg.norm(light)), 0, 1)
    return Image.fromarray(np.round(shade * 255).astype(np.uint8), "L")


def ready_walls(session: Session, crag_limit: int | None = None) -> list[Wall]:
    stmt = select(Wall).where(Wall.depth_status == "ready").order_by(Wall.crag_id, Wall.sort_order, Wall.id)
    if crag_limit is not None:
        first = (
            select(Wall.crag_id).where(Wall.depth_status == "ready")
            .group_by(Wall.crag_id).order_by(Wall.crag_id).limit(crag_limit)
        )
        stmt = stmt.where(Wall.crag_id.in_(first))
    return list(session.scalars(stmt))


def _small(image: Image.Image) -> Image.Image:
    image = image.copy()
    image.thumbnail((PREVIEW_MAX, PREVIEW_MAX))
    return image


def write_gallery(walls: list[Wall], media_root: Path, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    sections = []
    for wall in walls:
        depth = load_depth(Path(media_root) / wall.depth_path)
        _small(render_wall_preview(wall, media_root)).save(out_dir / f"{wall.id}-linie.jpg", quality=85)
        colorize(depth).save(out_dir / f"{wall.id}-glebia.jpg", quality=85)
        hillshade(depth).save(out_dir / f"{wall.id}-cien.jpg", quality=85)
        Image.fromarray((depth >> 8).astype(np.uint8), "L").save(out_dir / f"{wall.id}-szara.png")
        with Image.open(Path(media_root) / wall.image_path) as photo:
            photo.convert("RGB").save(out_dir / f"{wall.id}-zdjecie.jpg", quality=88)
        title = html.escape(f"{wall.crag.name} — {wall.name or 'ściana'}")
        view = html.escape(f"view.html?id={wall.id}&w={depth.shape[1]}&h={depth.shape[0]}")
        images = "".join(
            f'<a href="{wall.id}-{name}.jpg"><img src="{wall.id}-{name}.jpg" alt="{label}" loading="lazy"></a>'
            for name, label in (("linie", "zdjęcie z liniami"), ("glebia", "głębia"), ("cien", "cieniowanie"))
        )
        sections.append(
            f'<section><h2>{title} <small>#{wall.id} · {html.escape(wall.depth_model or "")}</small> '
            f'<a href="{view}">podgląd 2.5D</a></h2><div class="row">{images}</div></section>'
        )
    index = out_dir / "index.html"
    index.write_text(
        _INDEX.replace("{count}", str(len(walls))).replace("{sections}", "\n".join(sections)), encoding="utf-8"
    )
    (out_dir / "view.html").write_text(_VIEW, encoding="utf-8")
    return index


_INDEX = """<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mapy głębi</title>
<style>
body{margin:0 auto;max-width:1500px;padding:16px;font:14px system-ui,sans-serif;background:#f4ecdd;color:#2b2420}
h1{font-size:20px}h2{font-size:15px;margin:24px 0 6px}small{color:#7a6e62;font-weight:400}
.row{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.row img{width:100%;display:block}
a{color:#2f4fa0}
</style></head><body>
<h1>Mapy głębi — {count} ścian</h1>
<p>Kolumny: zdjęcie z liniami · głębia (czerwone = blisko, granatowe = daleko) · cieniowanie rzeźby (światło z lewej góry).
Podgląd 2.5D wymaga serwera: <code>npx --yes serve cache/glebia</code>.</p>
{sections}
</body></html>
"""

_VIEW = """<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Podgląd 2.5D</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#1d1916;color:#ede3d2;font:14px system-ui,sans-serif}
#ui{position:fixed;top:8px;left:8px;background:#0009;padding:8px 10px;border-radius:8px}a{color:#8ccbe6}</style>
</head><body>
<div id="ui"><a href="index.html">← galeria</a> · głębia <input id="scale" type="range" min="0" max="0.6" step="0.01" value="0.25">
· <label><input id="wire" type="checkbox"> siatka</label></div>
<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.170.0/build/three.module.js",
"three/addons/":"https://unpkg.com/three@0.170.0/examples/jsm/"}}</script>
<script type="module">
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const params = new URLSearchParams(location.search);
const id = params.get("id");
const aspect = Number(params.get("w")) / Number(params.get("h"));
const width = aspect >= 1 ? 1.6 : 1.6 * aspect;
const height = width / aspect;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 100);
camera.position.set(0, 0, 2.6);

const loader = new THREE.TextureLoader();
const photo = loader.load(`${id}-zdjecie.jpg`);
photo.colorSpace = THREE.SRGBColorSpace;
const depth = loader.load(`${id}-szara.png`);
const material = new THREE.MeshStandardMaterial({
  color: 0x000000, emissive: 0xffffff, emissiveMap: photo, displacementMap: depth,
});
const segmentsX = aspect >= 1 ? 384 : Math.round(384 * aspect);
const segmentsY = aspect >= 1 ? Math.round(384 / aspect) : 384;
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(width, height, segmentsX, segmentsY), material));

const scaleInput = document.getElementById("scale");
function applyScale() {
  material.displacementScale = Number(scaleInput.value) * width;
  material.displacementBias = -material.displacementScale / 2;
}
scaleInput.addEventListener("input", applyScale);
applyScale();
document.getElementById("wire").addEventListener("change", (e) => { material.wireframe = e.target.checked; });

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minAzimuthAngle = -Math.PI / 6;
controls.maxAzimuthAngle = Math.PI / 6;
controls.minPolarAngle = Math.PI / 2 - Math.PI / 9;
controls.maxPolarAngle = Math.PI / 2 + Math.PI / 9;
controls.minDistance = 0.8;
controls.maxDistance = 5;

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
</script></body></html>
"""
