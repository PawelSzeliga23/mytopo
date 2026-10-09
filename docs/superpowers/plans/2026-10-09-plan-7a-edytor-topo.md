# Plan 7a: edytor topo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zalogowani poprawiają linie dróg na zdjęciu ściany w pełnoekranowym edytorze (komputer i telefon): przesuwają i dodają wpinki, rysują nowe linie i warianty, zmieniają typy i kolejność, cofają kroki Ctrl+Z, a „Zapisz” zapisuje całą ścianę jako jeden wpis historii.

**Architecture:** Front trzyma szkic ściany w sklepie zustand + zundo (`web/src/editor/store.ts`) na kluczach (`l12`/`p345` dla istniejących, `n1`, `n2`… dla nowych); wspólne punkty rozpoznaje po położeniu (`shared.ts`); szkic żyje w `localStorage` (`draft.ts`). Rysowanie i gesty w `EditorCanvas.tsx` (react-konva, funkcje widoku z `web/src/crag/view.ts`), układ w `EditorPage.tsx` (trasa `/skaly/:slug/topo/:wallId`, leniwie). API: `PUT /api/walls/{id}/lines` w `api/topo/topo_edit.py` porównuje szkic z bazą — aktualizuje obiekty z `id`, tworzy z `ref`, usuwa brakujące przez ORM — w jednej transakcji historii; `wall.version` podbijane Core UPDATE (bez szumu w historii), także przy cofnięciu dotykającym linii.

**Tech Stack:** jak w planach 1–6 + `zustand`, `zundo` (front).

**Spec:** `docs/superpowers/specs/2026-10-09-plan-7a-edytor-topo-design.md` (całość), tło: `docs/superpowers/specs/2026-10-08-topo-design.md` §6.5, makieta: `.superpowers/brainstorm/2878-1791556262/content/uklad.html` (wariant A), wygląd: `docs/superpowers/specs/2026-10-08-frontend-design.md`.

## Global Constraints

- Wszystkie teksty interfejsu i komunikaty API po polsku.
- Punkty: `x`, `y` w [0, 1] względem zdjęcia; typy `start | ring | hak | ucho | stanowisko | ogranicznik | przelot`; `visible = kind != "przelot"`.
- Linia ma ≥ 2 punkty. Nowa linia: pierwszy punkt `start`, kolejne `ring`; punkt wstawiony na odcinku: `przelot`.
- Wspólne punkty: odległość < 0,3% dłuższego boku zdjęcia (w pikselach zdjęcia) — przesuwane razem; nowy punkt w tym promieniu przyjmuje dokładnie położenie istniejącego; odklejenie Alt (komputer) / „Odklej” (telefon).
- Kolor linii zawsze z wyceny drogi; kolumna `route_line.color` wypełniana: pasmo 0 `#00BFFF`, 1 `#0000FF`, 2 `#FF0000`, 3 `#000000`, bez wyceny `#e11d48`.
- Stos kroków: zustand + zundo, limit 100; krok = jedna czynność (całe przeciągnięcie = 1 krok). Zaznaczenie nie jest krokiem.
- Szkic w `localStorage` pod `topo-draft-{wallId}`, każdy odczyt i zapis w try/catch.
- Zapis: jedna transakcja historii (autor = nick, komentarz ≤ 500); `version` niezgodna → 409 `version_conflict` „Ktoś zapisał topo w międzyczasie” z `current_version`; brak zmian → 200 bez transakcji.
- `wall.version` podbijane Core UPDATE (`update(Wall)…values(version=Wall.version + 1)`), nigdy przez ORM — inaczej historia pokaże pustą zmianę ściany.
- Usuwanie linii przez ORM z odpięciem wariantów spoza zbioru (`delete_line` z `topo/editing.py`).
- Uchwyty punktów stałej wielkości na ekranie, pole dotyku ≥ 24 px na telefonie.
- Testy: `docker compose run --rm api pytest -q`, `cd web; npm test`. **Zasada:** pisane razem z kodem, uruchamiane raz na końcu zadania. **Bez E2E w Playwright** — użytkownik przeklikuje sam.

## Review Focus

1. **Przeciągnięcie wspólnego punktu, a potem Ctrl+Z** — wszystkie linie wracają jednym krokiem; odklejony punkt rusza się sam — Task 1 `store.test.ts` „przesunięcie wspólnego punktu to jeden krok”.
2. **Usunięcie punktu, od którego odchodzi wariant** — wariant traci powiązanie z rodzicem (nie wisi na nieistniejącym punkcie), zapis przechodzi — Task 1 `deletePoint odpina warianty`, Task 5 `test_delete_parent_point_detaches_variant`.
3. **Zapis szkicu, gdy ktoś zapisał wcześniej** — 409, szkic zostaje w `localStorage`, nic w bazie się nie zmienia — Task 5 `test_stale_version_conflict`, Task 6 `EditorPage` test 409.
4. **Odświeżenie strony w trakcie edycji** — szkic wraca z pytaniem „Przywróć / Porzuć”, a szkic sprzed cudzego zapisu ostrzega — Task 2 `draft.test.ts` (wersja bazowa), Task 6 test okienka szkicu.
5. **Nowa droga i jej linia w jednym zapisie, potem cofnięcie z historii** — droga i linia znikają, `wall.version` rośnie, otwarty edytor dostanie 409 — Task 5 `test_revert_of_topo_save_bumps_version`.

