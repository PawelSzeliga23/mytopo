# Plan 7c: edytor modelu 2.5D — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pełnoekranowy edytor modelu 2.5D ściany (pędzle z prototypu, operacje, kolory, przełącznik 2.5D, Ctrl+Z) z zapisem poprawionej głębi i segmentacji jako nowej wersji modelu w historii.

**Architecture:** Edytor pracuje na węzłach siatki widoku 2.5D (te same co `buildSurface`), zmiany trzyma jako łaty zmienionych węzłów (stos kroków). „Zapisz” wypieka węzły do rastrów rozmiaru oryginału i wysyła je multipartem; API zapisuje `model-{n}-depth.png` / `model-{n}-segments.png` obok zdjęcia i przestawia wersjonowane `wall.model_path` — widok 2.5D dostaje nowe adresy i nie wymaga zmian poza kolorami.

**Tech Stack:** FastAPI + Pillow + Continuum; React 19, @react-three/fiber + drei, three, fast-png (decode/encode), vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-plan-7c-edytor-2-5d-design.md`

## Global Constraints

- Teksty interfejsu po polsku, kod i komentarze po angielsku.
- Klasy segmentacji: 0 inne, 1 roślinność, 2 niebo, 3 skała, 4 podłoże; rysowane tylko 3 i 4.
- Siatka: `gridSize` z `web/src/crag/surface.ts` (dłuższy bok 384 oczka), węzły `(gx+1)·(gy+1)` wierszami od góry.
- Domyślne kolory hologramu: skała `#9ec2db`, podłoże `#949494`.
- Pliki nigdy nie są usuwane; oryginały workera (`depth.png`, `segments.png`) nietknięte.
- Testy pisane z kodem, uruchamiane na końcu zadania: `docker compose run --rm api pytest`, `cd web; npx vitest run; npx tsc -b; npx oxlint`. Bez E2E.
- Wykonanie inline na branchu `plan-7c-edytor-2-5d`; commit na zadanie z `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Wypieczony raster wczytany z powrotem przez `buildSurface` daje dokładnie te same węzły (test w Task 3).
- Zapis tylko kolorów / przełącznika (bez kroków) nie tworzy plików ani nowej wersji modelu (test w Task 2).
- Cofnięcie zapisu modelu przywraca poprzednią wersję i kolory (test w Task 2).
- Pędzel przy krawędzi siatki nie wychodzi poza tablice (test w Task 3).
- Edytor na ścianie bez segmentacji (`segments_url` null) działa jak widok: wszystko skała (test w Task 3).

---

### Task 1: Kolumny, `WallOut`, historia pól

**Files:**
- Create: `api/alembic/versions/0007_model_2_5d.py`
- Modify: `api/topo/models/wall.py`, `api/topo/schemas.py` (`WallOut`), `api/topo/api/crags.py` (`_wall_out`), `api/topo/changes.py` (`SKIP_FIELDS` bez `depth_enabled`), `api/topo/photos.py` (`set_photo` zeruje `model_path`), `api/topo/depth.py` (`model_number`, `model_files`)
- Test: `api/tests/test_api_model.py`

**Interfaces:**
- Produces: `Wall.model_path | rock_color | ground_color`; `depth.model_files(model_path) -> (depth_rel, segments_rel)`; `depth.model_number(model_path) -> int | None`; `WallOut.rock_color, ground_color, depth_enabled, model_version, original_depth_url, original_segments_url`.

- [ ] Migracja 0007 (wzorzec 0004: kolumny na `wall` i `wall_version`, nullable).
- [ ] `depth.py`:
```python
MODEL_PREFIX = "model-"

def model_files(model_path: str) -> tuple[str, str]:
    return f"{model_path}-depth.png", f"{model_path}-segments.png"

def model_number(model_path: str | None) -> int | None:
    return int(model_path.rsplit("-", 1)[1]) if model_path else None
