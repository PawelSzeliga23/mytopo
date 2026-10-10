import { describe, expect, it } from "vitest";
import { buildSurface, decodeClasses, decodeDepth, GROUND, ROCK, type Raster } from "@/crag/surface";
import { applyPatch, bake, brushNodes, encodeModel, gridFromRasters, OTHER, smooth, Stroke, trimEdge, type ModelGrid } from "./grid";

const W = 769;
const H = 577; // a 768-wide depth map: gx = 384, gy = 288

/** Depth = column / width, quantised like a 16-bit PNG; classes rock everywhere. */
function rasters(): { depth: Raster; cls: Uint8Array } {
  const data = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = Math.round((x / W) * 65535) / 65535;
  return { depth: { width: W, height: H, data }, cls: new Uint8Array(W * H).fill(ROCK) };
}

function grid(): ModelGrid {
  const { depth, cls } = rasters();
  return gridFromRasters(depth, cls, depth, cls);
}

const node = (g: ModelGrid, i: number, j: number) => j * (g.gx + 1) + i;

describe("grid", () => {
  it("samples nodes like the 2.5D view", () => {
    const g = grid();
    const { depth, cls } = rasters();
    const surface = buildSurface(depth, cls);
    expect([g.gx, g.gy]).toEqual([surface.gx, surface.gy]);
    expect(g.depth).toEqual(surface.depth);
    expect(g.cls).toEqual(surface.cls);
  });

  it("treats a wall without segmentation as rock", () => {
    const { depth } = rasters();
    const g = gridFromRasters(depth, null, depth, null);
    expect(g.cls.every((c) => c === ROCK)).toBe(true);
  });

  it("keeps the brush inside the grid", () => {
    const g = grid();
    const nodes = brushNodes(g, 0, 0, 3);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every((k) => k >= 0 && k < g.depth.length && k % (g.gx + 1) <= 3)).toBe(true);
    expect(brushNodes(g, g.gx, g.gy, 2).every((k) => k < g.depth.length)).toBe(true);
  });

  it("erases, paints and restores; a stroke is one patch with the values from before its first touch", () => {
    const g = grid();
    const stroke = new Stroke(g);
    stroke.apply("erase", 10, 10, 2);
    stroke.apply("ground", 10, 10, 1);
    const patch = stroke.finish()!;
    expect(g.cls[node(g, 10, 10)]).toBe(GROUND);
    expect(g.cls[node(g, 12, 10)]).toBe(OTHER);
    expect(g.cls[node(g, 13, 10)]).toBe(ROCK);
    const at = patch.nodes.indexOf(node(g, 10, 10));
    expect([patch.beforeCls[at], patch.afterCls[at]]).toEqual([ROCK, GROUND]);

    applyPatch(g, patch, "undo");
    expect(g.cls.every((c) => c === ROCK)).toBe(true);
    applyPatch(g, patch, "redo");
    expect(g.cls[node(g, 12, 10)]).toBe(OTHER);

    const restore = new Stroke(g);
    restore.apply("restore", 10, 10, 5);
    restore.finish();
    expect(g.cls.every((c) => c === ROCK)).toBe(true);
  });

  it("a stroke that changes nothing gives no patch", () => {
    const g = grid();
    const stroke = new Stroke(g);
    stroke.apply("rock", 5, 5, 3);
    expect(stroke.finish()).toBeNull();
  });

  it("flatten sets the brushed nodes to the median of the ring around them", () => {
    const g = grid();
    const stroke = new Stroke(g);
    stroke.apply("flatten", 100, 100, 4);
    stroke.finish();
    const level = g.depth[node(g, 100, 100)];
    expect(g.depth[node(g, 96, 100)]).toBe(level);
    expect(g.depth[node(g, 104, 100)]).toBe(level);
    expect(level).toBeCloseTo(rasters().depth.data[Math.round((100 / g.gx) * (W - 1))], 2);
    expect(g.depth[node(g, 110, 100)]).not.toBe(level);
  });

  it("the smoothing brush evens out a step only under the brush", () => {
    const g = grid();
    const nx = g.gx + 1;
    for (let k = 0; k < g.depth.length; k++) g.depth[k] = k % nx < 100 ? 0.2 : 0.6;
    const stroke = new Stroke(g);
    stroke.apply("smooth", 100, 50, 3);
    const patch = stroke.finish()!;
    expect(g.depth[node(g, 99, 50)]).toBeGreaterThan(0.21);
    expect(g.depth[node(g, 100, 50)]).toBeLessThan(0.59);
    expect(g.depth[node(g, 99, 60)]).toBe(Math.fround(0.2)); // outside the brush
    applyPatch(g, patch, "undo");
    expect(g.depth[node(g, 99, 50)]).toBe(Math.fround(0.2));
  });

  it("smooth removes a single spike", () => {
    const g = grid();
    const k = node(g, 50, 50);
    const flat = g.depth[k];
    g.depth[k] = 1;
    const patch = smooth(g)!;
    expect(g.depth[k]).toBeCloseTo(flat, 2);
    applyPatch(g, patch, "undo");
    expect(g.depth[k]).toBe(1);
  });

  it("trims the edge of the rock", () => {
    const g = grid();
    const stroke = new Stroke(g);
    stroke.apply("erase", 50, 50, 5);
    stroke.finish();
    const patch = trimEdge(g)!;
    expect(g.cls[node(g, 56, 50)]).toBe(OTHER);
    expect(g.cls[node(g, 58, 50)]).toBe(ROCK);
    expect(g.cls[node(g, 0, 0)]).toBe(ROCK); // the photo border is not an edge
    expect(patch.nodes.length).toBeGreaterThan(0);
  });

  it("baked rasters read back by the view give the same nodes", () => {
    const g = grid();
    const stroke = new Stroke(g);
    stroke.apply("erase", 20, 30, 6);
    stroke.apply("flatten", 200, 100, 8);
    stroke.apply("ground", 300, 250, 10);
    stroke.finish();
    smooth(g);
    const baked = bake(g);
    expect([baked.width, baked.height]).toEqual([W, H]);
    const surface = buildSurface({ width: W, height: H, data: Float32Array.from(baked.depth, (v) => v / 65535) }, baked.cls);
    expect(surface.depth).toEqual(g.depth);
    expect(surface.cls).toEqual(g.cls);
  });

  it("encodes 16-bit depth and 8-bit classes as PNG", async () => {
    const g = grid();
    const { depth, segments } = encodeModel(g);
    const decoded = decodeDepth(await depth.arrayBuffer());
    expect([decoded.width, decoded.height]).toEqual([W, H]);
    expect(buildSurface(decoded, decodeClasses(await segments.arrayBuffer(), W, H)).depth).toEqual(g.depth);
  });
});
