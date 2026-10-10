import { encode } from "fast-png";
import { GROUND, gridSize, isSolid, ROCK, type Raster } from "@/crag/surface";

/** Class "other" (see api/topo/depth.py): not drawn, which is what the eraser does. */
export const OTHER = 0;

/**
 * The 2.5D model being edited: per grid node (the nodes of the 2.5D view, row by row from the top) its depth 0–1 and
 * class, next to the worker's original ones (for "restore"); the raster size is what saving bakes back to.
 */
export interface ModelGrid {
  gx: number;
  gy: number;
  depth: Float32Array;
  cls: Float32Array;
  origDepth: Float32Array;
  origCls: Float32Array;
  rasterWidth: number;
  rasterHeight: number;
}

/** The nodes one step changed, with their values before and after: undo and redo without copying the model. */
export interface Patch {
  nodes: Uint32Array;
  beforeDepth: Float32Array;
  beforeCls: Float32Array;
  afterDepth: Float32Array;
  afterCls: Float32Array;
}

export type Brush = "flatten" | "erase" | "restore" | "rock" | "ground";

function sample(raster: Raster, classes: Uint8Array | null, gx: number, gy: number) {
  const nx = gx + 1;
  const depth = new Float32Array(nx * (gy + 1));
  const cls = new Float32Array(depth.length);
  for (let j = 0; j <= gy; j++) {
    for (let i = 0; i <= gx; i++) {
      // The same pixel buildSurface takes for this node.
      const pixel = Math.round((j / gy) * (raster.height - 1)) * raster.width + Math.round((i / gx) * (raster.width - 1));
      depth[j * nx + i] = raster.data[pixel];
      cls[j * nx + i] = classes ? classes[pixel] : ROCK;
    }
  }
  return { depth, cls };
}

export function gridFromRasters(current: Raster, currentCls: Uint8Array | null, original: Raster, originalCls: Uint8Array | null): ModelGrid {
  const { gx, gy } = gridSize(current.width, current.height);
  const now = sample(current, currentCls, gx, gy);
  const before = sample(original, originalCls, gx, gy);
  return { gx, gy, depth: now.depth, cls: now.cls, origDepth: before.depth, origCls: before.cls, rasterWidth: current.width, rasterHeight: current.height };
}

/** Nodes within `radius` (in grid cells) of node (ci, cj), clipped to the grid. */
export function brushNodes(grid: ModelGrid, ci: number, cj: number, radius: number): number[] {
  const nodes: number[] = [];
  for (let dj = -radius; dj <= radius; dj++) {
    for (let di = -radius; di <= radius; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (i >= 0 && i <= grid.gx && j >= 0 && j <= grid.gy && di * di + dj * dj <= radius * radius) nodes.push(j * (grid.gx + 1) + i);
    }
  }
  return nodes;
}

function median(values: number[]): number {
  values.sort((p, q) => p - q);
  return values[values.length >> 1];
}

/** Collects what a step changes: values from before the first touch of each node. */
class Recorder {
  private readonly before = new Map<number, [number, number]>();
  constructor(private readonly grid: ModelGrid) {}

  set(k: number, depth: number, cls: number) {
    if (!this.before.has(k)) this.before.set(k, [this.grid.depth[k], this.grid.cls[k]]);
    this.grid.depth[k] = depth;
    this.grid.cls[k] = cls;
  }

  finish(): Patch | null {
    const changed = [...this.before].filter(([k, [depth, cls]]) => this.grid.depth[k] !== depth || this.grid.cls[k] !== cls);
    if (changed.length === 0) return null;
    const patch: Patch = {
      nodes: Uint32Array.from(changed, ([k]) => k),
      beforeDepth: Float32Array.from(changed, ([, [depth]]) => depth),
      beforeCls: Float32Array.from(changed, ([, [, cls]]) => cls),
      afterDepth: new Float32Array(changed.length),
      afterCls: new Float32Array(changed.length),
    };
    changed.forEach(([k], index) => {
      patch.afterDepth[index] = this.grid.depth[k];
      patch.afterCls[index] = this.grid.cls[k];
    });
    return patch;
  }
}

/** One drag of a brush: every dab changes the grid at once, `finish` gives the whole drag as one undo step. */
export class Stroke {
  private readonly recorder: Recorder;
  constructor(private readonly grid: ModelGrid) {
    this.recorder = new Recorder(grid);
  }