---

### Task 1: Sklep edytora i wspólne punkty

**Files:**
- Modify: `web/package.json` (+ `zustand`, `zundo` — `npm install zustand zundo`)
- Create: `web/src/editor/types.ts`, `web/src/editor/shared.ts`, `web/src/editor/store.ts`
- Test: `web/src/editor/shared.test.ts`, `web/src/editor/store.test.ts`

**Interfaces:**
- Consumes: `PointKind`, `WallOut`, `LineOut` z `web/src/lib/api.ts`; `orderedLines` z `web/src/crag/topo.ts` (tylko w testach do porównania numeracji, opcjonalnie).
- Produces (`types.ts`):

```ts
import type { PointKind } from "@/lib/api";

export interface DraftPoint { key: string; id: number | null; x: number; y: number; kind: PointKind }
export interface DraftParent { lineKey: string; pointKey: string }
/** Route of a line: an existing route id or the key of a route added in the editor. */
export type DraftRouteRef = { routeId: number } | { routeKey: string } | null;
export interface DraftLine { key: string; id: number | null; route: DraftRouteRef; parent: DraftParent | null; points: DraftPoint[] }
export interface DraftRoute { key: string; name: string; grade: string | null }
/** Lines in topo order (array index = sort_order). */
export interface Draft { wallId: number; baseVersion: number; lines: DraftLine[]; newRoutes: DraftRoute[] }
export interface ImageSize { width: number; height: number }
export interface At { x: number; y: number }
```

- Produces (`shared.ts`):
  - `SHARE_RADIUS = 0.003` (ułamek dłuższego boku).
  - `isSamePlace(a: At, b: At, image: ImageSize): boolean`.
  - `coincident(draft: Draft, image: ImageSize, lineKey: string, pointKey: string): { lineKey: string; pointKey: string }[]` — wszystkie punkty (także ten) w tym samym miejscu.
  - `snapTo(draft: Draft, image: ImageSize, at: At): At` — położenie najbliższego istniejącego punktu w promieniu albo `at`.
- Produces (`store.ts`):

```ts
export interface EditorState {
  draft: Draft;
  image: ImageSize;
  selectedLineKey: string | null;
  selectedPointKey: string | null;
  load(draft: Draft, image: ImageSize): void;            // czyści stos kroków
  select(lineKey: string | null, pointKey?: string | null): void;  // nie jest krokiem
  movePoint(lineKey: string, pointKey: string, to: At, detach: boolean): void;
  appendPoint(lineKey: string, at: At): string;            // zwraca key punktu; start/ring wg pozycji
  insertPoint(lineKey: string, afterIndex: number, at: At): string;   // przelot
  deletePoint(lineKey: string, pointKey: string): void;    // odpina warianty od tego punktu
  setKind(lineKey: string, pointKey: string, kind: PointKind): void;
  newLine(route: DraftRouteRef): string;                   // pusta linia na końcu, zaznaczona
  newVariant(parent: DraftParent, route: DraftRouteRef): string;
  addRoute(name: string, grade: string | null): string;    // klucz nowej drogi
  setRoute(lineKey: string, route: DraftRouteRef): void;
  moveLine(lineKey: string, delta: -1 | 1): void;
  deleteLine(lineKey: string): void;                       // warianty tej linii: parent = null
}
export const useEditor: UseBoundStore<…> & { temporal: … };   // zundo `temporal`, partialize → { draft }, limit 100
export function newKey(): string;                          // "n1", "n2"… (licznik modułowy, reset w load)
```

- [ ] **Step 1: Instalacja** — `cd web; npm install zustand zundo`.

- [ ] **Step 2: Testy `shared.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { coincident, isSamePlace, snapTo } from "@/editor/shared";
import type { Draft } from "@/editor/types";

const image = { width: 1600, height: 1000 };
const draft: Draft = {
  wallId: 1, baseVersion: 1, newRoutes: [],
  lines: [
    { key: "l1", id: 1, route: { routeId: 1 }, parent: null, points: [
      { key: "p1", id: 1, x: 0.1, y: 0.9, kind: "start" }, { key: "p2", id: 2, x: 0.5, y: 0.2, kind: "stanowisko" }] },
    { key: "l2", id: 2, route: { routeId: 2 }, parent: null, points: [
      { key: "p3", id: 3, x: 0.3, y: 0.9, kind: "start" }, { key: "p4", id: 4, x: 0.5001, y: 0.2001, kind: "stanowisko" }] },
  ],
};

describe("shared points", () => {
  it("treats points closer than 0.3% of the longer side as one place", () => {
    expect(isSamePlace({ x: 0.5, y: 0.2 }, { x: 0.5001, y: 0.2001 }, image)).toBe(true);
    expect(isSamePlace({ x: 0.5, y: 0.2 }, { x: 0.504, y: 0.2 }, image)).toBe(false);
  });
  it("finds the shared stanowisko of both lines", () => {
    expect(coincident(draft, image, "l1", "p2")).toEqual([{ lineKey: "l1", pointKey: "p2" }, { lineKey: "l2", pointKey: "p4" }]);
  });
  it("snaps a new point onto an existing one", () => {
    expect(snapTo(draft, image, { x: 0.5002, y: 0.2 })).toEqual({ x: 0.5, y: 0.2 });
    expect(snapTo(draft, image, { x: 0.7, y: 0.7 })).toEqual({ x: 0.7, y: 0.7 });
  });
});
```

