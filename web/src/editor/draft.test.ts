import { afterEach, describe, expect, it, vi } from "vitest";
import { applySaved, clearLocal, countChanges, draftFromWall, draftKey, loadLocal, saveLocal, toSaveBody } from "@/editor/draft";
import type { Draft } from "@/editor/types";
import type { WallOut } from "@/lib/api";

const wall = {
  id: 7,
  version: 4,
  lines: [
    {
      id: 21,
      route_id: 2,
      color: "#0000FF",
      sort_order: 1,
      parent_line_id: 20,
      parent_point_id: 101,
      points: [
        {
          id: 111,
          sort_order: 1,
          x: 0.4,
          y: 0.2,
          kind: "stanowisko",
          visible: true,
        },
        {
          id: 110,
          sort_order: 0,
          x: 0.3,
          y: 0.5,
          kind: "przelot",
          visible: false,
        },
      ],
    },
    {
      id: 20,
      route_id: null,
      color: "#0000FF",
      sort_order: 0,
      parent_line_id: null,
      parent_point_id: null,
      points: [
        {
          id: 100,
          sort_order: 0,
          x: 0.1,
          y: 0.9,
          kind: "start",
          visible: true,
        },
        { id: 101, sort_order: 1, x: 0.3, y: 0.5, kind: "ring", visible: true },
      ],
    },
  ],
} as unknown as WallOut;

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("draftFromWall", () => {
  it("orders lines and points and keys them by id", () => {
    const draft = draftFromWall(wall);
    expect(draft).toMatchObject({ wallId: 7, baseVersion: 4, newRoutes: [] });
    expect(draft.lines.map((l) => l.key)).toEqual(["l20", "l21"]);
    expect(draft.lines[0].route).toBeNull();
    expect(draft.lines[1].route).toEqual({ routeId: 2 });
    expect(draft.lines[1].parent).toEqual({ lineKey: "l20", pointKey: "p101" });
    expect(draft.lines[1].points.map((p) => p.key)).toEqual(["p110", "p111"]);
  });
});

function editedDraft(): Draft {
  const draft = draftFromWall(wall);
  return {
    ...draft,
    newRoutes: [{ key: "n1", name: "Nowa", grade: "VI" }],
    lines: [
      ...draft.lines,
      {
        key: "n2",
        id: null,
        route: { routeKey: "n1" },
        parent: { lineKey: "l20", pointKey: "p101" },
        points: [
          { key: "n3", id: null, x: 0.3, y: 0.5, kind: "przelot" },
          { key: "n4", id: null, x: 0.6, y: 0.1, kind: "stanowisko" },
        ],
      },
      {
        key: "n5",
        id: null,
        route: null,
        parent: { lineKey: "n2", pointKey: "n4" },
        points: [
          { key: "n6", id: null, x: 0.6, y: 0.1, kind: "przelot" },
          { key: "n7", id: null, x: 0.7, y: 0.05, kind: "ring" },
        ],
      },
    ],
  };
}

describe("toSaveBody", () => {
  it("sends saved objects by id and new ones by ref", () => {
    const body = toSaveBody(editedDraft(), "nowe linie");
    expect(body.version).toBe(4);
    expect(body.comment).toBe("nowe linie");
    expect(body.new_routes).toEqual([{ ref: "n1", name: "Nowa", grade: "VI" }]);
    expect(body.lines[0]).toMatchObject({
      id: 20,
      route_id: null,
      sort_order: 0,
      parent: null,
    });
    expect(body.lines[0]).not.toHaveProperty("ref");
    expect(body.lines[1]).toMatchObject({
      id: 21,
      route_id: 2,
      sort_order: 1,
      parent: { line_id: 20, point_id: 101 },
    });
    expect(body.lines[1].points).toEqual([
      { id: 110, sort_order: 0, x: 0.3, y: 0.5, kind: "przelot" },
      { id: 111, sort_order: 1, x: 0.4, y: 0.2, kind: "stanowisko" },
    ]);
    expect(body.lines[2]).toMatchObject({
      ref: "n2",
      route_ref: "n1",
      sort_order: 2,
      parent: { line_id: 20, point_id: 101 },
    });
    expect(body.lines[2].points[0]).toEqual({
      ref: "n3",
      sort_order: 0,
      x: 0.3,
      y: 0.5,
      kind: "przelot",
    });
    expect(body.lines[3].parent).toEqual({ line_ref: "n2", point_ref: "n4" });
  });
});

describe("applySaved", () => {
  it("fills in ids and turns editor routes into saved routes", () => {
    const saved = applySaved(editedDraft(), {
      version: 5,
      ids: { n1: 9, n2: 30, n3: 300, n4: 301, n5: 31, n6: 310, n7: 311 },
    });
    expect(saved.baseVersion).toBe(5);
    expect(saved.newRoutes).toEqual([]);
    expect(saved.lines[2]).toMatchObject({
      key: "n2",
      id: 30,
      route: { routeId: 9 },
    });
    expect(saved.lines[2].points.map((p) => p.id)).toEqual([300, 301]);
    expect(saved.lines[0].id).toBe(20);
    expect(saved.lines[3].parent).toEqual({ lineKey: "n2", pointKey: "n4" });
  });
});

describe("countChanges", () => {
  it("counts changed, added and removed lines plus new routes", () => {
    const base = draftFromWall(wall);
    expect(countChanges(base, base)).toBe(0);
    const moved = {
      ...base,
      lines: base.lines.map((l, i) => (i === 0 ? { ...l, points: l.points.map((p) => ({ ...p, x: p.x + 0.01 })) } : l)),
    };
    expect(countChanges(base, moved)).toBe(1);
    const swapped = {
      ...base,
      lines: [base.lines[0], { ...base.lines[1], key: "n1", id: null }],
    };
    expect(countChanges(base, swapped)).toBe(2);
    expect(countChanges(base, editedDraft())).toBe(3);
  });
});

describe("local drafts", () => {
  it("saves, loads and clears a draft", () => {
    const draft = editedDraft();
    saveLocal(draft, new Date("2026-10-09T14:02:00Z"));
    expect(loadLocal(7)).toEqual({
      draft,
      savedAt: "2026-10-09T14:02:00.000Z",
    });
    clearLocal(7);
    expect(loadLocal(7)).toBeNull();
  });

  it("survives broken storage", () => {
    localStorage.setItem(draftKey(7), "{nie json");
    expect(loadLocal(7)).toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => saveLocal(editedDraft())).not.toThrow();
  });
});
