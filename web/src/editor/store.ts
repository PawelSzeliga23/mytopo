import { create } from "zustand";
import { temporal } from "zundo";
import { coincident, snapTo } from "@/editor/shared";
import type { At, Draft, DraftLine, DraftParent, DraftRouteRef, ImageSize } from "@/editor/types";
import type { PointKind } from "@/lib/api";

export interface EditorState {
  draft: Draft;
  image: ImageSize;
  selectedLineKey: string | null;
  selectedPointKey: string | null;
  /** Replaces the draft and clears the undo stack. */
  load(draft: Draft, image: ImageSize): void;
  /** Replaces the draft (and every undo/redo state) after a save, keeping the undo stack — see Task 6. */
  rebase(transform: (draft: Draft) => Draft): void;
  select(lineKey: string | null, pointKey?: string | null): void;
  movePoint(lineKey: string, pointKey: string, to: At, detach: boolean): void;
  appendPoint(lineKey: string, at: At): string;
  insertPoint(lineKey: string, afterIndex: number, at: At): string;
  deletePoint(lineKey: string, pointKey: string): void;
  setKind(lineKey: string, pointKey: string, kind: PointKind): void;
  newLine(route: DraftRouteRef): string;
  newVariant(parent: DraftParent, route: DraftRouteRef): string;
  addRoute(name: string, grade: string | null): string;
  /** Drops a route added in the editor (e.g. a mistyped grade); its lines are left without a route. */
  removeRoute(routeKey: string): void;
  setRoute(lineKey: string, route: DraftRouteRef): void;
  moveLine(lineKey: string, delta: -1 | 1): void;
  deleteLine(lineKey: string): void;
}

let counter = 0;
/** Key for an object added in the editor; never collides with `l{id}` / `p{id}` keys of saved ones. */
export const newKey = () => `n${++counter}`;

function maxNewKey(draft: Draft): number {
  const keys = [
    ...draft.newRoutes.map((route) => route.key),
    ...draft.lines.flatMap((line) => [line.key, ...line.points.map((point) => point.key)]),
  ];
  return keys.reduce((max, key) => (/^n\d+$/.test(key) ? Math.max(max, Number(key.slice(1))) : max), 0);
}

const UNDO_LIMIT = 100;
const EMPTY: Draft = { wallId: 0, baseVersion: 0, lines: [], newRoutes: [] };
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const clampAt = (at: At): At => ({ x: clamp(at.x), y: clamp(at.y) });

const mapLine = (draft: Draft, key: string, fn: (line: DraftLine) => DraftLine): Draft => ({
  ...draft,
  lines: draft.lines.map((line) => (line.key === key ? fn(line) : line)),
});

const detachFrom = (lines: DraftLine[], match: (parent: DraftParent) => boolean): DraftLine[] =>
  lines.map((line) => (line.parent && match(line.parent) ? { ...line, parent: null } : line));