- [ ] **Step 3: Testy `store.test.ts`** (każdy test zaczyna od `useEditor.getState().load(draft, image)`; cofanie przez `useEditor.temporal.getState().undo()`):
  - `appendPoint` na pustej linii daje `start`, kolejny `ring`; nowy punkt w promieniu istniejącego dostaje jego położenie;
  - **„przesunięcie wspólnego punktu to jeden krok”**: `movePoint("l1","p2",{x:0.6,y:0.3},false)` przesuwa `p2` i `p4`; jedno `undo()` przywraca oba; z `detach=true` rusza tylko `p2`;
  - `insertPoint(lineKey, 0, at)` wstawia `przelot` na pozycji 1;
  - **„deletePoint odpina warianty”**: linia `l3` z `parent {lineKey:"l1", pointKey:"p2"}`; `deletePoint("l1","p2")` → `l3.parent === null`;
  - `deleteLine("l1")` usuwa linię i zeruje `parent` wariantów;
  - `newLine({routeId: 5})` dodaje pustą linię na końcu i ją zaznacza; `addRoute("Nowa","VI")` + `newLine({routeKey})`;
  - `newVariant` ustawia `parent`;
  - `moveLine("l2", -1)` zamienia kolejność; `setKind` zmienia typ;
  - `select` nie dodaje kroku (`temporal.getState().pastStates.length` bez zmian);
  - limit: 105 kroków → `pastStates.length === 100`.

- [ ] **Step 4: Implementacja**

```ts
// web/src/editor/shared.ts
import type { At, Draft, ImageSize } from "@/editor/types";

export const SHARE_RADIUS = 0.003;

export function isSamePlace(a: At, b: At, image: ImageSize): boolean {
  const limit = SHARE_RADIUS * Math.max(image.width, image.height);
  return Math.hypot((a.x - b.x) * image.width, (a.y - b.y) * image.height) < limit;
}

export function coincident(draft: Draft, image: ImageSize, lineKey: string, pointKey: string) {
  const origin = draft.lines.find((l) => l.key === lineKey)?.points.find((p) => p.key === pointKey);
  if (!origin) return [];
  return draft.lines.flatMap((line) =>
    line.points.filter((p) => isSamePlace(p, origin, image)).map((p) => ({ lineKey: line.key, pointKey: p.key })),
  );
}

export function snapTo(draft: Draft, image: ImageSize, at: At): At {
  let best: At | null = null;
  let bestDistance = Infinity;
  for (const line of draft.lines) for (const p of line.points) {
    const d = Math.hypot((p.x - at.x) * image.width, (p.y - at.y) * image.height);
    if (d < bestDistance && isSamePlace(p, at, image)) { best = { x: p.x, y: p.y }; bestDistance = d; }
  }
  return best ?? at;
}
```

```ts
// web/src/editor/store.ts (szkielet — każda akcja to jedno set(), więc jeden krok zundo)
import { create } from "zustand";
import { temporal } from "zundo";
import { coincident, snapTo } from "@/editor/shared";
import type { At, Draft, DraftLine, DraftParent, DraftRouteRef, ImageSize } from "@/editor/types";
// EditorState — interfejs z sekcji Interfaces, zdefiniowany i eksportowany w tym pliku.

let counter = 0;
export const newKey = () => `n${++counter}`;
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const mapLine = (draft: Draft, key: string, fn: (line: DraftLine) => DraftLine): Draft =>
  ({ ...draft, lines: draft.lines.map((line) => (line.key === key ? fn(line) : line)) });
const detachFrom = (lines: DraftLine[], match: (p: DraftParent) => boolean) =>
  lines.map((line) => (line.parent && match(line.parent) ? { ...line, parent: null } : line));

export const useEditor = create<EditorState>()(
  temporal(
    (set, get) => ({
      draft: { wallId: 0, baseVersion: 0, lines: [], newRoutes: [] },
      image: { width: 1, height: 1 },
      selectedLineKey: null,
      selectedPointKey: null,
      load(draft, image) {
        counter = 0;
        set({ draft, image, selectedLineKey: null, selectedPointKey: null });
        useEditor.temporal.getState().clear();
      },
      movePoint(lineKey, pointKey, to, detach) {
        const { draft, image } = get();
        const targets = detach ? [{ lineKey, pointKey }] : coincident(draft, image, lineKey, pointKey);
        const at = { x: clamp(to.x), y: clamp(to.y) };
        set({ draft: { ...draft, lines: draft.lines.map((line) => ({ ...line, points: line.points.map((p) =>
          targets.some((t) => t.lineKey === line.key && t.pointKey === p.key) ? { ...p, ...at } : p) })) } });
      },
      appendPoint(lineKey, raw) {
        const { draft, image } = get();
        const at = snapTo(draft, image, { x: clamp(raw.x), y: clamp(raw.y) });
        const key = newKey();
        set({ draft: mapLine(draft, lineKey, (line) => ({ ...line, points: [...line.points,
          { key, id: null, ...at, kind: line.points.length === 0 ? "start" : "ring" }] })), selectedPointKey: key });
        return key;
      },
      deletePoint(lineKey, pointKey) {
        const { draft } = get();
        const lines = mapLine(draft, lineKey, (line) => ({ ...line, points: line.points.filter((p) => p.key !== pointKey) })).lines;
        set({ draft: { ...draft, lines: detachFrom(lines, (p) => p.lineKey === lineKey && p.pointKey === pointKey) }, selectedPointKey: null });
      },
      deleteLine(lineKey) {
        const { draft } = get();
        const lines = draft.lines.filter((line) => line.key !== lineKey);
        set({ draft: { ...draft, lines: detachFrom(lines, (p) => p.lineKey === lineKey) }, selectedLineKey: null, selectedPointKey: null });
      },
      // insertPoint, setKind, newLine, newVariant, addRoute, setRoute, moveLine, select — analogicznie, jedno set() na akcję;
      // select() używa useEditor.temporal.getState().pause()/resume() wokół set(), żeby nie tworzyć kroku.
    }),
    { limit: 100, partialize: (state) => ({ draft: state.draft }), equality: (a, b) => a.draft === b.draft },
  ),
);
```

