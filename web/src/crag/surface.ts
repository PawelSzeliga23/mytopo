import { decode } from "fast-png";

/** A single-channel image with values in 0–1 (depth: brighter = nearer). */
export interface Raster {
  width: number;
  height: number;
  data: Float32Array;
}

/** Segmentation classes from `segments.png` (see api/topo/depth.py). */
export const ROCK = 3;
export const GROUND = 4;
/** Grid cells along the longer side of the photo. */
export const GRID_LONG_SIDE = 384;
/** Model size along the longer side, in scene units. */
export const MODEL_LONG_SIDE = 1.6;

/** Channel 0 of a PNG, scaled to 0–1 (16-bit depth keeps its precision — a canvas would cut it to 8 bits). */
export function decodeDepth(buffer: ArrayBuffer): Raster {
  const png = decode(buffer);
  const max = png.depth === 16 ? 65535 : 255;
  const data = new Float32Array(png.width * png.height);
  for (let i = 0; i < data.length; i++) data[i] = png.data[i * png.channels] / max;
  return { width: png.width, height: png.height, data };
}

/** Class per pixel of a `width`×`height` raster (nearest pixel when the PNG has another size). */
export function decodeClasses(buffer: ArrayBuffer, width: number, height: number): Uint8Array {
  const png = decode(buffer);
  const classes = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(png.height - 1, Math.round((y / Math.max(1, height - 1)) * (png.height - 1)));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(png.width - 1, Math.round((x / Math.max(1, width - 1)) * (png.width - 1)));
      classes[y * width + x] = png.data[(sy * png.width + sx) * png.channels];
    }
  }
  return classes;
}

export function gridSize(width: number, height: number): { gx: number; gy: number } {
  return width >= height
    ? { gx: GRID_LONG_SIDE, gy: Math.max(1, Math.round((GRID_LONG_SIDE * height) / width)) }
    : { gx: Math.max(1, Math.round((GRID_LONG_SIDE * width) / height)), gy: GRID_LONG_SIDE };
}

export function modelSize(width: number, height: number): { width: number; height: number } {
  return width >= height
    ? { width: MODEL_LONG_SIDE, height: (MODEL_LONG_SIDE * height) / width }
    : { width: (MODEL_LONG_SIDE * width) / height, height: MODEL_LONG_SIDE };
}

export interface Surface {
  gx: number;
  gy: number;
  /** Model size in scene units. */
  width: number;
  height: number;
  /** Per grid node ((gx+1)·(gy+1), row by row from the top): depth 0–1 and class. */
  depth: Float32Array;
  cls: Float32Array;
  /** Per node: x, y in scene units (centre of the model at 0, 0; y up). */
  positionsXY: Float32Array;
  uvs: Float32Array;
  /** Triangles whose three nodes are rock or ground; without classes, the full grid. */
  index: Uint32Array;
}

export function buildSurface(depth: Raster, classes: Uint8Array | null): Surface {
  const { gx, gy } = gridSize(depth.width, depth.height);
  const size = modelSize(depth.width, depth.height);
  const nx = gx + 1;
  const count = nx * (gy + 1);
  const nodeDepth = new Float32Array(count);
  const cls = new Float32Array(count);
  const positionsXY = new Float32Array(count * 2);
  const uvs = new Float32Array(count * 2);
  for (let j = 0; j <= gy; j++) {
    for (let i = 0; i <= gx; i++) {
      const k = j * nx + i;
      const u = i / gx;
      const v = j / gy;
      const pixel = Math.round(v * (depth.height - 1)) * depth.width + Math.round(u * (depth.width - 1));
      nodeDepth[k] = depth.data[pixel];
      cls[k] = classes ? classes[pixel] : ROCK;
      positionsXY[2 * k] = (u - 0.5) * size.width;
      positionsXY[2 * k + 1] = (0.5 - v) * size.height;
      uvs[2 * k] = u;
      uvs[2 * k + 1] = 1 - v;
    }
  }
  const solid = (k: number) => cls[k] === ROCK || cls[k] === GROUND;
  const index: number[] = [];
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      if (solid(a) && solid(c) && solid(b)) index.push(a, c, b);
      if (solid(b) && solid(c) && solid(d)) index.push(b, c, d);
    }
  }
  return { gx, gy, ...size, depth: nodeDepth, cls, positionsXY, uvs, index: Uint32Array.from(index) };
}

/** Depth at a photo point (x, y in 0–1): median of the 5×5 nodes around it, so one branch node cannot pull a route forward. */
export function surfaceDepthAt(surface: Surface, x: number, y: number): number {
  const nx = surface.gx + 1;
  const ci = Math.round(Math.min(1, Math.max(0, x)) * surface.gx);
  const cj = Math.round(Math.min(1, Math.max(0, y)) * surface.gy);
  const values: number[] = [];
  for (let dj = -2; dj <= 2; dj++) {
    for (let di = -2; di <= 2; di++) {
      const i = Math.min(surface.gx, Math.max(0, ci + di));
      const j = Math.min(surface.gy, Math.max(0, cj + dj));
      values.push(surface.depth[j * nx + i]);
    }
  }
  values.sort((p, q) => p - q);
  return values[values.length >> 1];
}

/** Scene z of a node or point depth for the given relief (fraction of the model width). */
export function depthToZ(depth: number, surface: Surface, relief: number): number {
  return (depth - 0.5) * relief * surface.width;
}

/**
 * A route as flat [x, y, z, …] lying on the surface, sampled about every `step` grid cells, `liftFraction` of the
 * model width in front of it (lines meant to cover others get a larger lift).
 * Points outside the photo are clamped to its edge; fewer than two points give an empty list.
 */
export function linePoints3D(
  points: { x: number; y: number }[],
  surface: Surface,
  relief: number,
  step = 2,
  liftFraction = 0.004,
): number[] {
  if (points.length < 2) return [];
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const lift = liftFraction * surface.width;
  const flat: number[] = [];
  const push = (x: number, y: number) =>
    flat.push((x - 0.5) * surface.width, (0.5 - y) * surface.height, depthToZ(surfaceDepthAt(surface, x, y), surface, relief) + lift);
  for (let s = 0; s < points.length - 1; s++) {
    const x0 = clamp(points[s].x);
    const y0 = clamp(points[s].y);
    const x1 = clamp(points[s + 1].x);
    const y1 = clamp(points[s + 1].y);
    const steps = Math.max(1, Math.round(Math.hypot((x1 - x0) * surface.gx, (y1 - y0) * surface.gy) / step));
    for (let t = 0; t < steps; t++) push(x0 + ((x1 - x0) * t) / steps, y0 + ((y1 - y0) * t) / steps);
  }
  const last = points[points.length - 1];
  push(clamp(last.x), clamp(last.y));
  return flat;
}

/** Scene position of one photo point on the surface (for bolts and route numbers). */
export function pointOnSurface(point: { x: number; y: number }, surface: Surface, relief: number, lift = 0.006): [number, number, number] {
  const x = Math.min(1, Math.max(0, point.x));
  const y = Math.min(1, Math.max(0, point.y));
  return [(x - 0.5) * surface.width, (0.5 - y) * surface.height, depthToZ(surfaceDepthAt(surface, x, y), surface, relief) + lift * surface.width];
}