export const useEditor = create<EditorState>()(
  temporal(
    (set, get) => ({
      draft: EMPTY,
      image: { width: 1, height: 1 },
      selectedLineKey: null,
      selectedPointKey: null,

      load(draft, image) {
        // Continue after the highest key of a restored draft, so new objects never reuse one.
        counter = maxNewKey(draft);
        set({ draft, image, selectedLineKey: null, selectedPointKey: null });
        useEditor.temporal.getState().clear();
      },

      rebase(transform) {
        const temporalState = useEditor.temporal.getState();
        temporalState.pause();
        set({ draft: transform(get().draft) });
        temporalState.resume();
        useEditor.temporal.setState({
          pastStates: temporalState.pastStates.map((state) => (state.draft ? { draft: transform(state.draft) } : state)),
          futureStates: temporalState.futureStates.map((state) => (state.draft ? { draft: transform(state.draft) } : state)),
        });
      },

      select(lineKey, pointKey = null) {
        set({ selectedLineKey: lineKey, selectedPointKey: pointKey });
      },

      movePoint(lineKey, pointKey, to, detach) {
        const { draft, image } = get();
        const targets = detach ? [{ lineKey, pointKey }] : coincident(draft, image, lineKey, pointKey);
        const at = clampAt(to);
        const isTarget = (line: DraftLine, key: string) => targets.some((t) => t.lineKey === line.key && t.pointKey === key);
        set({
          draft: {
            ...draft,
            lines: draft.lines.map((line) => ({
              ...line,
              points: line.points.map((point) => (isTarget(line, point.key) ? { ...point, ...at } : point)),
            })),
          },
        });
      },

      appendPoint(lineKey, raw) {
        const { draft, image } = get();
        const at = snapTo(draft, image, clampAt(raw));
        const key = newKey();
        set({
          draft: mapLine(draft, lineKey, (line) => ({
            ...line,
            points: [
              ...line.points,
              {
                key,
                id: null,
                ...at,
                kind: line.points.length === 0 ? "start" : "ring",
              },
            ],
          })),
          selectedLineKey: lineKey,
          selectedPointKey: key,
        });
        return key;
      },

      insertPoint(lineKey, afterIndex, raw) {
        const { draft } = get();
        const key = newKey();
        set({
          draft: mapLine(draft, lineKey, (line) => {
            const points = [...line.points];
            points.splice(afterIndex + 1, 0, {
              key,
              id: null,
              ...clampAt(raw),
              kind: "przelot",
            });
            return { ...line, points };
          }),
          selectedLineKey: lineKey,
          selectedPointKey: key,
        });
        return key;
      },

      deletePoint(lineKey, pointKey) {
        const { draft } = get();
        const lines = mapLine(draft, lineKey, (line) => ({
          ...line,
          points: line.points.filter((p) => p.key !== pointKey),
        })).lines;
        set({
          draft: {
            ...draft,
            lines: detachFrom(lines, (parent) => parent.lineKey === lineKey && parent.pointKey === pointKey),
          },
          selectedPointKey: null,
        });
      },

      setKind(lineKey, pointKey, kind) {
        set({
          draft: mapLine(get().draft, lineKey, (line) => ({
            ...line,
            points: line.points.map((point) => (point.key === pointKey ? { ...point, kind } : point)),
          })),
        });
      },

      newLine(route) {
        const { draft } = get();
        const key = newKey();
        set({
          draft: {
            ...draft,
            lines: [...draft.lines, { key, id: null, route, parent: null, points: [] }],
          },
          selectedLineKey: key,
          selectedPointKey: null,
        });
        return key;
      },

      newVariant(parent, route) {
        const { draft } = get();
        const parentLine = draft.lines.find((line) => line.key === parent.lineKey);
        const branch = parentLine?.points.find((point) => point.key === parent.pointKey);
        const key = newKey();
        // A variant's own points start at the branch point, as imported variants do (linePath drops the duplicate).
        const points = branch
          ? [
              {
                key: newKey(),
                id: null,
                x: branch.x,
                y: branch.y,
                kind: "przelot" as const,
              },
            ]
          : [];
        set({
          draft: {
            ...draft,
            lines: [...draft.lines, { key, id: null, route, parent, points }],
          },
          selectedLineKey: key,
          selectedPointKey: null,
        });
        return key;
      },

      addRoute(name, grade) {
        const { draft } = get();
        const key = newKey();
        set({
          draft: {
            ...draft,
            newRoutes: [...draft.newRoutes, { key, name, grade }],
          },
        });
        return key;
      },

      removeRoute(routeKey) {
        const { draft } = get();
        set({
          draft: {
            ...draft,
            newRoutes: draft.newRoutes.filter((route) => route.key !== routeKey),
            lines: draft.lines.map((line) =>
              line.route && "routeKey" in line.route && line.route.routeKey === routeKey ? { ...line, route: null } : line,
            ),
          },
        });
      },

      setRoute(lineKey, route) {
        set({
          draft: mapLine(get().draft, lineKey, (line) => ({ ...line, route })),
        });
      },

      moveLine(lineKey, delta) {
        const { draft } = get();
        const index = draft.lines.findIndex((line) => line.key === lineKey);
        const target = index + delta;
        if (index === -1 || target < 0 || target >= draft.lines.length) return;
        const lines = [...draft.lines];
        [lines[index], lines[target]] = [lines[target], lines[index]];
        set({ draft: { ...draft, lines } });
      },

      deleteLine(lineKey) {
        const { draft } = get();
        const lines = draft.lines.filter((line) => line.key !== lineKey);
        set({
          draft: {
            ...draft,
            lines: detachFrom(lines, (parent) => parent.lineKey === lineKey),
          },
          selectedLineKey: null,
          selectedPointKey: null,
        });
      },
    }),
    {
      limit: UNDO_LIMIT,
      partialize: (state) => ({ draft: state.draft }),
      equality: (past, current) => past.draft === current.draft,
    },
  ),
);