(Wszystkie akcje z `Produces` muszą zostać zaimplementowane w tym zadaniu — szkielet pokazuje wzór.)

- [ ] **Step 5: Uruchom** `cd web; npm test`.
- [ ] **Step 6: Commit** `feat: sklep edytora topo (zundo) i wspólne punkty`

---

### Task 2: Szkic — z danych ściany, w `localStorage`, ciało zapisu

**Files:**
- Create: `web/src/editor/draft.ts`, `web/src/editor/draft.test.ts`
- Modify: `web/src/lib/api.ts` (typy `SaveLinesBody`, `SaveLinesResult` i `api.saveWallLines` — sama funkcja, użycie w Task 6)

**Interfaces:**
- Consumes: `Draft`, `DraftLine`, `DraftPoint`, `DraftRoute` (Task 1); `WallOut`, `sendJson` (`web/src/lib/api.ts`).
- Produces:

```ts
// api.ts
export interface SaveLinesBody {
  version: number; comment?: string | null;
  new_routes: { ref: string; name: string; grade: string | null }[];
  lines: { id?: number; ref?: string; route_id?: number | null; route_ref?: string; sort_order: number;
           parent?: { line_id?: number; line_ref?: string; point_id?: number; point_ref?: string } | null;
           points: { id?: number; ref?: string; sort_order: number; x: number; y: number; kind: PointKind }[] }[];
}
export interface SaveLinesResult { version: number; ids: Record<string, number> }
api.saveWallLines(wallId: number, body: SaveLinesBody): Promise<SaveLinesResult>   // PUT /api/walls/{id}/lines

// draft.ts
export function draftFromWall(wall: WallOut): Draft;             // klucze l{id}/p{id}, kolejność jak orderedLines → sort_order
export function toSaveBody(draft: Draft, comment: string | null): SaveLinesBody;
export function applySaved(draft: Draft, result: SaveLinesResult): Draft;   // id z mapy ref→id, baseVersion = result.version
export function countChanges(base: Draft, draft: Draft): number;            // liczba linii dodanych, usuniętych lub różnych + nowe drogi
export function draftKey(wallId: number): string;                          // "topo-draft-{wallId}"
export function saveLocal(draft: Draft, now?: Date): void;                 // { draft, savedAt } w try/catch
export function loadLocal(wallId: number): { draft: Draft; savedAt: string } | null;
export function clearLocal(wallId: number): void;
```

- [ ] **Step 1: Testy `draft.test.ts`**
  - `draftFromWall` zachowuje kolejność linii wg `sort_order`, warianty mają `parent` z kluczami `l{id}`/`p{id}`, linia bez drogi ma `route: null`;
  - `toSaveBody`: istniejące obiekty z `id` (bez `ref`), nowe z `ref` (= klucz); `route_ref` dla drogi z edytora; `sort_order` = indeks; `parent` z `line_id`/`point_id` albo `line_ref`/`point_ref`;
  - `applySaved`: `n3` z mapy `{ n3: 77 }` dostaje `id: 77`, klucze bez zmian, `baseVersion` nowy, nowe drogi z mapy znikają z `newRoutes`, a linie dostają `{ routeId }`;
  - `countChanges`: przesunięty punkt jednej linii → 1; nowa linia + usunięta → 2; bez zmian → 0;
  - `saveLocal`/`loadLocal`/`clearLocal`: zapis i odczyt; `localStorage.setItem` rzucający wyjątek nie wywraca `saveLocal`; uszkodzony JSON → `loadLocal` zwraca `null`.