  apply(brush: Brush, ci: number, cj: number, radius: number) {
    const { grid } = this;
    const nodes = brushNodes(grid, ci, cj, radius);
    if (brush === "flatten") {
      // The brushed nodes take the median depth of the ring around them (rock and ground only).
      const ring = brushNodes(grid, ci, cj, radius * 2).filter((k) => {
        const di = (k % (grid.gx + 1)) - ci;
        const dj = Math.floor(k / (grid.gx + 1)) - cj;
        return di * di + dj * dj > radius * radius && isSolid(grid.cls[k]);
      });
      if (ring.length === 0) return;
      const level = median(ring.map((k) => grid.depth[k]));
      for (const k of nodes) this.recorder.set(k, level, grid.cls[k]);
    } else if (brush === "restore") {
      for (const k of nodes) this.recorder.set(k, grid.origDepth[k], grid.origCls[k]);
    } else {
      const cls = brush === "erase" ? OTHER : brush === "rock" ? ROCK : GROUND;
      for (const k of nodes) this.recorder.set(k, grid.depth[k], cls);
    }
  }

  finish(): Patch | null {
    return this.recorder.finish();
  }
}

/** Median of the 3×3 rock and ground nodes around each rock or ground node: smooths out spikes and noise. */
export function smooth(grid: ModelGrid): Patch | null {
  const nx = grid.gx + 1;
  const source = Float32Array.from(grid.depth);
  const recorder = new Recorder(grid);
  for (let j = 0; j <= grid.gy; j++) {
    for (let i = 0; i <= grid.gx; i++) {
      const k = j * nx + i;
      if (!isSolid(grid.cls[k])) continue;
      const values: number[] = [];
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii >= 0 && ii <= grid.gx && jj >= 0 && jj <= grid.gy && isSolid(grid.cls[jj * nx + ii])) values.push(source[jj * nx + ii]);
        }
      }
      recorder.set(k, median(values), grid.cls[k]);
    }
  }
  return recorder.finish();
}

/** Rock and ground nodes next to removed ones become "other": trims a frayed edge by one node. */
export function trimEdge(grid: ModelGrid): Patch | null {
  const nx = grid.gx + 1;
  const solid = Uint8Array.from(grid.cls, (cls) => (isSolid(cls) ? 1 : 0));
  const recorder = new Recorder(grid);
  for (let j = 0; j <= grid.gy; j++) {
    for (let i = 0; i <= grid.gx; i++) {
      const k = j * nx + i;
      if (!solid[k]) continue;
      const edge = (i > 0 && !solid[k - 1]) || (i < grid.gx && !solid[k + 1]) || (j > 0 && !solid[k - nx]) || (j < grid.gy && !solid[k + nx]);
      if (edge) recorder.set(k, grid.depth[k], OTHER);
    }
  }
  return recorder.finish();
}

export function applyPatch(grid: ModelGrid, patch: Patch, direction: "undo" | "redo") {
  const depth = direction === "undo" ? patch.beforeDepth : patch.afterDepth;
  const cls = direction === "undo" ? patch.beforeCls : patch.afterCls;
  patch.nodes.forEach((k, index) => {
    grid.depth[k] = depth[index];
    grid.cls[k] = cls[index];
  });
}

/** Rasters of the original size where every pixel takes its nearest node: the view samples exactly those nodes back. */
export function bake(grid: ModelGrid): { width: number; height: number; depth: Uint16Array; cls: Uint8Array } {
  const width = grid.rasterWidth;
  const height = grid.rasterHeight;
  const nx = grid.gx + 1;
  const depth = new Uint16Array(width * height);
  const cls = new Uint8Array(width * height);
  const column = Int32Array.from({ length: width }, (_, x) => Math.round((x / Math.max(1, width - 1)) * grid.gx));
  for (let y = 0; y < height; y++) {
    const row = Math.round((y / Math.max(1, height - 1)) * grid.gy) * nx;
    for (let x = 0; x < width; x++) {
      const k = row + column[x];
      depth[y * width + x] = Math.round(Math.min(1, Math.max(0, grid.depth[k])) * 65535);
      cls[y * width + x] = grid.cls[k];
    }
  }
  return { width, height, depth, cls };
}

export function encodeModel(grid: ModelGrid): { depth: Blob; segments: Blob } {
  const baked = bake(grid);
  const png = (data: Uint16Array | Uint8Array, bits: 8 | 16) =>
    new Blob([new Uint8Array(encode({ width: baked.width, height: baked.height, data, depth: bits, channels: 1 }))], { type: "image/png" });
  return { depth: png(baked.depth, 16), segments: png(baked.cls, 8) };
}
