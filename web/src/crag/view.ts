export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Zoom and pan applied on top of the fitted photo; zoom 1 shows the whole photo. */
export interface View {
  zoom: number;
  x: number;
  y: number;
}

export const MAX_ZOOM = 5;
export const IDENTITY: View = { zoom: 1, x: 0, y: 0 };

/** Scale and offset that fit the whole photo in the container, centred (object-fit: contain). */
export function fitImage(container: Size, image: Size): { scale: number; x: number; y: number } {
  const scale = Math.min(container.width / image.width, container.height / image.height);
  return { scale, x: (container.width - image.width * scale) / 2, y: (container.height - image.height * scale) / 2 };
}

/** Keeps the zoomed content over the container: no panning past its edges, none at zoom 1. */
export function clampView(view: View, container: Size): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom));
  const minX = container.width * (1 - zoom);
  const minY = container.height * (1 - zoom);
  return { zoom, x: Math.min(0, Math.max(minX, view.x)), y: Math.min(0, Math.max(minY, view.y)) };
}

/** Zooms by `factor`, keeping the screen point `at` in place. */
export function zoomAt(view: View, at: Point, factor: number, container: Size): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom * factor));
  const ratio = zoom / view.zoom;
  return clampView({ zoom, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio }, container);
}

export function panBy(view: View, dx: number, dy: number, container: Size): View {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, container);
}

/** Photo-relative point (0–1) → position in the stage, in pixels. */
export function toScreen(point: Point, image: Size, container: Size, view: View): Point {
  const fit = fitImage(container, image);
  return {
    x: view.x + view.zoom * (fit.x + point.x * image.width * fit.scale),
    y: view.y + view.zoom * (fit.y + point.y * image.height * fit.scale),
  };
}