- [ ] **Step 2: Implementacja** według Interfaces (`orderedLines` nie jest potrzebne — `sort_order` z API; sortuj `[...wall.lines].sort((a,b)=>a.sort_order-b.sort_order||a.id-b.id)`).
- [ ] **Step 3: Uruchom** `cd web; npm test`.
- [ ] **Step 4: Commit** `feat: szkic topo — z danych ściany, lokalny zapis i ciało PUT`

---

### Task 3: Płótno edytora — rysowanie, przeciąganie, gesty, lupa

**Files:**
- Create: `web/src/editor/EditorCanvas.tsx`, `web/src/editor/geometry.ts`, `web/src/editor/geometry.test.ts`

**Interfaces:**
- Consumes: `useEditor` (Task 1); `fitImage`, `toScreen`, `zoomAt`, `panBy`, `clampView`, `IDENTITY`, `View`, `Size`, `Point` (`web/src/crag/view.ts`); `bandColor` (`web/src/lib/grades.ts`); `RouteOut`.
- Produces:
  - `geometry.ts`: `toPhoto(screen: Point, image: Size, container: Size, view: View): Point` (odwrotność `toScreen`), `nearestSegment(points: Point[], at: Point, maxDistance: number): { index: number; distance: number } | null` (indeks punktu przed odcinkiem; odległości w pikselach ekranu), `HANDLE_RADIUS = { mouse: 7, touch: 12 }`.
  - `EditorCanvas({ image: HTMLImageElement, routes: Map<number, RouteOut>, size: Size, tool: Tool, onToolDone(): void })`, gdzie `export type Tool = "select" | "line" | "point" | "variant"`.

Zachowanie (spec §3.2–§3.4):
- Linie w kolorze wyceny (`bandColor` z `routes` po `route.routeId`; drogi z edytora po `grade` przez `gradeSort` z `web/src/lib/grades.ts`), zaznaczona grubsza, inne `opacity 0.45`; punkty zaznaczonej linii jako uchwyty (`HANDLE_RADIUS`, skalowane odwrotnie do `view.zoom`), przelot jako puste kółko; numery linii jak na topo.
- `select`: klik w linię → `select(line)`; przeciąganie uchwytu: pozycja lokalna w stanie komponentu podczas ruchu, **jedno** `movePoint(..., detach = event.altKey || detachMode)` na końcu; klik na odcinku zaznaczonej linii (`nearestSegment` ≤ 10 px) → `insertPoint`.
- `line` / `point`: klik → `appendPoint(selectedLineKey, toPhoto(...))`.
- `variant`: pierwszy klik musi trafić w punkt linii → `newVariant({lineKey, pointKey}, route linii rodzica)`, dalej jak `point`.
- Gesty: jeden palec / lewy przycisk = edycja; dwa palce = przybliżanie i przesuwanie (`zoomAt`, `panBy`); kółko = `zoomAt`; spacja + przeciąganie albo środkowy przycisk = `panBy`.
- Lupa (dotyk, podczas przeciągania uchwytu): okrąg Ø 110 px 80 px nad palcem z fragmentem zdjęcia w powiększeniu ×2.5 i krzyżykiem w środku (osobna `Layer` z `Group` + `clipFunc`).

- [ ] **Step 1: Testy `geometry.test.ts`**: `toPhoto(toScreen(p)) ≈ p` dla kilku widoków (zoom 1 i 3, przesunięcie); `nearestSegment` znajduje odcinek, zwraca `null` powyżej progu.
- [ ] **Step 2: Implementacja** `geometry.ts` i `EditorCanvas.tsx` (wzór gestów: `web/src/crag/WallCanvas.tsx` — `pointsOf`, `start`, `move`, `end`).
- [ ] **Step 3: Uruchom** `cd web; npm test`.
- [ ] **Step 4: Commit** `feat: płótno edytora topo (przeciąganie, wstawianie, gesty, lupa)`

---

### Task 4: Strona edytora i wejście ze strony skały (bez zapisu na serwer)

**Files:**
- Create: `web/src/editor/EditorPage.tsx`, `web/src/editor/Toolbar.tsx`, `web/src/editor/LinesPanel.tsx`, `web/src/editor/PointPanel.tsx`, `web/src/editor/RoutePicker.tsx`, `web/src/editor/EditorPage.test.tsx`
- Modify: `web/src/App.tsx` (trasa `/skaly/:slug/topo/:wallId`, `lazy`), `web/src/crag/edit/CragMenu.tsx` (pozycja „Edytuj topo” dla bieżącego zdjęcia, gdy ma `image_url`)

**Interfaces:**
- Consumes: Task 1–3; `api.crag(slug)` (istniejące zapytanie `["crag", slug]`), `useSession` (`isEditor`, `reauthenticating`, `requestLogin`), `useHtmlImage`, `useElementSize`, `ConfirmDialog` (`web/src/crag/edit/ConfirmDialog.tsx`), `Sheet`/`Drawer`, `useMediaQuery`.
- Produces: `EditorPage` (default export, leniwie), `Toolbar({ tool, onTool, orientation: "vertical" | "horizontal" })`, `LinesPanel()`, `PointPanel()`, `RoutePicker({ open, onPick(route: DraftRouteRef), onClose })`.

