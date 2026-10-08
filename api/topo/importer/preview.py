"""Draw a wall's lines and bolts on its photo — a quick visual check of imported topo."""

from pathlib import Path

from PIL import Image, ImageDraw

from topo.models import Wall


def render_wall_preview(wall: Wall, media_root: Path) -> Image.Image:
    image = Image.open(Path(media_root) / wall.image_path).convert("RGB")
    draw = ImageDraw.Draw(image)
    for line in wall.lines:
        xy = [(point.x * image.width, point.y * image.height) for point in line.points]
        if len(xy) > 1:
            draw.line(xy, fill=line.color, width=3)
        for point, (x, y) in zip(line.points, xy):
            if point.visible:
                draw.ellipse((x - 5, y - 5, x + 5, y + 5), outline="yellow", width=2)
    return image