```
- [ ] `_wall_out`: oryginały jak dotąd (`original_*`); `depth_url`/`segments_url` z `model_files(wall.model_path)` gdy `model_path` i głębia gotowa; `model_version=model_number(...)`; kolory, `depth_enabled`.
- [ ] `set_photo`: `wall.model_path = None`.
- [ ] Testy: `WallOut` z modelem i bez; podmiana zdjęcia zeruje `model_path`.
- [ ] `pytest` → PASS; commit `feat: kolumny modelu 2.5D i kolory ściany`.

### Task 2: `PUT /api/walls/{id}/model`

**Files:**
- Create: `api/topo/model_edit.py` (walidacja i zapis plików)
- Modify: `api/topo/api/walls.py`
- Test: `api/tests/test_api_model.py`

**Interfaces:**
- Consumes: Task 1.
- Produces: `PUT /api/walls/{id}/model` → 200 `{"model_version": int | None, "changed": [str]}`; 409 `{"code": "model_conflict", "current_model": int | None}`; 422 `no_depth` / `invalid_model`.

- [ ] Testy (fixture `media` jak w `test_api_photos.py`; ściana z `walls/{id}/1/display.webp`, oryginalnym `depth.png` 40×30 `I;16` i `segments.png` 40×30 `L`, `depth_status=ready`):
  - zapis plików → `model-1-depth.png`, `model-1-segments.png`, `model_path`, `WallOut.depth_url` na model, `original_depth_url` na `depth.png`, `model_version == 1`; drugi zapis z `base_model=1` → `model-2`;
  - `base_model` pusty przy `model_version == 1` → 409 `model_conflict`, `current_model == 1`;
  - zły rozmiar, 8-bit zamiast 16-bit głębi, klasa 7 w segmentacji, tylko jeden plik → 422 `invalid_model`;
  - ściana `depth_status=pending` → 422 `no_depth`;
  - tylko kolory i `depth_enabled=off` → bez plików, `model_path` bez zmian, `show_3d` false, `changed == ["depth_enabled", "ground_color", "rock_color"]`;
  - zły kolor `zielony` → 422;
  - nic się nie zmienia → 200, `changed == []`, brak nowej transakcji;
  - 401 bez logowania;
  - historia: diff `model_path` (None → `.../model-1`), cofnięcie przez `POST /api/changes/{id}/revert` przywraca `model_path` None i kolory.
- [ ] `model_edit.py`:
```python
def next_model_number(folder: Path) -> int  # 1 + max n z model-{n}-depth.png
def check_model(depth: bytes, segments: bytes, size: tuple[int, int]) -> None  # raises InvalidModel
def store_model(media_root: Path, wall: Wall, depth: bytes, segments: bytes) -> str  # returns model_path
```
`check_model`: Pillow; głębia tryb `I;16` (albo `I;16B`/`I` z wartościami ≤ 65535), segmentacja `L`, `max ≤ 4`, oba rozmiaru `size` (rozmiar oryginalnego `depth.png`).
- [ ] Endpoint: blokada wiersza, `start_change`, konflikt, walidacja, `apply_fields` dla kolorów i `depth_enabled`, zapis plików gdy są; `changed` puste → rollback.
- [ ] `pytest` → PASS; commit `feat: zapis modelu 2.5D z kontrolą konfliktu i historią`.

### Task 3: Logika edycji (front, czysta)

**Files:**
- Modify: `web/src/crag/surface.ts` (wydzielone `solidIndex(cls, gx, gy)`)
- Create: `web/src/model/grid.ts`, `web/src/model/grid.test.ts`

**Interfaces:**
- Produces:
```ts
export interface ModelGrid { gx: number; gy: number; depth: Float32Array; cls: Float32Array; origDepth: Float32Array; origCls: Float32Array; rasterWidth: number; rasterHeight: number }
export interface Patch { nodes: Uint32Array; before: { depth: Float32Array; cls: Float32Array }; after: { depth: Float32Array; cls: Float32Array } }
export type Brush = "flatten" | "erase" | "restore" | "rock" | "ground";
export function gridFromRasters(current: Raster, currentCls: Uint8Array | null, original: Raster, originalCls: Uint8Array | null): ModelGrid
export function brushNodes(grid, ci, cj, radius): number[]
export class Stroke { constructor(grid); apply(brush: Brush, ci: number, cj: number, radius: number): void; finish(): Patch | null }
export function smooth(grid): Patch | null
export function trimEdge(grid): Patch | null
export function applyPatch(grid, patch, direction: "undo" | "redo"): void
export function bake(grid): { depth: Uint16Array; cls: Uint8Array; width: number; height: number }
export function encodeModel(grid): { depth: Blob; segments: Blob }
```
- [ ] Testy: każdy pędzel zmienia tylko węzły w promieniu; „przywróć” wraca do oryginału; spłaszcz daje medianę pierścienia; `Stroke.finish` → łata z wartościami sprzed pierwszego dotknięcia; undo/redo łaty; `smooth` (pojedynczy kolec znika), `trimEdge` (brzeg skały → 0); pędzel przy brzegu; brak segmentacji → wszystko skała; `bake` → `decodeDepth/encode` → `buildSurface` daje te same węzły.
- [ ] `vitest` → PASS; commit `feat: logika edycji modelu 2.5D`.

### Task 4: Widok, API, historia, menu

**Files:**
- Modify: `web/src/lib/api.ts` (`WallOut` pola, `saveWallModel`), `web/src/crag/wall3dMaterials.ts` (`createHologramMaterial(rock?, ground?)`), `web/src/crag/Wall3D.tsx` (kolory ściany; eksport `FitCamera`, `RouteLines`), `web/src/history/format.ts` (+ test), `web/src/crag/edit/CragMenu.tsx` („Edytuj model 2.5D”), `web/src/test/fixtures.ts` (nowe pola), `web/src/editor/SaveBar.tsx` (prop `title`)
- [ ] `format.ts`: etykiety `model_path` „model 2.5D”, `rock_color` „kolor skały”, `ground_color` „kolor podłoża”, `depth_enabled` „2.5D”; wartości: model `oryginał`/`wersja n`, kolor pusty „domyślny”, `depth_enabled` null „auto”, true „zawsze”, false „nigdy” (przed ogólnym `—`).
- [ ] Testy formatowania; `vitest`, `tsc` → PASS; commit `feat: kolory ściany w widoku 2.5D, historia pól modelu`.

### Task 5: Strona edytora modelu

**Files:**
- Create: `web/src/model/ModelEditorPage.tsx`, `web/src/model/ModelCanvas.tsx`, `web/src/model/ModelEditorPage.test.tsx`
- Modify: `web/src/App.tsx` (trasa `/skaly/:slug/model/:wallId`)

- [ ] `ModelCanvas`: r3f `Canvas`, siatka z `ModelGrid` (atrybuty `position` z z=głębia·relief, `depth`, `cls`, `uv`, indeks `solidIndex`), niewidzialna pełna siatka do trafień (materiał `colorWrite: false`), `OrbitControls` tylko przy narzędziu „obracanie”, pędzel: `pointerdown` → `Stroke`, `pointermove` → `apply`, `pointerup` → `onStroke(patch)`; odświeżenie geometrii przez licznik `revision`; drogi (`RouteLines`) i `FitCamera` z `Wall3D`.
- [ ] `ModelEditorPage`: wczytanie (bieżące + oryginalne rastry przez `decodeDepth`/`decodeClasses`), stos kroków (`useRef` z listą łat, limit 100, indeks), skróty klawiszowe, panel (narzędzia, pędzel, Wygładź, Przytnij krawędź, hologram/zdjęcie, głębia, drogi, kolory z „domyślny”, 2.5D auto/zawsze/nigdy), `SaveButton` z tytułem „Zapisać model 2.5D?”, zapis `FormData` (pliki tylko gdy były kroki od zapisu), 409 → `ConfirmDialog` „Nadpisz moim”, wyjście z pytaniem, `beforeunload`.
- [ ] Test strony z `vi.mock("@/model/ModelCanvas")` (atrapa z przyciskiem „pociągnij”, który wywołuje `onStroke` łatą gumki): licznik zmian, ↶/↷, zapis (`PUT /api/walls/{id}/model`, `base_model`, pliki, kolory), 409 → „Nadpisz moim” wysyła ponownie z nową bazą, tylko kolor → bez plików.
- [ ] `vitest`, `tsc`, `oxlint` → PASS; commit `feat: edytor modelu 2.5D`.

### Task 6: Sprawdzenie, przegląd, wnioski

- [ ] Cały backend i front; `docker compose up -d api` (migracja); próba przez API na bazie dev (zapis modelu z rastrem z oryginału, historia, cofnięcie) i sprzątnięcie.
- [ ] Przegląd gałęzi, poprawki znalezisk z testem (RED→GREEN).
- [ ] „Wnioski z wykonania” w tym planie; pytanie o scalenie.