Zachowanie (spec §3.1, §3.5 bez zapisu):
- Po wczytaniu skały: `load(draftFromWall(wall), size)`; jeśli `loadLocal(wallId)` istnieje → okienko „Masz niezapisany szkic z {czas}” (Przywróć / Porzuć); szkic o `baseVersion < wall.version` → „Ktoś zapisał zmiany po Twoim szkicu” (Porzuć szkic / Przywróć mimo to).
- Każda zmiana szkicu → `saveLocal` (subskrypcja `useEditor.subscribe`, z opóźnieniem 300 ms).
- Komputer (≥ 768 px): pasek górny („← Wyjdź”, „{skała} · {wallLabel} — edycja topo”, ↶ ↷, „szkic zapisany lokalnie”, przycisk „Zapisz (n zmian)” — w tym zadaniu **nieaktywny** z podpowiedzią „Zapis w następnym kroku”), `Toolbar` pionowo z lewej, `EditorCanvas`, z prawej `LinesPanel` i `PointPanel`.
- Telefon: pasek górny (✕, nazwa, ↶ ↷, „Zapisz” nieaktywny), `EditorCanvas` na cały ekran, `Toolbar` poziomo na dole z przyciskiem ☰ otwierającym `LinesPanel` w `Drawer`; podpowiedź czynności w rogu zdjęcia; „Odklej” w `PointPanel`.
- Skróty: V/N/P/W, Delete/Backspace, Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y, Enter (koniec linii), Escape (odznacz / koniec linii) — nieaktywne, gdy fokus w polu tekstowym.
- „Nowa linia” → `RoutePicker`: drogi skały bez linii na tym zdjęciu, potem pozostałe; „+ nowa droga” (nazwa, wycena) → `addRoute` + `newLine({routeKey})`.
- `LinesPanel`: numery jak `orderedLines` (dla szkicu — ta sama reguła: linie główne 1, 2…, warianty „5a”), nazwa drogi, ↑↓, zmiana drogi (RoutePicker), usuń (z potwierdzeniem, gdy ma warianty).
- `PointPanel`: typy punktu jako przyciski, „Usuń punkt”, „Odklej”.
- „Wyjdź” z `countChanges > 0` → `ConfirmDialog` „Porzucić zmiany? Szkic zostanie na tym urządzeniu.” → powrót na `/skaly/{slug}` (szkic zostaje w `localStorage`).
- Niezalogowany → komunikat „Edycja topo po zalogowaniu” + „✎ Edytuj” (`requestLogin`); ściana bez zdjęcia → „Ta ściana nie ma zdjęcia”.
- `CragMenu`: „Edytuj topo” → `navigate(`/skaly/${slug}/topo/${wall.id}`)`.

- [ ] **Step 1: Testy `EditorPage.test.tsx`** (fetch zamockowany jak w `web/src/pages/CragPage.test.tsx`): zalogowany widzi narzędzia i listę linii z numerami; szkic w `localStorage` → okienko „Masz niezapisany szkic”, „Przywróć” ładuje szkic; szkic ze starszą wersją → ostrzeżenie; Ctrl+Z po `setKind` przywraca typ; „Wyjdź” po zmianie pyta o porzucenie; niezalogowany widzi zaproszenie; `CragMenu` ma „Edytuj topo”.
- [ ] **Step 2: Implementacja** według Interfaces.
- [ ] **Step 3: Uruchom** `cd web; npm test`, `npx tsc -b`, `npm run build` (główny plik JS nie rośnie — edytor leniwie).
- [ ] **Step 4: Commit** `feat: strona edytora topo (narzędzia, lista linii, szkic lokalny)`
- [ ] **Step 5: STOP — ocena użytkownika.** Uruchom `docker compose up -d api` i `cd web; npm run dev`; poproś użytkownika o przeklikanie edytora na komputerze i telefonie (przesuwanie, wspólne punkty, nowa linia, wariant, lupa, Ctrl+Z, szkic po odświeżeniu). Każdą poprawkę wprowadź jako osobny commit `fix:` i zapisz jako decyzję w „Wnioskach z wykonania” na końcu planu. Nie zaczynaj Task 5 przed akceptacją.

---

### Task 5: API zapisu topo ściany i wersja przy cofnięciu

**Files:**
- Create: `api/topo/topo_edit.py`, `api/tests/test_topo_edit.py`
- Modify: `api/topo/schemas_edit.py` (`WallLinesIn` i części), `api/topo/api/walls.py` (`PUT /{wall_id}/lines`), `api/topo/revert.py` (podbicie wersji ścian), `api/tests/test_revert.py`

**Interfaces:**
- Consumes: `current_editor`, `start_change` (`topo/api/deps.py`); `apply_fields`, `apply_grade`, `delete_line` (`topo/editing.py`); `grade_band` (`topo/grades.py`); `refresh_area_geom`; `transaction_changes` (`topo/changes.py`).
- Produces:

