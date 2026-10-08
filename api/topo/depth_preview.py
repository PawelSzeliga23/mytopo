"""Static gallery for judging depth maps: photo with lines, segmentation, coloured depth, relief shading, 2.5D viewer."""

import html
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from topo.depth import GROUND, ROCK, SEGMENTS_FILE, SKY, VEGETATION, VEGETATION_LIMIT, load_depth, wants_3d
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


def _depth_rgb(depth: np.ndarray) -> Image.Image:
    """16-bit depth packed losslessly into an 8-bit PNG (R = high byte, G = low byte) — canvas reads only 8 bits."""
    rgb = np.zeros((*depth.shape, 3), dtype=np.uint8)
    rgb[..., 0], rgb[..., 1] = depth >> 8, depth & 0xFF
    return Image.fromarray(rgb, "RGB")


def _lines(wall: Wall) -> list[dict]:
    return [
        {"color": line.color, "points": [[p.x, p.y, p.kind, p.visible] for p in line.points]}
        for line in wall.lines
    ]


SEGMENT_COLORS = {ROCK: (120, 180, 235), GROUND: (150, 150, 150), VEGETATION: (40, 200, 60), SKY: (255, 255, 255)}


def segments_overlay(photo: Image.Image, classes: np.ndarray) -> Image.Image:
    """Photo tinted by class: rock light blue, ground grey, vegetation green, sky white, other untouched."""
    base = np.asarray(photo.convert("RGB").resize((classes.shape[1], classes.shape[0])), dtype=np.float64)
    tint = base.copy()
    for value, color in SEGMENT_COLORS.items():
        tint[classes == value] = color
    return Image.fromarray(np.round(base * 0.45 + tint * 0.55).astype(np.uint8), "RGB")


def _percent(value: float | None) -> str:
    return "—" if value is None else f"{value * 100:.0f}%"


def _overgrowth(wall: Wall) -> float:
    return wall.vegetation_ratio or 0.0


def write_gallery(walls: list[Wall], media_root: Path, out_dir: Path) -> Path:
    """Walls sorted from the most overgrown; each with its 2.5D / 2D-only verdict."""
    out_dir.mkdir(parents=True, exist_ok=True)
    sections = []
    for wall in sorted(walls, key=_overgrowth, reverse=True):
        depth = load_depth(Path(media_root) / wall.depth_path)
        with Image.open(Path(media_root) / wall.image_path) as opened:
            photo = opened.convert("RGB")
        photo.save(out_dir / f"{wall.id}-zdjecie.jpg", quality=88)
        _small(render_wall_preview(wall, media_root)).save(out_dir / f"{wall.id}-linie.jpg", quality=85)
        colorize(depth).save(out_dir / f"{wall.id}-glebia.jpg", quality=85)
        hillshade(depth).save(out_dir / f"{wall.id}-cien.jpg", quality=85)
        _depth_rgb(depth).save(out_dir / f"{wall.id}-glebia16.png")
        (out_dir / f"{wall.id}-linie.json").write_text(json.dumps(_lines(wall)), encoding="utf-8")
        columns = [("linie", "zdjęcie z liniami")]
        segments_path = Path(media_root) / "walls" / str(wall.id) / SEGMENTS_FILE
        if segments_path.exists():
            with Image.open(segments_path) as segments:
                classes = np.asarray(segments)
            segments_overlay(photo, classes).save(out_dir / f"{wall.id}-klasy.jpg", quality=85)
            shutil.copyfile(segments_path, out_dir / f"{wall.id}-klasy.png")
            columns.append(("klasy", "skała, podłoże, roślinność"))
        columns += [("glebia", "głębia"), ("cien", "cieniowanie")]
        title = html.escape(f"{wall.crag.name} — {wall.name or 'ściana'}")
        view = html.escape(f"view.html#id={wall.id}&w={depth.shape[1]}&h={depth.shape[0]}")
        verdict = "2.5D" if wants_3d(wall) else "tylko 2D"
        stats = (
            f"roślinność na skale {_percent(wall.vegetation_ratio)} · "
            f"na drogach {_percent(wall.route_vegetation_ratio)} → <b class=\"v{int(wants_3d(wall))}\">{verdict}</b>"
        )
        images = "".join(
            f'<a href="{wall.id}-{name}.jpg"><img src="{wall.id}-{name}.jpg" alt="{label}" loading="lazy"></a>'
            for name, label in columns
        )
        sections.append(
            f'<section><h2>{title} <small>#{wall.id} · {stats}</small> '
            f'<a href="{view}">podgląd 2.5D</a></h2><div class="row c{len(columns)}">{images}</div></section>'
        )
    index = out_dir / "index.html"
    index.write_text(
        _INDEX.replace("{count}", str(len(walls)))
        .replace("{limit}", _percent(VEGETATION_LIMIT))
        .replace("{sections}", "\n".join(sections)),
        encoding="utf-8",
    )
    shutil.copyfile(Path(__file__).with_name("depth_preview_view.html"), out_dir / "view.html")
    return index


_INDEX = """<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mapy głębi</title>
<style>
body{margin:0 auto;max-width:1500px;padding:16px;font:14px system-ui,sans-serif;background:#f4ecdd;color:#2b2420}
h1{font-size:20px}h2{font-size:15px;margin:24px 0 6px}small{color:#7a6e62;font-weight:400}
.row{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.row.c4{grid-template-columns:repeat(4,1fr)}
.row img{width:100%;display:block}a{color:#2f4fa0}.v0{color:#b23a2b}.v1{color:#2f7a3a}
</style></head><body>
<h1>Mapy głębi — {count} ścian</h1>
<p>Od najbardziej zarośniętych. Kolumny: zdjęcie z liniami · segmentacja (niebieskie = skała, szare = podłoże,
zielone = roślinność, białe = niebo) · głębia (czerwone = blisko) · cieniowanie rzeźby.
Tylko 2D, gdy roślinność zasłania więcej niż {limit} skały (obszar skały: w każdej kolumnie od jej szczytu do podłoża); ręcznie:
<code>topo wall-3d ID on|off|auto</code>. Podgląd 2.5D wymaga serwera: <code>npx --yes serve cache/glebia</code>.</p>
{sections}
</body></html>
"""
