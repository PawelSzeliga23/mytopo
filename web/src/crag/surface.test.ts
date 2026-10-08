import { encode } from "fast-png";
import { describe, expect, it } from "vitest";
import {
  buildSurface,
  decodeClasses,
  decodeDepth,
  GROUND,
  gridSize,
  linePoints3D,
  modelSize,
  pointOnSurface,
  ROCK,
  surfaceDepthAt,
  type Raster,
} from "@/crag/surface";

function png(width: number, height: number, data: Uint8Array | Uint16Array, depth: 8 | 16): ArrayBuffer {
  const bytes = encode({ width, height, data, depth, channels: 1 });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function raster(width: number, height: number, value = 0.5): Raster {
  return { width, height, data: new Float32Array(width * height).fill(value) };
}

describe("decoding", () => {
  it("keeps 16-bit depth precision", () => {
    const depth = decodeDepth(png(2, 1, Uint16Array.from([0, 65535]), 16));
    expect(depth.width).toBe(2);
    expect(Array.from(depth.data)).toEqual([0, 1]);
  });

  it("reads 8-bit depth too", () => {
    expect(Array.from(decodeDepth(png(2, 1, Uint8Array.from([0, 255]), 8)).data)).toEqual([0, 1]);
  });

  it("resamples classes to the depth size by nearest pixel", () => {
    const classes = decodeClasses(png(2, 1, Uint8Array.from([ROCK, GROUND]), 8), 4, 2);
    expect(Array.from(classes)).toEqual([ROCK, ROCK, GROUND, GROUND, ROCK, ROCK, GROUND, GROUND]);
  });
});

describe("grid and model size", () => {
  it("follows the photo orientation", () => {
    expect(gridSize(768, 512)).toEqual({ gx: 384, gy: 256 });
    expect(gridSize(512, 768)).toEqual({ gx: 256, gy: 384 });
    expect(modelSize(768, 512)).toEqual({ width: 1.6, height: 1.6 * (512 / 768) });
    expect(modelSize(512, 768).height).toBe(1.6);
  });
});

describe("buildSurface", () => {
  it("draws the full grid without classes", () => {
    const surface = buildSurface(raster(768, 512), null);
    expect(surface.index.length).toBe(surface.gx * surface.gy * 2 * 3);
  });

  it("drops triangles touching sky or vegetation", () => {
    const depth = raster(768, 512);
    const classes = new Uint8Array(768 * 512).fill(ROCK);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 384; x++) classes[y * 768 + x] = 2; // left half: sky
    const surface = buildSurface(depth, classes);
    const full = surface.gx * surface.gy * 2 * 3;
    expect(surface.index.length).toBeGreaterThan(full * 0.45);
    expect(surface.index.length).toBeLessThan(full * 0.55);
    for (const k of surface.index) expect(surface.cls[k]).toBe(ROCK);
  });

  it("keeps ground triangles", () => {
    const surface = buildSurface(raster(40, 20), new Uint8Array(800).fill(GROUND));
    expect(surface.index.length).toBe(surface.gx * surface.gy * 6);
  });
});

describe("depth along routes", () => {
  it("ignores a single protruding node (a branch)", () => {
    const surface = buildSurface(raster(768, 512, 0.3), null);
    const nx = surface.gx + 1;
    surface.depth[128 * nx + 192] = 1;
    expect(surfaceDepthAt(surface, 0.5, 0.5)).toBeCloseTo(0.3);
  });

  it("clamps points outside the photo and skips one-point lines", () => {
    const surface = buildSurface(raster(768, 512), null);
    const flat = linePoints3D([{ x: -0.5, y: 1.5 }, { x: 0.5, y: 0.5 }], surface, 0.25);
    expect(flat.length % 3).toBe(0);
    expect(flat[0]).toBeCloseTo(-surface.width / 2);
    expect(flat[1]).toBeCloseTo(-surface.height / 2);
    expect(linePoints3D([{ x: 0.5, y: 0.5 }], surface, 0.25)).toEqual([]);
  });

  it("puts nearer rock further towards the camera", () => {
    const depth = raster(768, 512, 0.2);
    for (let y = 0; y < 512; y++) for (let x = 384; x < 768; x++) depth.data[y * 768 + x] = 0.8;
    const surface = buildSurface(depth, null);
    expect(pointOnSurface({ x: 0.9, y: 0.5 }, surface, 0.25)[2]).toBeGreaterThan(pointOnSurface({ x: 0.1, y: 0.5 }, surface, 0.25)[2]);
  });
});