```python
# schemas_edit.py
Kind = Literal["start", "ring", "hak", "ucho", "stanowisko", "ogranicznik", "przelot"]
Ref = Annotated[str, Field(min_length=1, max_length=40)]
Coord = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]

class PointIn(BaseModel): id: int | None = None; ref: Ref | None = None; sort_order: int; x: Coord; y: Coord; kind: Kind
class ParentIn(BaseModel): line_id: int | None = None; line_ref: Ref | None = None; point_id: int | None = None; point_ref: Ref | None = None
class LineIn(BaseModel):
    id: int | None = None; ref: Ref | None = None
    route_id: int | None = None; route_ref: Ref | None = None
    sort_order: int; parent: ParentIn | None = None
    points: Annotated[list[PointIn], Field(min_length=2)]
class NewRouteIn(BaseModel): ref: Ref; name: RouteName; grade: str | None = None
class WallLinesIn(EditBase):
    version: int
    new_routes: list[NewRouteIn] = []
    lines: list[LineIn]
# Każdy obiekt ma dokładnie jedno z id/ref (model_validator → 422 „Każdy obiekt potrzebuje id albo ref”).

# topo_edit.py
LINE_COLORS: tuple[str, ...] = ("#00BFFF", "#0000FF", "#FF0000", "#000000"); UNGRADED_COLOR = "#e11d48"
class VersionConflict(Exception):
    def __init__(self, current: int): ...
def line_color(route: Route | None) -> str
def bump_wall_versions(session: Session, wall_ids: Iterable[int]) -> None     # Core UPDATE, bez historii
def save_wall_lines(session: Session, wall: Wall, body: WallLinesIn) -> SaveResult | None   # None = brak zmian
@dataclass
class SaveResult: version: int; ids: dict[str, int]
def walls_touched(session: Session, changes: list[ObjectChange]) -> set[int]  # ściany linii/punktów ze zmian (before/after)
```

- Endpoint `PUT /api/walls/{wall_id:int}/lines` (sesja wymagana): `start_change(session, nick, body.comment)`; `VersionConflict` → `session.rollback()` i `JSONResponse({"code": "version_conflict", "message": "Ktoś zapisał topo w międzyczasie", "current_version": exc.current}, 409)`; `None` → `session.rollback()`, `{"version": wall.version, "ids": {}}`; inaczej wynik.
- `revert_transaction`: po `_delete` → `bump_wall_versions(session, walls_touched(session, changes))` (przed `refresh_area_geom`).

**Algorytm `save_wall_lines`:**
1. `body.version != wall.version` → `VersionConflict(wall.version)`.
2. Walidacja (wszystko przed zmianami; `ApiError(422, "invalid_topo", <komunikat>)`): `ref` unikalne w całym ciele; `id` linii ∈ linie ściany, `id` punktu ∈ punkty **tej** linii; `route_id` ∈ drogi skały ściany; `route_ref` ∈ `new_routes`; `parent.line_*` wskazuje linię z ciała, `parent.point_*` — punkt tej linii z ciała; brak cykli w łańcuchu rodziców (komunikat „Wariant nie może pochodzić od samego siebie”).
3. Nowe drogi: `Route(crag_id=wall.crag_id, name=…, source="manual")` + `apply_grade`; `flush`.
4. Linie i punkty: dla każdej linii z ciała — istniejąca: `apply_fields(line, {"route_id", "sort_order", "color"})`, nowa: `RouteLine(wall=wall, …)`; punkty — istniejące `apply_fields(point, {"sort_order","x","y","kind","visible"})`, nowe `LinePoint(line=…)`; `flush`; zapis `ids[ref] = obj.id`.
5. Rodzice: dla każdej linii ustaw `parent_line_id`/`parent_point_id` z ciała (przez `apply_fields`, żeby nie tworzyć pustych wersji); `flush`.
6. Usunięcia: punkty istniejących linii nieobecne w ciele — najpierw odepnij linie spoza ciała wskazujące te punkty (`parent_line = None`, `parent_point = None`), potem `session.delete(point)`; linie ściany nieobecne w ciele → `delete_line(session, line)`; `flush`.
7. Brak jakiejkolwiek zmiany (licznik z `apply_fields`, nowych i usuniętych obiektów) → `None`.
8. `bump_wall_versions(session, [wall.id])`, `refresh_area_geom(session)`, `session.commit()`, `SaveResult(version=wall.version + 1, ids)` (odczyt po `session.refresh(wall)`).

- [ ] **Step 1: Testy `test_topo_edit.py`** (fikstura `editor`; dane przez fabryki z `api/tests/factories.py`, zatwierdzone przed wywołaniem API):
  - przesunięcie punktu i zmiana typu → 200, nowe `version = stara + 1`, `id` linii i punktów bez zmian, transakcja z autorem „ania” i komentarzem;
  - nowa linia z `ref` i nowa droga z `route_ref` w jednym zapisie → droga `source == "manual"` z `grade_sort`, linia wskazuje drogę, odpowiedź ma oba `ref` w `ids`, kolor linii z pasma;
  - wariant z `parent: {line_ref, point_ref}` do nowej linii → zapisany `parent_line_id`/`parent_point_id`;
  - linia nieobecna w ciele → usunięta (wersja `operation_type == 2`); jej wariant, obecny w ciele już bez `parent`, zostaje z `parent_line_id is None`;
  - **`test_delete_parent_point_detaches_variant`**: punkt rodzica wariantu usunięty, wariant w ciele bez `parent` → zapis przechodzi, wariant istnieje bez rodzica;
  - **`test_stale_version_conflict`**: `version` o 1 mniejsza → 409 `version_conflict`, `current_version` poprawne, w bazie nic się nie zmieniło, brak nowej transakcji;
  - zapis bez zmian → 200 z tą samą wersją, brak nowej transakcji;
  - walidacje 422: x = 1.2; `kind = "spit"`; linia z 1 punktem; `route_id` drogi innej skały; `id` punktu z innej ściany; cykl rodziców; zduplikowany `ref`;
  - bez sesji → 401; nieistniejąca ściana → 404;
  - historia: `transaction_changes` zawiera obiekty linii/punktów, a `GET /api/changes?crag=` streszcza je jako `topo`; brak obiektu `wall` w tej transakcji (wersja przez Core UPDATE).
