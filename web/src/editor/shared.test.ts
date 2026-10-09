import { describe, expect, it } from "vitest";
import { coincident, isSamePlace, snapTo } from "@/editor/shared";
import type { Draft } from "@/editor/types";

const image = { width: 1600, height: 1000 };
const draft: Draft = {
  wallId: 1,
  baseVersion: 1,
  newRoutes: [],
  lines: [
    {
      key: "l1",
      id: 1,
      route: { routeId: 1 },
      parent: null,
      points: [
        { key: "p1", id: 1, x: 0.1, y: 0.9, kind: "start" },
        { key: "p2", id: 2, x: 0.5, y: 0.2, kind: "stanowisko" },
      ],
    },
    {
      key: "l2",
      id: 2,
      route: { routeId: 2 },
      parent: null,
      points: [
        { key: "p3", id: 3, x: 0.3, y: 0.9, kind: "start" },
        { key: "p4", id: 4, x: 0.5001, y: 0.2001, kind: "stanowisko" },
      ],
    },
  ],
};

describe("shared points", () => {
  it("treats points closer than 0.3% of the longer side as one place", () => {
    expect(isSamePlace({ x: 0.5, y: 0.2 }, { x: 0.5001, y: 0.2001 }, image)).toBe(true);
    expect(isSamePlace({ x: 0.5, y: 0.2 }, { x: 0.504, y: 0.2 }, image)).toBe(false);
  });

  it("finds the shared stanowisko of both lines", () => {
    expect(coincident(draft, image, "l1", "p2")).toEqual([
      { lineKey: "l1", pointKey: "p2" },
      { lineKey: "l2", pointKey: "p4" },
    ]);
    expect(coincident(draft, image, "l1", "p1")).toEqual([{ lineKey: "l1", pointKey: "p1" }]);
  });

  it("snaps a new point onto an existing one", () => {
    expect(snapTo(draft, image, { x: 0.4998, y: 0.1999 })).toEqual({
      x: 0.5,
      y: 0.2,
    });
    expect(snapTo(draft, image, { x: 0.7, y: 0.7 })).toEqual({
      x: 0.7,
      y: 0.7,
    });
  });
});
