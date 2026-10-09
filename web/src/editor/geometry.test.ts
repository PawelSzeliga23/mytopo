import { describe, expect, it } from "vitest";
import { nearestSegment, toPhoto } from "@/editor/geometry";
import { draftLabels } from "@/editor/labels";
import type { Draft } from "@/editor/types";
import { toScreen } from "@/crag/view";

const image = { width: 1600, height: 1000 };
const container = { width: 800, height: 600 };

describe("toPhoto", () => {
  it("inverts toScreen at several zooms and pans", () => {
    for (const view of [{ zoom: 1, x: 0, y: 0 }, { zoom: 3, x: -500, y: -300 }, { zoom: 2, x: -120, y: -40 }]) {
      for (const point of [{ x: 0, y: 0 }, { x: 0.25, y: 0.8 }, { x: 1, y: 1 }]) {
        const back = toPhoto(toScreen(point, image, container, view), image, container, view);
        expect(back.x).toBeCloseTo(point.x, 9);
        expect(back.y).toBeCloseTo(point.y, 9);
      }
    }
  });
});

describe("nearestSegment", () => {
  const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  it("finds the segment under the pointer", () => {
    expect(nearestSegment(line, { x: 50, y: 4 }, 10)).toEqual({ index: 0, distance: 4 });
    expect(nearestSegment(line, { x: 97, y: 60 }, 10)).toEqual({ index: 1, distance: 3 });
  });
  it("misses when too far", () => {
    expect(nearestSegment(line, { x: 50, y: 40 }, 10)).toBeNull();
  });
});

describe("draftLabels", () => {
  it("numbers lines like the viewer and letters variants", () => {
    const draft: Draft = {
      wallId: 1, baseVersion: 1, newRoutes: [],
      lines: [
        { key: "a", id: 1, route: null, parent: null, points: [] },
        { key: "b", id: 2, route: null, parent: null, points: [] },
        { key: "c", id: 3, route: null, parent: { lineKey: "b", pointKey: "x" }, points: [] },
        { key: "d", id: 4, route: null, parent: { lineKey: "c", pointKey: "y" }, points: [] },
      ],
    };
    expect(Object.fromEntries(draftLabels(draft))).toEqual({ a: "1", b: "2", c: "2a", d: "2b" });
  });
});