- [ ] **Step 2: Test w `test_revert.py`** — **`test_revert_of_topo_save_bumps_version`**: zapis topo z nową drogą i linią, cofnięcie przez `POST /api/changes/{id}/revert` → linia i droga usunięte, `wall.version` o 1 większa niż po zapisie; zapis szkicu ze starą wersją → 409.
- [ ] **Step 3: Implementacja** według Interfaces i Algorytmu.
- [ ] **Step 4: Uruchom** `docker compose run --rm api pytest -q`.
- [ ] **Step 5: Commit** `feat: zapis topo ściany (PUT lines) z kontrolą wersji i historią`

---

### Task 6: Zapis z edytora — checkpoint, konflikt, logowanie

**Files:**
- Create: `web/src/editor/SaveBar.tsx`, `web/src/editor/ConflictTopoDialog.tsx`, `web/src/editor/save.test.tsx`
- Modify: `web/src/editor/EditorPage.tsx`, `README.md` (sekcja „Edycja”: edytor topo — skróty klawiszowe, wspólne punkty, szkic)

**Interfaces:**
- Consumes: `api.saveWallLines`, `toSaveBody`, `applySaved`, `countChanges`, `clearLocal`, `saveLocal` (Task 2); `useEditorMutation` (`successToast`, `invalidate`), `ApiError` (`code`, `body`).
- Produces: `SaveBar({ count, onSave(comment: string | null): void, pending })` — pole „Komentarz (opcjonalnie)…” i „Zapisz (n zmian)” (nieaktywny przy 0 albo gdy linia ma < 2 punkty — wtedy podpowiedź „Linia {numer} ma za mało punktów”); `ConflictTopoDialog({ onOpenLatest, onOverwrite, onCancel })`.

Zachowanie:
- „Zapisz” → `useEditorMutation(api.saveWallLines…, { invalidate: [["crag", slug], ["changes"], ["map"]], successToast: "Zapisano topo" })`; sukces → `load(applySaved(draft, result), image)` **bez czyszczenia stosu kroków** (checkpoint: dodaj w sklepie akcję `rebase(draft: Draft)` — podmienia `draft` i wszystkie stany w `pastStates`/`futureStates` przez `applySaved`, żeby cofnięcie po zapisie nie wskrzeszało nowych obiektów bez `id`), `clearLocal(wallId)` i od razu `saveLocal` nowej bazy nie jest potrzebne; licznik „n zmian” liczony względem ostatnio zapisanej bazy.
- 401 → logowanie i ponowienie (z `useEditorMutation`); edytor nie odmontowuje się (bramka `isEditor || reauthenticating`).
- 409 `version_conflict` → `ConflictTopoDialog` „Ktoś zapisał topo w międzyczasie”: „Otwórz najnowszą” (szkic zostaje w `localStorage`, `invalidate ["crag", slug]`, `load(draftFromWall(nowa ściana))`), „Nadpisz moją” (drugie potwierdzenie „Twoja wersja zastąpi zapisaną — na pewno?”, potem zapis z `version = current_version` z odpowiedzi), „Anuluj”.
- 422 → `toast.error(message)`, szkic zostaje.

- [ ] **Step 1: Testy `save.test.tsx`**: „Zapisz” wysyła `PUT` z ciałem z `toSaveBody` i komentarzem; po sukcesie licznik 0, `localStorage` bez szkicu, a `undo()` po zapisie cofa ostatni krok z prawdziwymi `id` (rebase); 409 → okienko, „Nadpisz moją” po potwierdzeniu wysyła drugi `PUT` z `version = current_version`; 401 → okienko logowania, po zalogowaniu ten sam `PUT`; linia z 1 punktem blokuje „Zapisz” z podpowiedzią.
- [ ] **Step 2: Implementacja** według Interfaces.
- [ ] **Step 3: Uruchom** `cd web; npm test`, `npx tsc -b`, `npm run build`, `docker compose run --rm api pytest -q`.
- [ ] **Step 4: Commit** `feat: zapis topo z edytora (checkpoint, konflikt wersji, logowanie)`
- [ ] **Step 5:** Dopisz „Wnioski z wykonania” na końcu tego planu (decyzje z oceny w Task 4 i poprawki) i zaktualizuj spec, jeśli użytkownik zmienił decyzję. Poproś użytkownika o przeklikanie całości (zapis, historia, cofnięcie, konflikt w dwóch kartach).
