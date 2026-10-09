import { beforeEach, describe, expect, it } from "vitest";
import { useEditor } from "@/editor/store";
import type { Draft, DraftLine } from "@/editor/types";

const image = { width: 1600, height: 1000 };

function makeDraft(): Draft {
  return {
    wallId: 1,
    baseVersion: 3,
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
          { key: "p4", id: 4, x: 0.5, y: 0.2, kind: "stanowisko" },
        ],
      },
    ],
  };
}

const state = () => useEditor.getState();
const temporal = () => useEditor.temporal.getState();
const line = (key: string): DraftLine => state().draft.lines.find((l) => l.key === key)!;
const point = (lineKey: string, pointKey: string) => line(lineKey).points.find((p) => p.key === pointKey)!;

beforeEach(() => state().load(makeDraft(), image));

describe("editor store", () => {
  it("starts a new line with a start point, then rings, snapping onto existing points", () => {
    const key = state().newLine({ routeId: 9 });
    state().appendPoint(key, { x: 0.8, y: 0.9 });
    state().appendPoint(key, { x: 0.5002, y: 0.2 });
    expect(line(key).points.map((p) => [p.kind, p.x, p.y])).toEqual([
      ["start", 0.8, 0.9],
      ["ring", 0.5, 0.2],
    ]);
    expect(state().selectedLineKey).toBe(key);
  });

  it("moves a shared point together with its twins in one undo step", () => {
    const before = temporal().pastStates.length;
    state().movePoint("l1", "p2", { x: 0.6, y: 0.3 }, false);
    expect(point("l1", "p2")).toMatchObject({ x: 0.6, y: 0.3 });
    expect(point("l2", "p4")).toMatchObject({ x: 0.6, y: 0.3 });
    expect(temporal().pastStates.length).toBe(before + 1);
    temporal().undo();
    expect(point("l1", "p2")).toMatchObject({ x: 0.5, y: 0.2 });
    expect(point("l2", "p4")).toMatchObject({ x: 0.5, y: 0.2 });
  });

  it("moves only the chosen point when detaching", () => {
    state().movePoint("l1", "p2", { x: 0.6, y: 0.3 }, true);
    expect(point("l1", "p2")).toMatchObject({ x: 0.6, y: 0.3 });
    expect(point("l2", "p4")).toMatchObject({ x: 0.5, y: 0.2 });
  });

  it("clamps moved points to the photo", () => {
    state().movePoint("l1", "p1", { x: -0.2, y: 1.4 }, true);
    expect(point("l1", "p1")).toMatchObject({ x: 0, y: 1 });
  });

  it("inserts a przelot after the given index", () => {
    state().insertPoint("l1", 0, { x: 0.3, y: 0.5 });
    expect(line("l1").points.map((p) => p.kind)).toEqual(["start", "przelot", "stanowisko"]);
  });

  it("detaches variants when their branch point is deleted", () => {
    state().newVariant({ lineKey: "l1", pointKey: "p2" }, { routeId: 1 });
    const variant = state().draft.lines[2].key;
    expect(line(variant).parent).toEqual({ lineKey: "l1", pointKey: "p2" });
    expect(line(variant).points[0]).toMatchObject({ x: 0.5, y: 0.2 });
    state().deletePoint("l1", "p2");
    expect(line(variant).parent).toBeNull();
    expect(line("l1").points.map((p) => p.key)).toEqual(["p1"]);
  });

  it("detaches variants when their parent line is deleted", () => {
    state().newVariant({ lineKey: "l1", pointKey: "p2" }, null);
    const variant = state().draft.lines[2].key;
    state().deleteLine("l1");
    expect(state().draft.lines.map((l) => l.key)).toEqual(["l2", variant]);
    expect(line(variant).parent).toBeNull();
  });

  it("adds a route made in the editor and draws its line", () => {
    const routeKey = state().addRoute("Nowa", "VI");
    const key = state().newLine({ routeKey });
    expect(state().draft.newRoutes).toEqual([{ key: routeKey, name: "Nowa", grade: "VI" }]);
    expect(line(key).route).toEqual({ routeKey });
    state().setRoute(key, { routeId: 4 });
    expect(line(key).route).toEqual({ routeId: 4 });
  });

  it("reorders lines and changes point kinds", () => {
    state().moveLine("l2", -1);
    expect(state().draft.lines.map((l) => l.key)).toEqual(["l2", "l1"]);
    state().moveLine("l2", -1);
    expect(state().draft.lines.map((l) => l.key)).toEqual(["l2", "l1"]);
    state().setKind("l1", "p1", "hak");
    expect(point("l1", "p1").kind).toBe("hak");
  });

  it("does not record selection as an undo step", () => {
    const before = temporal().pastStates.length;
    state().select("l1", "p1");
    expect(temporal().pastStates.length).toBe(before);
    expect(state().selectedPointKey).toBe("p1");
  });

  it("keeps at most 100 undo steps", () => {
    for (let i = 0; i < 105; i++) state().movePoint("l1", "p1", { x: 0.1 + i / 1000, y: 0.9 }, true);
    expect(temporal().pastStates.length).toBe(100);
  });

  it("rebases the draft and the undo stack without adding a step", () => {
    const key = state().newLine({ routeId: 9 });
    state().appendPoint(key, { x: 0.8, y: 0.9 });
    const steps = temporal().pastStates.length;
    const withId = (draft: Draft): Draft => ({
      ...draft,
      lines: draft.lines.map((l) => (l.key === key ? { ...l, id: 50 } : l)),
    });
    state().rebase(withId);
    expect(line(key).id).toBe(50);
    expect(temporal().pastStates.length).toBe(steps);
    temporal().undo();
    expect(line(key).id).toBe(50);
  });
});
