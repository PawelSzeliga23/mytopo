# Plan 4: strona skały (widok 2D i lista dróg) oraz poprawki mapy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pełna strona skały w układzie A (zdjęcie ściany z liniami dróg i wpinkami, miniatury ścian, informacje o skale, lista dróg z numerami jak na topo, podświetlanie w obie strony) oraz poprawki mapy zgłoszone po planie 3 (sektory dłużej, obrysy zostają, bogatsza karta podglądu, powrót na mapę w to samo miejsce).

**Architecture:** Cała logika topo to czyste funkcje testowane w Vitest: numeracja linii na zdjęciu (`crag/topo.ts`), geometria widoku z przybliżaniem (`crag/view.ts`) i model sceny do narysowania (`crag/scene.ts`). Komponent `WallCanvas` (react-konva) tylko rysuje gotową scenę i obsługuje gesty; `WallViewer` obsługuje wczytywanie zdjęcia i rozmiar kontenera. Strona skały trzyma stan „wybrana / wskazana droga” i przekazuje go do zdjęcia i listy. Mapa zapisuje widok w adresie (`/#zoom/lat/lng`), więc powrót ze strony skały i odświeżenie strony zachowują widok. Zakres wycen liczy API dla skał, a front składa go dla sektorów i regionów (tak jak pasma trudności).

**Tech Stack:** jak w planie 3 (Vite 8, React 19, TypeScript, Tailwind 4, shadcn/ui, React Router 7, TanStack Query 5, MapLibre GL + react-map-gl 8, Vitest + Testing Library) oraz nowe: `konva` ^10 i `react-konva` ^19. API: FastAPI + PostGIS (pytest w Dockerze).

**Spec:** `docs/superpowers/specs/2026-10-08-frontend-design.md` §2 i §4 (wygląd, strona skały — układ A) oraz `docs/superpowers/specs/2026-10-08-topo-design.md` §6.2 i §6.4 (strona skały, widok 2D). Poprawki mapy: sekcja „Wnioski z wykonania” na końcu `docs/superpowers/plans/2026-10-08-plan-3-front-mapa.md`.

## Global Constraints

- Styl A „Przewodnik” jak w planie 3: tokeny z `web/src/index.css`, nagłówki i nazwy Fraunces (`font-display`), tekst IBM Plex Sans.
- Kolory pasm (linie, numerki): jasny `#3E8FB0`, `#2F4FA0`, `#B23A2B`, `#2B2420`; ciemny `#4FA8CC`, `#5C7BD6`, `#E0604E`, `#EDE3D2`. Plakietki wycen (tło / tekst) — jasny: `#D8E6EC`/`#245B72`, `#DCE1F0`/`#2F4FA0`, `#F2D9D4`/`#B23A2B`, `#2B2420`/`#F4ECDD`; ciemny: `#1F3A47`/`#8CCBE6`, `#262F4D`/`#A7B9F0`, `#4A2520`/`#F2A59A`, `#EDE3D2`/`#1D1916`. Brak wyceny: linia i numerek w kolorze `--ink` @ 65%, plakietka `--surface` / `--ink`.
- Numer na topo liczony **osobno dla każdego zdjęcia** z kolejności linii (`route_line.sort_order`); warianty jako „5a”, „5b” (numer linii, od której odchodzą, plus litera).
- Komputer (≥ 1024 px): dwie kolumny — lewa ~58% (ścieżka, nazwa, zdjęcie ściany, miniatury; kolumna przyklejona `sticky`), prawa (chipy, opis i dojście zwijane, lista dróg). Telefon: jedna kolumna, zdjęcie u góry; przy przewijaniu zwija się do paska ~30% wysokości ekranu i zostaje przyklejone u góry.
- Wiersz drogi: numerek w kółku (kolor pasma), nazwa (Fraunces 600), pod nią asekuracja · długość · autor; plakietka wyceny (krakowska + francuska) z prawej. Wybrana droga: tło `--surface` (`bg-secondary`), jej linia na zdjęciu pogrubiona; najechanie i kliknięcie działają w obie strony.
- Widok 2D: wygładzone linie (`tension`), ikony wpinek według typu, numery; przybliżanie kółkiem i dwoma palcami, przesuwanie. Przełącznik 2.5D/2D pojawi się w planie 5 — w tym planie jest tylko 2D.
- Wszystkie teksty po polsku, z poprawną odmianą liczebników (`countLabel`, `SKALY`, `DROGI`).
- Jedyne nowe zależności: `konva` ^10 i `react-konva` ^19.
- Front działa na hoście (`cd web; npm run dev`, port 5173), API w Dockerze (`localhost:8000`); testy API: `docker compose run --rm api pytest -q`.
- **Zasada testów:** testy pisane razem z kodem, uruchamiane raz na końcu zadania.

## Review Focus

1. **Ściana bez zdjęcia albo zdjęcie, które się nie wczyta** — w miejscu zdjęcia polski komunikat, lista dróg i reszta strony działają — Task 5 `WallViewer.test.tsx`.
2. **Wariant wariantu i uszkodzone dane (cykl `parent_line_id`, brak punktu odejścia)** — numeracja i ścieżka linii nie zawieszają strony i nie gubią linii — Task 4 `topo.test.ts`.
3. **Droga bez wyceny („projekt”)** — przygaszona linia i numerek, plakietka „—” z podpowiedzią „bez wyceny”, brak zakresu wycen zamiast „null – null” — Task 3 `grades.test.ts`, `GradeBadge.test.tsx`.
4. **Uszkodzony albo spoza zakresu fragment adresu mapy** (`#abc`, `#30/50/19`) — mapa startuje z widoku domyślnego zamiast się wywrócić — Task 2 `view.test.ts`.
5. **Strona skały otwarta bezpośrednio z linku (bez historii w aplikacji)** — „← Mapa” prowadzi na mapę wycentrowaną na skale, a nie poza aplikację — Task 6 `CragPage.test.tsx`.

---

## Struktura plików

```
api/topo/queries.py                  + zakres wycen w crag_summaries (Task 1)
api/topo/api/map.py, api/topo/schemas.py
api/tests/test_api_map.py
web/
├── package.json                     + konva, react-konva (Task 5)
└── src/
    ├── index.css                    + shadow-float, color-scheme (Task 2)
    ├── components/
    │   ├── GradeBadge.tsx           plakietka wyceny (Task 3)
    │   └── ui/drawer.tsx            font-display zamiast font-heading (Task 2)
    ├── lib/
    │   ├── api.ts                   pełne typy skały: ściany, linie, punkty, drogi (Task 3)
    │   ├── grades.ts                + BADGE_COLORS, bandColor, zakres wycen (Task 3)
    │   ├── aggregate.ts             + aggregateRanges, cragsByArea (Task 3)
    │   ├── routes.ts                compareRoutes (Task 3)
    │   ├── format.ts                formatDecimal (Task 6)
    │   ├── useElementSize.ts, useHtmlImage.ts   (Task 5)
    ├── map/
    │   ├── view.ts                  parseViewHash, formatViewHash (Task 2)
    │   ├── layers.ts                sektory do zoomu 15, obrysy bez górnej granicy (Task 2)
    │   ├── selection.ts, DetailCard.tsx, MapPage.tsx   (Task 2, 3)
    ├── crag/
    │   ├── topo.ts                  orderedLines, linePath, routeRows, labelTextColor (Task 4)
    │   ├── view.ts                  fitImage, clampView, zoomAt, panBy, toScreen (Task 4)
    │   ├── scene.ts                 buildScene (Task 5)
    │   ├── WallCanvas.tsx           rysowanie i gesty (react-konva) (Task 5)
    │   ├── WallViewer.tsx           wczytywanie zdjęcia, komunikaty (Task 5)
    │   ├── RouteList.tsx, WallThumbnails.tsx, CragInfo.tsx, useCompactOnScroll.ts   (Task 6)
    ├── pages/CragPage.tsx           pełna strona skały (Task 6)
    └── test/fixtures.ts             budowanie danych testowych skały (Task 4)
```

---

### Task 1: API — zakres wycen skał w danych mapy

**Files:**
- Modify: `api/topo/queries.py`, `api/topo/api/map.py`, `api/topo/schemas.py`
- Test: `api/tests/test_api_map.py`

**Interfaces:**
- Produces: `crag_summaries(...)` zwraca dodatkowo klucze `grade_min: str | None`, `grade_min_sort: int | None`, `grade_max: str | None`, `grade_max_sort: int | None` (najłatwiejsza i najtrudniejsza wyceniona droga skały według `grade_sort`; `None`, gdy skała nie ma dróg z wyceną). `GET /api/map/crags` ma te cztery pola w `properties`; `CragSummary` (w `GET /api/areas/{slug}`) też.

- [ ] **Step 1: Testy**

W `api/tests/test_api_map.py` na końcu `test_map_crags_with_grade_bands` dopisz:
```python
    assert (zabi["properties"]["grade_min"], zabi["properties"]["grade_max"]) == ("V+", "VI.5")
    assert zabi["properties"]["grade_min_sort"] < zabi["properties"]["grade_max_sort"]
    samotna = by_name["Samotna"]["properties"]
    assert (samotna["grade_min"], samotna["grade_max"]) == ("IV", "IV")
```

Na końcu pliku dodaj:
```python
def test_map_crag_without_graded_routes_has_no_range(client, session):
    region = f.area(session, "Dolina")
    crag = f.crag(session, region, "Projekty")
    f.route(session, crag, "P", grade=None)

    [feature] = client.get("/api/map/crags").json()["features"]
    props = feature["properties"]
    assert (props["grade_min"], props["grade_max"]) == (None, None)
    assert (props["grade_min_sort"], props["grade_max_sort"]) == (None, None)
```

- [ ] **Step 2: Implementacja**

W `api/topo/queries.py` w zapytaniu `crag_summaries` dopisz do SELECT (po `band3`, z przecinkiem po `AS band3`):
```sql
                   (array_agg(r.grade ORDER BY r.grade_sort, r.id) FILTER (WHERE r.grade_sort IS NOT NULL))[1] AS grade_min,
                   min(r.grade_sort)::int AS grade_min_sort,
                   (array_agg(r.grade ORDER BY r.grade_sort DESC, r.id) FILTER (WHERE r.grade_sort IS NOT NULL))[1] AS grade_max,
                   max(r.grade_sort)::int AS grade_max_sort
```
i do zwracanego słownika:
```python
            "grade_min": r["grade_min"],
            "grade_min_sort": r["grade_min_sort"],
            "grade_max": r["grade_max"],
            "grade_max_sort": r["grade_max_sort"],
```

W `api/topo/api/map.py` w `map_crags` rozszerz krotkę kluczy:
```python
                {key: c[key] for key in ("id", "name", "slug", "area_id", "in_sector", "area_kind", "route_count", "grade_bands", "grade_min", "grade_min_sort", "grade_max", "grade_max_sort")},
```

W `api/topo/schemas.py` w `CragSummary` dopisz pola:
```python
    grade_min: str | None
    grade_min_sort: int | None
    grade_max: str | None
    grade_max_sort: int | None
```

- [ ] **Step 3: Uruchom testy**

Run: `docker compose run --rm api pytest -q`
Expected: wszystkie PASS.

- [ ] **Step 4: Commit**

```powershell
git add api
git commit -m "feat: zakres wycen skał w danych mapy" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Mapa — sektory dłużej, obrysy zostają, widok w adresie, porządki

**Files:**
- Create: `web/src/map/view.ts`, `web/src/map/view.test.ts`
- Modify: `web/src/map/layers.ts`, `web/src/map/layers.test.ts`, `web/src/map/MapPage.tsx`, `web/src/index.css`, `web/src/components/ui/drawer.tsx`, `web/src/map/DetailCard.tsx`, `web/src/map/TopBar.tsx`, `web/src/map/LayerSwitcher.tsx`

**Interfaces:**
- Produces (`@/map/view`): `interface MapView { longitude: number; latitude: number; zoom: number }`, `parseViewHash(hash: string): MapView | null`, `formatViewHash(view: MapView): string` (format `#13.26/50.16614/19.76472` — zoom/lat/lng, jak w MapLibre).
- Produces: `ZOOM.sectorsUntil = 15`; warstwa `sector-outline` bez `maxzoom`; klasa Tailwind `shadow-float`.
- Kontrakt z Task 6: strona skały wraca na mapę przez `navigate(-1)` albo `navigate("/" + formatViewHash(...))`.

- [ ] **Step 1: Testy**

`web/src/map/view.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatViewHash, parseViewHash } from "@/map/view";

describe("widok mapy w adresie", () => {
  it("zapis i odczyt", () => {
    const hash = formatViewHash({ longitude: 19.764721, latitude: 50.166141, zoom: 13.256 });
    expect(hash).toBe("#13.26/50.16614/19.76472");
    expect(parseViewHash(hash)).toEqual({ longitude: 19.76472, latitude: 50.16614, zoom: 13.26 });
  });

  it.each(["", "#", "#abc", "#13/50", "#13/50/19/1", "#13//19", "#30/50/19", "#13/95/19", "#13/50/200", "#x/50/19"])(
    "zły fragment adresu %s → brak widoku",
    (hash) => {
      expect(parseViewHash(hash)).toBeNull();
    },
  );
});
```

W `web/src/map/layers.test.ts` zastąp test `"sektory widoczne w środkowym zakresie"` tym:
```ts
  it("sektory: wypełnienie i nazwy w środkowym zakresie, obrys zostaje przy dużym przybliżeniu", () => {
    const byId = Object.fromEntries(sectorLayers(colors).map((layer) => [layer.id ?? "", layer]));
    for (const id of ["sector-fill", "sector-outline", "sector-labels"]) {
      expect("minzoom" in byId[id] ? byId[id].minzoom : undefined).toBe(ZOOM.sectorsFrom);
    }
    expect("maxzoom" in byId["sector-fill"] ? byId["sector-fill"].maxzoom : undefined).toBe(ZOOM.sectorsUntil);
    expect("maxzoom" in byId["sector-labels"] ? byId["sector-labels"].maxzoom : undefined).toBe(ZOOM.sectorsUntil);
    expect("maxzoom" in byId["sector-outline"] ? byId["sector-outline"].maxzoom : undefined).toBeUndefined();
    expect(ZOOM.sectorsUntil).toBe(15);
  });
```

- [ ] **Step 2: Widok mapy w adresie**

`web/src/map/view.ts`:
```ts
export interface MapView {
  longitude: number;
  latitude: number;
  zoom: number;
}

/** "#13.26/50.16614/19.76472" (zoom/lat/lng, like MapLibre's own hash) → view, or null when malformed or out of range. */
export function parseViewHash(hash: string): MapView | null {
  const parts = hash.replace(/^#/, "").split("/");
  if (parts.length !== 3 || parts.some((part) => part.trim() === "")) return null;
  const [zoom, latitude, longitude] = parts.map(Number);
  if (![zoom, latitude, longitude].every(Number.isFinite)) return null;
  if (zoom < 0 || zoom > 22 || Math.abs(latitude) > 85 || Math.abs(longitude) > 180) return null;
  return { longitude, latitude, zoom };
}

export function formatViewHash({ longitude, latitude, zoom }: MapView): string {
  return `#${zoom.toFixed(2)}/${latitude.toFixed(5)}/${longitude.toFixed(5)}`;
}
```

W `web/src/map/MapPage.tsx`:
- import: `import { useLocation, useNavigate } from "react-router";` (zamiast samego `useNavigate`) i `import { formatViewHash, parseViewHash } from "@/map/view";`
- w komponencie, obok `navigate`:
```ts
  const location = useLocation();
  // The map view lives in the URL hash, so going back from a crag page (or reloading) restores it.
  const [initialView] = useState(() => parseViewHash(location.hash) ?? INITIAL_VIEW);
```
- w `<Map …>`: `initialViewState={initialView}` (zamiast `INITIAL_VIEW`) i nowy atrybut:
```tsx
        onMoveEnd={(event) => navigate({ hash: formatViewHash(event.viewState) }, { replace: true })}
```

- [ ] **Step 3: Sektory dłużej, obrysy zostają**

W `web/src/map/layers.ts` zmień `sectorsUntil: 14` na `sectorsUntil: 15`, a funkcję `sectorLayers` zastąp:
```ts
export function sectorLayers(c: MapColors): LayerProps[] {
  const { sectorsFrom: from, sectorsUntil: until } = ZOOM;
  const labelOpacity = e(["interpolate", ["linear"], ["zoom"], from, 0, from + 0.5, 1, until - 0.5, 1, until, 0]);
  const fillOpacity = e(["interpolate", ["linear"], ["zoom"], from, 0, from + 0.5, 0.35, until - 0.5, 0.35, until, 0]);
  return [
    {
      id: "sector-fill",
      type: "fill",
      minzoom: from,
      maxzoom: until,
      paint: { "fill-color": c.surface, "fill-opacity": fillOpacity },
    },
    // The outline stays at every closer zoom, so a sector's extent is visible next to its crags; only its name goes.
    {
      id: "sector-outline",
      type: "line",
      minzoom: from,
      paint: { "line-color": c.brand, "line-width": 1.2, "line-opacity": fadeIn(from) },
    },
    {
      id: "sector-labels",
      type: "symbol",
      minzoom: from,
      maxzoom: until,
      layout: { "text-field": e(["get", "name"]), "text-font": FONT, "text-size": 12 },
      paint: labelPaint(c, labelOpacity),
    },
  ];
}
```
(`isClickableAt` korzysta z `ZOOM.sectorsUntil`, więc próg klikania wypełnienia przesuwa się razem z nim.)

- [ ] **Step 4: Porządki z planu 3**

W `web/src/index.css`: w bloku `:root` dopisz `color-scheme: light;`, w bloku `.dark` dopisz `color-scheme: dark;`, a w bloku `@theme inline` dopisz:
```css
  --shadow-float: 0 4px 14px rgba(43, 36, 32, 0.18);
```
W `web/src/map/DetailCard.tsx`, `web/src/map/TopBar.tsx` i `web/src/map/LayerSwitcher.tsx` zastąp `shadow-[0_4px_14px_rgba(43,36,32,0.18)]` klasą `shadow-float`. W `web/src/components/ui/drawer.tsx` zastąp `font-heading` przez `font-display`.

- [ ] **Step 5: Uruchom testy i build**

Run: `cd web; npm test; npm run build`
Expected: wszystkie testy PASS, build bez błędów.

- [ ] **Step 6: Sprawdzenie ręczne**

`docker compose up -d`, `cd web; npm run dev`, otwórz http://localhost:5173:
- przybliż do sektora powyżej zoomu 15 — wypełnienie i nazwa sektora znikają, cienki obrys zostaje;
- przesuń mapę — w adresie pojawia się `#zoom/lat/lng`; odśwież stronę — widok ten sam;
- otwórz skałę („Otwórz skałę”), wróć przyciskiem przeglądarki — mapa w tym samym miejscu;
- wpisz ręcznie adres `http://localhost:5173/#abc` — mapa w widoku domyślnym.

- [ ] **Step 7: Commit**

```powershell
git add web
git commit -m "feat: sektory widoczne dłużej, widok mapy w adresie" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Bogatsza karta podglądu na mapie

**Files:**
- Create: `web/src/components/GradeBadge.tsx`, `web/src/components/GradeBadge.test.tsx`, `web/src/lib/routes.ts`
- Modify: `web/src/lib/api.ts`, `web/src/lib/grades.ts`, `web/src/lib/grades.test.ts`, `web/src/lib/aggregate.ts`, `web/src/lib/aggregate.test.ts`, `web/src/map/selection.ts`, `web/src/map/DetailCard.tsx`, `web/src/map/DetailCard.test.tsx`, `web/src/map/MapPage.tsx`

**Interfaces:**
- Consumes: pola `grade_min`, `grade_min_sort`, `grade_max`, `grade_max_sort` z `GET /api/map/crags` (Task 1); `GET /api/crags/{slug}` (bez zmian, już zwraca ściany, linie i drogi).
- Produces (`@/lib/api`): `CragProps` z polami zakresu; `type PointKind = "start" | "ring" | "hak" | "ucho" | "stanowisko" | "ogranicznik" | "przelot"`; `PointOut`, `LineOut`, `WallOut`, `RouteOut`; pełny `CragDetail` (z `formations`, `surroundings`, `approach_description`, `source`, `source_url`, `walls`, `routes`).
- Produces (`@/lib/grades`): `BADGE_COLORS: Record<Theme, [bg: string, fg: string][]>`, `UNGRADED_COLOR: Record<Theme, string>`, `bandColor(sort: number | null, theme: Theme): string`, `interface GradeRange { min: string; minSort: number; max: string; maxSort: number }`, `cragGradeRange(crag): GradeRange | null`, `mergeGradeRanges(a, b): GradeRange | null`, `formatGradeRange(range): string | null`.
- Produces (`@/lib/aggregate`): `aggregateRanges(sectors: AreaProps[], crags: CragProps[]): Map<number, GradeRange>`, `cragsByArea(sectors: AreaProps[], crags: CragProps[]): Map<number, CragProps[]>`.
- Produces (`@/lib/routes`): `compareRoutes(a: RouteOut, b: RouteOut): number` (numer drogi rosnąco, bez numeru na końcu, potem nazwa).
- Produces (`@/components/GradeBadge`): `GradeBadge({ grade: string | null; sort: number | null; french?: string | null })`.
- Produces (`@/map/selection`): `Selection = { type: "region" | "sektor"; area; bands; range: GradeRange | null; crags: CragProps[] } | { type: "crag"; crag }`.
- Produces (`@/map/DetailCard`): `DetailCardBody` i `DetailCard` z nowym propsem `onSelectCrag(crag: CragProps): void`.

Decyzja: w karcie skały lista dróg **bez numerów** — numer drogi zależy od zdjęcia (Global Constraints), więc w karcie byłby mylący; numery są na stronie skały.

- [ ] **Step 1: Testy**

W `web/src/lib/grades.test.ts` dopisz (z importami `bandColor`, `cragGradeRange`, `formatGradeRange`, `mergeGradeRanges` z `@/lib/grades`):
```ts
describe("zakres wycen", () => {
  const crag = (min: string | null, minSort: number | null, max: string | null, maxSort: number | null) => ({
    grade_min: min, grade_min_sort: minSort, grade_max: max, grade_max_sort: maxSort,
  });

  it("formatuje zakres", () => {
    expect(formatGradeRange(cragGradeRange(crag("V", 80, "VI.3", 160)))).toBe("V – VI.3");
    expect(formatGradeRange(cragGradeRange(crag("IV", 60, "IV", 60)))).toBe("IV");
    expect(formatGradeRange(cragGradeRange(crag(null, null, null, null)))).toBeNull();
  });

  it("łączy zakresy", () => {
    const merged = mergeGradeRanges(cragGradeRange(crag("V", 80, "VI.1", 120)), cragGradeRange(crag("IV", 60, "VI.3", 160)));
    expect(formatGradeRange(merged)).toBe("IV – VI.3");
    expect(mergeGradeRanges(null, null)).toBeNull();
  });

  it("kolor pasma, a bez wyceny przygaszony atrament", () => {
    expect(bandColor(150, "light")).toBe("#B23A2B");
    expect(bandColor(null, "dark")).toBe("rgba(237,227,210,0.65)");
  });
});
```

`web/src/components/GradeBadge.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GradeBadge } from "@/components/GradeBadge";
import { ThemeProvider } from "@/lib/theme";

describe("GradeBadge", () => {
  it("kolory pasma i wycena francuska", () => {
    render(<ThemeProvider><GradeBadge grade="VI.2+" sort={146} french="6c+" /></ThemeProvider>);
    const badge = screen.getByText("VI.2+");
    expect(badge).toHaveStyle({ backgroundColor: "#F2D9D4", color: "#B23A2B" });
    expect(screen.getByText("6c+")).toBeInTheDocument();
  });

  it("bez wyceny: kreska i podpowiedź", () => {
    render(<ThemeProvider><GradeBadge grade={null} sort={null} /></ThemeProvider>);
    expect(screen.getByTitle("bez wyceny")).toHaveTextContent("—");
  });
});
```

W `web/src/lib/aggregate.test.ts` zmień pomocnika `crag` tak, żeby przyjmował zakres (i zaktualizuj import):
```ts
import { aggregateBands, aggregateRanges, cragsByArea } from "@/lib/aggregate";
import { formatGradeRange } from "@/lib/grades";

const crag = (
  id: number, area_id: number, area_kind: CragProps["area_kind"], grade_bands: number[],
  range: [string, number, string, number] | null = null,
): CragProps => ({
  id, name: `C${id}`, slug: `c${id}`, area_id, area_kind, in_sector: area_kind === "sektor", route_count: 0, grade_bands,
  grade_min: range?.[0] ?? null, grade_min_sort: range?.[1] ?? null, grade_max: range?.[2] ?? null, grade_max_sort: range?.[3] ?? null,
});
```
i dopisz:
```ts
describe("aggregateRanges i cragsByArea", () => {
  const sectors = [area(10, "sektor", 1)];
  const crags = [
    crag(100, 10, "sektor", [1, 0, 0, 0], ["V", 80, "VI.1", 120]),
    crag(101, 10, "sektor", [0, 0, 0, 0]),
    crag(102, 1, "region", [0, 0, 1, 0], ["IV", 60, "VI.3", 160]),
  ];

  it("zakres sektora i regionu (z sektorami)", () => {
    const ranges = aggregateRanges(sectors, crags);
    expect(formatGradeRange(ranges.get(10) ?? null)).toBe("V – VI.1");
    expect(formatGradeRange(ranges.get(1) ?? null)).toBe("IV – VI.3");
  });

  it("skały sektora i regionu", () => {
    const byArea = cragsByArea(sectors, crags);
    expect(byArea.get(10)?.map((c) => c.id)).toEqual([100, 101]);
    expect(byArea.get(1)?.map((c) => c.id).sort()).toEqual([100, 101, 102]);
  });
});
```

`web/src/map/DetailCard.test.tsx` — zastąp cały plik:
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AreaProps, CragProps, RouteOut } from "@/lib/api";
import { ThemeProvider } from "@/lib/theme";
import { DetailCard, DetailCardBody } from "@/map/DetailCard";

vi.mock("@/lib/useMediaQuery", () => ({ useIsDesktop: () => false }));
// vaul unmounts immediately in jsdom (no animations), so render the drawer content unconditionally to check what DetailCard passes to it.
vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  DrawerDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

const region: AreaProps = {
  id: 1, name: "Dolina Kobylańska", slug: "dolina-kobylanska", kind: "region", parent_id: 34,
  crag_count: 49, route_count: 645, center: [19.75, 50.15], bbox: [19.7, 50.1, 19.8, 50.2],
};
const crag: CragProps = {
  id: 7, name: "Żabi Koń", slug: "zabi-kon", area_id: 102, area_kind: "sektor", in_sector: true,
  route_count: 1, grade_bands: [1, 0, 0, 0], grade_min: "V", grade_min_sort: 80, grade_max: "VI.3", grade_max_sort: 160,
};
const route = (id: number, number: number, name: string): RouteOut => ({
  id, number, name, grade: "VI.1", grade_fr: "6b", grade_sort: 120, length_m: null, protection: null,
  first_ascent: null, year: null, description: null,
});

function stubCrag(routes: RouteOut[]) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ routes, walls: [] })))));
}

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const providers = (node: ReactNode) => (
    <ThemeProvider>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </ThemeProvider>
  );
  const view = render(providers(ui));
  return { rerender: (node: ReactNode) => view.rerender(providers(node)) };
}

const handlers = () => ({ onZoom: vi.fn(), onOpenCrag: vi.fn(), onSelectCrag: vi.fn() });

beforeEach(() => stubCrag([]));
afterEach(() => vi.unstubAllGlobals());

describe("DetailCardBody", () => {
  it("region: liczby po polsku i przybliżanie", async () => {
    const props = handlers();
    wrap(<DetailCardBody selection={{ type: "region", area: region, bands: [5, 4, 3, 1], range: null, crags: [] }} {...props} />);
    expect(screen.getByText("Region")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dolina Kobylańska" })).toBeInTheDocument();
    expect(screen.getByText("49 skał")).toBeInTheDocument();
    expect(screen.getByText("645 dróg")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Przybliż" }));
    expect(props.onZoom).toHaveBeenCalledWith([19.7, 50.1, 19.8, 50.2]);
  });

  it("region: zakres wycen i lista skał", async () => {
    const props = handlers();
    const crags = Array.from({ length: 10 }, (_, i) => ({ ...crag, id: 100 + i, name: `Skała ${i}`, route_count: i }));
    const range = { min: "IV", minSort: 60, max: "VI.3", maxSort: 160 };
    wrap(<DetailCardBody selection={{ type: "region", area: region, bands: [1, 1, 1, 1], range, crags }} {...props} />);
    expect(screen.getByText("IV – VI.3")).toBeInTheDocument();
    const buttons = within(screen.getByRole("list", { name: "Skały" })).getAllByRole("button");
    expect(buttons).toHaveLength(8);
    expect(buttons[0]).toHaveTextContent("Skała 9");
    expect(screen.getByText("i jeszcze 2 skały")).toBeInTheDocument();
    await userEvent.click(buttons[0]);
    expect(props.onSelectCrag).toHaveBeenCalledWith(crags[9]);
  });

  it("skała: zakres wycen, pierwsze drogi i przejście do reszty", async () => {
    stubCrag(Array.from({ length: 10 }, (_, i) => route(i + 1, 10 - i, `Droga ${10 - i}`)));
    const props = handlers();
    wrap(<DetailCardBody selection={{ type: "crag", crag }} {...props} />);
    expect(screen.getByText("Skała")).toBeInTheDocument();
    expect(screen.getByText("1 droga")).toBeInTheDocument();
    expect(screen.getByText("V – VI.3")).toBeInTheDocument();
    const items = within(await screen.findByRole("list", { name: "Drogi" })).getAllByRole("listitem");
    expect(items).toHaveLength(8);
    expect(items[0]).toHaveTextContent("Droga 1");
    await userEvent.click(screen.getByRole("button", { name: "i jeszcze 2 drogi →" }));
    expect(props.onOpenCrag).toHaveBeenCalledWith("zabi-kon");
    await userEvent.click(screen.getByRole("button", { name: "Otwórz skałę" }));
    expect(props.onOpenCrag).toHaveBeenCalledTimes(2);
  });
});

describe("DetailCard (telefon)", () => {
  it("zachowuje treść karty podczas zamykania szuflady", () => {
    const props = { onClose: vi.fn(), ...handlers() };
    const view = wrap(<DetailCard selection={{ type: "crag", crag }} {...props} />);
    expect(screen.getByRole("heading", { name: "Żabi Koń" })).toBeInTheDocument();
    view.rerender(<DetailCard selection={null} {...props} />);
    expect(screen.getByRole("heading", { name: "Żabi Koń" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Typy API**

W `web/src/lib/api.ts`:
- w `CragProps` po `grade_bands` dopisz:
```ts
  grade_min: string | null;
  grade_min_sort: number | null;
  grade_max: string | null;
  grade_max_sort: number | null;
```
- przed `CragDetail` dodaj:
```ts
export type PointKind = "start" | "ring" | "hak" | "ucho" | "stanowisko" | "ogranicznik" | "przelot";

export interface PointOut {
  id: number;
  sort_order: number;
  /** 0–1, relative to the photo */
  x: number;
  y: number;
  kind: PointKind;
  visible: boolean;
}

export interface LineOut {
  id: number;
  route_id: number | null;
  color: string;
  sort_order: number;
  parent_line_id: number | null;
  parent_point_id: number | null;
  points: PointOut[];
}

export interface WallOut {
  id: number;
  name: string | null;
  description: string | null;
  sort_order: number;
  version: number;
  image_url: string | null;
  thumb_url: string | null;
  image_width: number | null;
  image_height: number | null;
  depth_url: string | null;
  depth_status: string;
  depth_model: string | null;
  lines: LineOut[];
}

export interface RouteOut {
  id: number;
  number: number | null;
  name: string;
  grade: string | null;
  grade_fr: string | null;
  grade_sort: number | null;
  length_m: number | null;
  protection: string | null;
  first_ascent: string | null;
  year: number | null;
  description: string | null;
}
```
- w `CragDetail` po `child_friendly` dopisz `formations: string[];` i `surroundings: string | null;`, a po `description` dopisz:
```ts
  approach_description: string | null;
  source: string;
  source_url: string | null;
  walls: WallOut[];
  routes: RouteOut[];
```

- [ ] **Step 3: Wyceny, zakres, kolejność dróg**

Do `web/src/lib/grades.ts` dopisz (import `import type { CragProps } from "@/lib/api";`):
```ts
/** Grade badge colours [background, text] per band — spec §2.1. */
export const BADGE_COLORS: Record<Theme, [bg: string, fg: string][]> = {
  light: [["#D8E6EC", "#245B72"], ["#DCE1F0", "#2F4FA0"], ["#F2D9D4", "#B23A2B"], ["#2B2420", "#F4ECDD"]],
  dark: [["#1F3A47", "#8CCBE6"], ["#262F4D", "#A7B9F0"], ["#4A2520", "#F2A59A"], ["#EDE3D2", "#1D1916"]],
};

/** Lines and numbers of routes without a grade: --ink at 65%. */
export const UNGRADED_COLOR: Record<Theme, string> = { light: "rgba(43,36,32,0.65)", dark: "rgba(237,227,210,0.65)" };

export function bandColor(sort: number | null, theme: Theme): string {
  const band = gradeBand(sort);
  return band === null ? UNGRADED_COLOR[theme] : BAND_COLORS[theme][band];
}

export interface GradeRange {
  min: string;
  minSort: number;
  max: string;
  maxSort: number;
}

type RangeFields = Pick<CragProps, "grade_min" | "grade_min_sort" | "grade_max" | "grade_max_sort">;

export function cragGradeRange(crag: RangeFields): GradeRange | null {
  const { grade_min: min, grade_min_sort: minSort, grade_max: max, grade_max_sort: maxSort } = crag;
  if (min === null || minSort === null || max === null || maxSort === null) return null;
  return { min, minSort, max, maxSort };
}

export function mergeGradeRanges(a: GradeRange | null, b: GradeRange | null): GradeRange | null {
  if (!a) return b;
  if (!b) return a;
  const low = b.minSort < a.minSort ? b : a;
  const high = b.maxSort > a.maxSort ? b : a;
  return { min: low.min, minSort: low.minSort, max: high.max, maxSort: high.maxSort };
}

/** "V – VI.3", a single grade when both ends match, null when nothing is graded. */
export function formatGradeRange(range: GradeRange | null): string | null {
  if (!range) return null;
  return range.min === range.max ? range.min : `${range.min} – ${range.max}`;
}
```

`web/src/lib/routes.ts`:
```ts
import type { RouteOut } from "@/lib/api";

/** Route order on lists: by route number (routes without one last), then by name. */
export function compareRoutes(a: RouteOut, b: RouteOut): number {
  return (a.number ?? Infinity) - (b.number ?? Infinity) || a.name.localeCompare(b.name, "pl");
}
```

Do `web/src/lib/aggregate.ts` dopisz (importy: `import { cragGradeRange, mergeGradeRanges, type GradeRange } from "@/lib/grades";`):
```ts
/** Grade range per area, built the same way as aggregateBands. */
export function aggregateRanges(sectors: AreaProps[], crags: CragProps[]): Map<number, GradeRange> {
  const ranges = new Map<number, GradeRange>();
  const merge = (id: number, range: GradeRange | null) => {
    const merged = mergeGradeRanges(ranges.get(id) ?? null, range);
    if (merged) ranges.set(id, merged);
  };
  for (const crag of crags) merge(crag.area_id, cragGradeRange(crag));
  for (const sector of sectors) {
    const own = ranges.get(sector.id);
    if (own && sector.parent_id !== null) merge(sector.parent_id, own);
  }
  return ranges;
}

/** Crags listed in an area's card: its own crags plus, for a region, the crags of its sectors. */
export function cragsByArea(sectors: AreaProps[], crags: CragProps[]): Map<number, CragProps[]> {
  const byArea = new Map<number, CragProps[]>();
  const push = (id: number, items: CragProps[]) => byArea.set(id, [...(byArea.get(id) ?? []), ...items]);
  for (const crag of crags) push(crag.area_id, [crag]);
  for (const sector of sectors) {
    const own = byArea.get(sector.id);
    if (own && sector.parent_id !== null) push(sector.parent_id, own);
  }
  return byArea;
}
```

`web/src/components/GradeBadge.tsx`:
```tsx
import { BADGE_COLORS, gradeBand } from "@/lib/grades";
import { useTheme } from "@/lib/theme";

export function GradeBadge({ grade, sort, french }: { grade: string | null; sort: number | null; french?: string | null }) {
  const { theme } = useTheme();
  const band = gradeBand(sort);
  const colors = band === null ? null : BADGE_COLORS[theme][band];
  return (
    <span
      title={grade === null ? "bez wyceny" : undefined}
      className={`inline-flex shrink-0 items-baseline gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${colors ? "" : "bg-secondary text-foreground"}`}
      style={colors ? { backgroundColor: colors[0], color: colors[1] } : undefined}
    >
      {grade ?? "—"}
      {french && <span className="font-normal opacity-75">{french}</span>}
    </span>
  );
}
```

- [ ] **Step 4: Karta**

`web/src/map/selection.ts`:
```ts
import type { AreaProps, CragProps } from "@/lib/api";
import type { GradeRange } from "@/lib/grades";

export type Selection =
  | { type: "region" | "sektor"; area: AreaProps; bands: number[]; range: GradeRange | null; crags: CragProps[] }
  | { type: "crag"; crag: CragProps };
```

W `web/src/map/DetailCard.tsx`:
- importy dodatkowe:
```ts
import { useQuery } from "@tanstack/react-query";
import { GradeBadge } from "@/components/GradeBadge";
import { api, type CragProps } from "@/lib/api";
import { cragGradeRange, formatGradeRange } from "@/lib/grades";
import { compareRoutes } from "@/lib/routes";
```
- `BodyProps` dostaje `onSelectCrag: (crag: CragProps) => void;`, a nad `DetailCardBody` dodaj:
```tsx
const PREVIEW_LIMIT = 8;

function CragRoutesPreview({ slug, onOpen }: { slug: string; onOpen: () => void }) {
  // Same query key as the crag page, so opening the crag afterwards is instant.
  const { data, isPending, isError } = useQuery({ queryKey: ["crag", slug], queryFn: () => api.crag(slug) });
  if (isPending) return <p className="text-xs text-muted-foreground">Wczytywanie dróg…</p>;
  if (isError) return <p className="text-xs text-muted-foreground">Nie udało się wczytać listy dróg.</p>;
  const routes = [...data.routes].sort(compareRoutes);
  if (routes.length === 0) return null;
  const rest = routes.length - PREVIEW_LIMIT;
  return (
    <div className="flex flex-col">
      <ul aria-label="Drogi" className="flex flex-col divide-y divide-border text-sm">
        {routes.slice(0, PREVIEW_LIMIT).map((route) => (
          <li key={route.id} className="flex items-center justify-between gap-2 py-1">
            <span className="truncate font-display font-semibold">{route.name}</span>
            <GradeBadge grade={route.grade} sort={route.grade_sort} />
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <button type="button" onClick={onOpen} className="mt-1 self-start text-xs font-semibold text-brand hover:underline">
          {`i jeszcze ${countLabel(rest, DROGI)} →`}
        </button>
      )}
    </div>
  );
}

function AreaCragList({ crags, onSelect }: { crags: CragProps[]; onSelect: (crag: CragProps) => void }) {
  if (crags.length === 0) return null;
  const sorted = [...crags].sort((a, b) => b.route_count - a.route_count || a.name.localeCompare(b.name, "pl"));
  const rest = sorted.length - PREVIEW_LIMIT;
  return (
    <div className="flex flex-col">
      <ul aria-label="Skały" className="flex flex-col divide-y divide-border text-sm">
        {sorted.slice(0, PREVIEW_LIMIT).map((crag) => (
          <li key={crag.id}>
            <button type="button" onClick={() => onSelect(crag)} className="flex w-full items-center justify-between gap-2 py-1 text-left hover:text-brand">
              <span className="truncate font-display font-semibold">{crag.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{countLabel(crag.route_count, DROGI)}</span>
            </button>
          </li>
        ))}
      </ul>
      {rest > 0 && <p className="mt-1 text-xs text-muted-foreground">{`i jeszcze ${countLabel(rest, SKALY)}`}</p>}
    </div>
  );
}
```
- `DetailCardBody` zastąp:
```tsx
export function DetailCardBody({ selection, onZoom, onOpenCrag, onSelectCrag }: BodyProps) {
  const name = selection.type === "crag" ? selection.crag.name : selection.area.name;
  const range = formatGradeRange(selection.type === "crag" ? cragGradeRange(selection.crag) : selection.range);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{KIND_LABEL[selection.type]}</p>
      <h2 className="pr-6 font-display text-2xl font-extrabold leading-tight tracking-tight">{name}</h2>
      <div className="flex flex-wrap gap-1.5">
        {selection.type === "crag" ? (
          <Chip>{countLabel(selection.crag.route_count, DROGI)}</Chip>
        ) : (
          <>
            <Chip>{countLabel(selection.area.crag_count, SKALY)}</Chip>
            <Chip>{countLabel(selection.area.route_count, DROGI)}</Chip>
          </>
        )}
        {range && <Chip>{range}</Chip>}
      </div>
      <GradeBar bands={selection.type === "crag" ? selection.crag.grade_bands : selection.bands} />
      {selection.type === "crag" ? (
        <>
          <CragRoutesPreview slug={selection.crag.slug} onOpen={() => onOpenCrag(selection.crag.slug)} />
          <Button className="mt-2" onClick={() => onOpenCrag(selection.crag.slug)}>
            Otwórz skałę
          </Button>
        </>
      ) : (
        <>
          <AreaCragList crags={selection.crags} onSelect={onSelectCrag} />
          <Button className="mt-2" onClick={() => onZoom(selection.area.bbox)}>
            Przybliż
          </Button>
        </>
      )}
    </div>
  );
}
```
- w `DetailCard`: destrukturyzuj też `onSelectCrag` i przekazuj go do obu `DetailCardBody`; panel na komputerze (`<aside …>`) dostaje dodatkowo klasy `max-h-[calc(100vh-1.5rem)] overflow-y-auto`, a `DrawerContent` klasę `max-h-[85vh]` i treść owiniętą w `<div className="overflow-y-auto">…</div>`.

W `web/src/map/MapPage.tsx`:
- importy: `aggregateRanges, cragsByArea` z `@/lib/aggregate` (obok `aggregateBands`); `CragProps` jest już importowany.
- pod `bands`:
```ts
  const ranges = useMemo(
    () => aggregateRanges([...index.sectors.values()], [...index.crags.values()]),
    [index],
  );
  const cragLists = useMemo(
    () => cragsByArea([...index.sectors.values()], [...index.crags.values()]),
    [index],
  );
  const cragCenters = useMemo(
    () => new globalThis.Map((crags?.features ?? []).map((feature) => [feature.properties.id, feature.geometry.coordinates as [number, number]])),
    [crags],
  );
```
- w `handleClick` wybór obszaru:
```ts
      if (area) {
        setSelection({
          type: area.kind === "sektor" ? "sektor" : "region",
          area,
          bands: bands.get(id) ?? [0, 0, 0, 0],
          range: ranges.get(id) ?? null,
          crags: cragLists.get(id) ?? [],
        });
      }
```
- pod `zoomTo`:
```ts
  function selectCrag(crag: CragProps) {
    setSelection({ type: "crag", crag });
    const center = cragCenters.get(crag.id);
    const map = mapRef.current;
    if (center && map) map.flyTo({ center, zoom: Math.max(map.getZoom(), 15), duration: 800 });
  }
```
- `<DetailCard … onSelectCrag={selectCrag} />`.

- [ ] **Step 5: Uruchom testy i build**

Run: `cd web; npm test; npm run build`
Expected: wszystkie PASS, build bez błędów (`tsc -b` sprawdza też pliki testów — obiekty `CragProps` w testach mają mieć nowe pola).

- [ ] **Step 6: Sprawdzenie ręczne**

Przy działającym API i `npm run dev`: kliknij region — karta ma zakres wycen i listę skał (najwięcej dróg u góry); kliknij skałę z listy — mapa leci do skały, karta pokazuje zakres i drogi; „i jeszcze N dróg →” otwiera stronę skały.

- [ ] **Step 7: Commit**

```powershell
git add web
git commit -m "feat: zakres wycen, drogi i skały w karcie podglądu mapy" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Logika topo — numeracja, ścieżki linii, lista dróg, geometria widoku

**Files:**
- Create: `web/src/crag/topo.ts`, `web/src/crag/topo.test.ts`, `web/src/crag/view.ts`, `web/src/crag/view.test.ts`, `web/src/test/fixtures.ts`

**Interfaces:**
- Consumes: typy `CragDetail`, `WallOut`, `LineOut`, `PointOut`, `RouteOut`, `PointKind` (Task 3); `gradeBand` (`@/lib/grades`), `compareRoutes` (`@/lib/routes`), `Theme`.
- Produces (`@/crag/topo`):
  - `orderedLines(wall: WallOut): { line: LineOut; label: string }[]` — linie zdjęcia w kolejności topo z numerami („1”, „2”, „2a”…)
  - `linePath(line: LineOut, lines: Map<number, LineOut>): PointOut[]` — dla wariantu: punkty linii nadrzędnej do punktu odejścia + własne
  - `interface RouteRow { route: RouteOut; label: string | null; lineId: number | null; wallId: number | null }`, `interface RouteRows { onWall: RouteRow[]; other: RouteRow[] }`, `routeRows(crag: CragDetail, wallId: number | null): RouteRows`
  - `labelTextColor(sort: number | null, theme: Theme): string`
- Produces (`@/crag/view`): `interface Size { width; height }`, `interface Point { x; y }`, `interface View { zoom; x; y }`, `MAX_ZOOM = 5`, `IDENTITY: View`, `fitImage(container, image)`, `clampView(view, container)`, `zoomAt(view, at, factor, container)`, `panBy(view, dx, dy, container)`, `toScreen(point, image, container, view)`.
- Produces (`@/test/fixtures`): `pt`, `ln`, `makeWall`, `makeRoute`, `makeCrag` (dane testowe dla Task 5 i 6).

- [ ] **Step 1: Dane testowe**

`web/src/test/fixtures.ts`:
```ts
import type { CragDetail, LineOut, PointKind, PointOut, RouteOut, WallOut } from "@/lib/api";

export const pt = (id: number, x: number, y: number, kind: PointKind = "ring"): PointOut => ({
  id, sort_order: id, x, y, kind, visible: kind !== "start" && kind !== "przelot",
});

export function ln(id: number, sortOrder: number, routeId: number | null, points: PointOut[], parent: [lineId: number, pointId: number] | null = null): LineOut {
  return {
    id, route_id: routeId, color: "#FF0000", sort_order: sortOrder,
    parent_line_id: parent?.[0] ?? null, parent_point_id: parent?.[1] ?? null, points,
  };
}

export function makeWall(id: number, lines: LineOut[], extra: Partial<WallOut> = {}): WallOut {
  return {
    id, name: null, description: null, sort_order: 0, version: 1,
    image_url: `/media/walls/${id}/display.webp`, thumb_url: `/media/walls/${id}/thumb.webp`,
    image_width: 100, image_height: 100, depth_url: null, depth_status: "pending", depth_model: null, lines, ...extra,
  };
}

export function makeRoute(id: number, name: string, extra: Partial<RouteOut> = {}): RouteOut {
  return {
    id, number: id, name, grade: "VI.1", grade_fr: "6b", grade_sort: 120, length_m: null, protection: null,
    first_ascent: null, year: null, description: null, ...extra,
  };
}

export function makeCrag(walls: WallOut[], routes: RouteOut[], extra: Partial<CragDetail> = {}): CragDetail {
  return {
    id: 44, name: "Brzuchata Turniczka", slug: "brzuchata-turniczka",
    path: [
      { id: 1, name: "Jura Krakowsko Częstochowska", slug: "jura", kind: "obszar" },
      { id: 2, name: "Dolina Kobylańska", slug: "dolina-kobylanska", kind: "region" },
    ],
    lng: 19.764721, lat: 50.166141, rock_type: "wapień", height_min: 10, height_max: 10, aspects: ["N"],
    formations: [], approach_minutes: 5, child_friendly: true, surroundings: null, description: null,
    approach_description: null, source: "portalgorski", source_url: "https://topo.portalgorski.pl/skala,365",
    walls, routes, ...extra,
  };
}
```

- [ ] **Step 2: Testy**

`web/src/crag/topo.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { labelTextColor, linePath, orderedLines, routeRows } from "@/crag/topo";
import type { LineOut } from "@/lib/api";
import { ln, makeCrag, makeRoute, makeWall, pt } from "@/test/fixtures";

// Like "Zjazdowa Turnia": route 2 has two variants, one of them branching off the other.
const lines: LineOut[] = [
  ln(139, 30, 6, [pt(50, 0.8, 0.9, "start"), pt(51, 0.8, 0.5)]),
  ln(135, 10, 1, [pt(1, 0.1, 0.9, "start"), pt(2, 0.1, 0.5)]),
  ln(136, 20, 2, [pt(10, 0.4, 0.9, "start"), pt(11, 0.4, 0.6), pt(12, 0.4, 0.4), pt(13, 0.4, 0.2, "stanowisko")]),
  ln(137, 21, 3, [pt(20, 0.4, 0.4), pt(21, 0.5, 0.2)], [136, 12]),
  ln(138, 22, 4, [pt(30, 0.4, 0.6), pt(31, 0.3, 0.3)], [136, 11]),
  ln(146, 23, 5, [pt(40, 0.5, 0.2), pt(41, 0.6, 0.1)], [137, 21]),
];
const wall = makeWall(20, lines);
const byId = new Map(lines.map((line) => [line.id, line]));

describe("orderedLines", () => {
  it("numery według kolejności linii, warianty z literą", () => {
    expect(orderedLines(wall).map(({ line, label }) => [line.id, label])).toEqual([
      [135, "1"], [136, "2"], [137, "2a"], [138, "2b"], [146, "2c"], [139, "3"],
    ]);
  });

  it("cykl wariantów nie zawiesza numeracji i nie gubi linii", () => {
    const broken = makeWall(1, [ln(1, 10, 1, [pt(1, 0, 0)], [2, 2]), ln(2, 20, 2, [pt(2, 0, 0)], [1, 1])]);
    expect(orderedLines(broken)).toHaveLength(2);
  });
});

describe("linePath", () => {
  it("wariant zaczyna się od linii nadrzędnej do punktu odejścia, bez powtórzonego punktu", () => {
    expect(linePath(byId.get(137)!, byId).map((point) => point.id)).toEqual([10, 11, 12, 21]);
    expect(linePath(byId.get(146)!, byId).map((point) => point.id)).toEqual([10, 11, 12, 21, 41]);
  });

  it("linia bez wariantu albo bez punktu odejścia: tylko własne punkty", () => {
    expect(linePath(byId.get(135)!, byId).map((point) => point.id)).toEqual([1, 2]);
    const orphan = ln(150, 40, 7, [pt(60, 0.2, 0.2)], [136, 999]);
    expect(linePath(orphan, byId).map((point) => point.id)).toEqual([60]);
  });

  it("cykl nie zawiesza ścieżki", () => {
    const a = ln(1, 10, 1, [pt(1, 0, 0)], [2, 2]);
    const b = ln(2, 20, 2, [pt(2, 0.5, 0.5)], [1, 1]);
    expect(linePath(a, new Map([[1, a], [2, b]])).length).toBeGreaterThan(0);
  });
});

describe("routeRows", () => {
  const other = makeWall(21, [ln(200, 10, 7, [pt(70, 0.5, 0.9, "start"), pt(71, 0.5, 0.5)]), ln(201, 20, 6, [pt(72, 0.7, 0.9, "start")])], { name: "Prawa ściana" });
  const routes = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => makeRoute(id, `Droga ${id}`));
  const crag = makeCrag([wall, other], routes);

  it("drogi zdjęcia w kolejności topo, pozostałe ze ścianą, na której są", () => {
    const rows = routeRows(crag, 20);
    expect(rows.onWall.map((row) => [row.route.id, row.label])).toEqual([[1, "1"], [2, "2"], [3, "2a"], [4, "2b"], [5, "2c"], [6, "3"]]);
    expect(rows.onWall.every((row) => row.wallId === 20)).toBe(true);
    expect(rows.other.map((row) => [row.route.id, row.label, row.wallId])).toEqual([[7, null, 21], [8, null, null]]);
  });

  it("ta sama droga ma inny numer na innym zdjęciu", () => {
    const rows = routeRows(crag, 21);
    expect(rows.onWall.map((row) => [row.route.id, row.label])).toEqual([[7, "1"], [6, "2"]]);
  });

  it("skała bez zdjęć: wszystkie drogi bez numerów", () => {
    const rows = routeRows(makeCrag([], routes), null);
    expect(rows.onWall).toEqual([]);
    expect(rows.other.map((row) => row.wallId)).toEqual(Array(8).fill(null));
  });
});

describe("labelTextColor", () => {
  it("ciemny tekst tylko na jasnym kółku w ciemnym motywie", () => {
    expect(labelTextColor(210, "dark")).toBe("#1D1916");
    expect(labelTextColor(null, "dark")).toBe("#1D1916");
    expect(labelTextColor(210, "light")).toBe("#FFFFFF");
    expect(labelTextColor(120, "dark")).toBe("#FFFFFF");
  });
});
```

`web/src/crag/view.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { clampView, fitImage, IDENTITY, panBy, toScreen, zoomAt, type View } from "@/crag/view";

const box = { width: 800, height: 400 };

function near(view: View, zoom: number, x: number, y: number) {
  expect(view.zoom).toBeCloseTo(zoom);
  expect(view.x).toBeCloseTo(x);
  expect(view.y).toBeCloseTo(y);
}

describe("dopasowanie zdjęcia", () => {
  it("pionowe zdjęcie w poziomym kontenerze: całe widoczne, wyśrodkowane", () => {
    expect(fitImage(box, { width: 1000, height: 2000 })).toEqual({ scale: 0.2, x: 300, y: 0 });
  });

  it("punkt 0–1 na ekranie", () => {
    expect(toScreen({ x: 0.5, y: 1 }, { width: 1000, height: 2000 }, box, IDENTITY)).toEqual({ x: 400, y: 400 });
  });
});

describe("przybliżanie i przesuwanie", () => {
  it("punkt pod kursorem zostaje na miejscu", () => {
    near(zoomAt(IDENTITY, { x: 200, y: 100 }, 2, box), 2, -200, -100);
  });

  it("zakres przybliżenia 1–5", () => {
    near(zoomAt(IDENTITY, { x: 400, y: 200 }, 0.5, box), 1, 0, 0);
    near(zoomAt({ zoom: 4, x: -1000, y: -500 }, { x: 0, y: 0 }, 4, box), 5, -1250, -625);
  });

  it("nie da się wyjechać poza zdjęcie ani przesunąć przy przybliżeniu 1", () => {
    near(clampView({ zoom: 2, x: 100, y: -9999 }, box), 2, 0, -400);
    near(panBy(IDENTITY, 50, 50, box), 1, 0, 0);
    near(panBy({ zoom: 2, x: -100, y: -100 }, -50, 20, box), 2, -150, -80);
  });
});
```

- [ ] **Step 3: Implementacja**

`web/src/crag/topo.ts`:
```ts
import type { CragDetail, LineOut, PointOut, RouteOut, WallOut } from "@/lib/api";
import { gradeBand } from "@/lib/grades";
import { compareRoutes } from "@/lib/routes";
import type { Theme } from "@/lib/theme";

export interface RouteRow {
  route: RouteOut;
  /** Number on the current photo ("3", "5a"); null when the route has no line on it. */
  label: string | null;
  lineId: number | null;
  /** Photo to show when the row is chosen: the current one, the first other photo with the route, or null (no topo). */
  wallId: number | null;
}

export interface RouteRows {
  onWall: RouteRow[];
  other: RouteRow[];
}

const byOrder = (a: LineOut, b: LineOut) => a.sort_order - b.sort_order || a.id - b.id;
const letter = (index: number) => (index < 26 ? String.fromCharCode(97 + index) : `z${index - 25}`);

/** The top-level line a variant branches from, following parents on this photo; stops on broken data (cycles, missing parents). */
function rootOf(line: LineOut, lines: Map<number, LineOut>): LineOut {
  const seen = new Set<number>();
  let current = line;
  while (current.parent_line_id !== null && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = lines.get(current.parent_line_id);
    if (!parent) break;
    current = parent;
  }
  return current;
}

/** Lines of a photo in topo order: top-level lines numbered 1, 2, 3… by sort_order; variants get their root's number plus a letter (5a, 5b). */
export function orderedLines(wall: WallOut): { line: LineOut; label: string }[] {
  const lines = new Map(wall.lines.map((line) => [line.id, line]));
  const groups = new Map<number, LineOut[]>();
  for (const line of [...wall.lines].sort(byOrder)) {
    const root = rootOf(line, lines);
    groups.set(root.id, [...(groups.get(root.id) ?? []), line]);
  }
  const roots = wall.lines.filter((line) => groups.has(line.id)).sort(byOrder);
  return roots.flatMap((root, index) => {
    const number = String(index + 1);
    const variants = (groups.get(root.id) ?? []).filter((line) => line.id !== root.id);
    return [{ line: root, label: number }, ...variants.map((line, i) => ({ line, label: `${number}${letter(i)}` }))];
  });
}

const samePoint = (a: PointOut, b: PointOut) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/** Points of the whole climb: a variant starts with its parent's points up to the branch point. */
export function linePath(line: LineOut, lines: Map<number, LineOut>, seen = new Set<number>()): PointOut[] {
  if (line.parent_line_id === null || line.parent_point_id === null || seen.has(line.id)) return line.points;
  seen.add(line.id);
  const parent = lines.get(line.parent_line_id);
  if (!parent) return line.points;
  const trunk = linePath(parent, lines, seen);
  const branchAt = trunk.findIndex((point) => point.id === line.parent_point_id);
  if (branchAt === -1) return line.points;
  const head = trunk.slice(0, branchAt + 1);
  const own = line.points.length > 0 && samePoint(line.points[0], head[head.length - 1]) ? line.points.slice(1) : line.points;
  return [...head, ...own];
}

/** Rows of the route list for the shown photo: its routes in topo order, then the crag's other routes. */
export function routeRows(crag: CragDetail, wallId: number | null): RouteRows {
  const routes = new Map(crag.routes.map((route) => [route.id, route]));
  const onWall: RouteRow[] = [];
  const shown = new Set<number>();
  const wall = crag.walls.find((candidate) => candidate.id === wallId);
  if (wall) {
    for (const { line, label } of orderedLines(wall)) {
      const route = line.route_id === null ? undefined : routes.get(line.route_id);
      if (!route || shown.has(route.id)) continue;
      shown.add(route.id);
      onWall.push({ route, label, lineId: line.id, wallId: wall.id });
    }
  }
  const firstWall = new Map<number, number>();
  for (const candidate of crag.walls) {
    for (const line of candidate.lines) {
      if (line.route_id !== null && !firstWall.has(line.route_id)) firstWall.set(line.route_id, candidate.id);
    }
  }
  const other = crag.routes
    .filter((route) => !shown.has(route.id))
    .sort(compareRoutes)
    .map((route) => ({ route, label: null, lineId: null, wallId: firstWall.get(route.id) ?? null }));
  return { onWall, other };
}

/** Text on a numbered circle: white, except on the pale circles of the dark theme (≥ VI.5 and ungraded). */
export function labelTextColor(sort: number | null, theme: Theme): string {
  const band = gradeBand(sort);
  return theme === "dark" && (band === 3 || band === null) ? "#1D1916" : "#FFFFFF";
}
```

`web/src/crag/view.ts`:
```ts
export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Zoom and pan applied on top of the fitted photo; zoom 1 shows the whole photo. */
export interface View {
  zoom: number;
  x: number;
  y: number;
}

export const MAX_ZOOM = 5;
export const IDENTITY: View = { zoom: 1, x: 0, y: 0 };

/** Scale and offset that fit the whole photo in the container, centred (object-fit: contain). */
export function fitImage(container: Size, image: Size): { scale: number; x: number; y: number } {
  const scale = Math.min(container.width / image.width, container.height / image.height);
  return { scale, x: (container.width - image.width * scale) / 2, y: (container.height - image.height * scale) / 2 };
}

/** Keeps the zoomed content over the container: no panning past its edges, none at zoom 1. */
export function clampView(view: View, container: Size): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom));
  const minX = container.width * (1 - zoom);
  const minY = container.height * (1 - zoom);
  return { zoom, x: Math.min(0, Math.max(minX, view.x)), y: Math.min(0, Math.max(minY, view.y)) };
}

/** Zooms by `factor`, keeping the screen point `at` in place. */
export function zoomAt(view: View, at: Point, factor: number, container: Size): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom * factor));
  const ratio = zoom / view.zoom;
  return clampView({ zoom, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio }, container);
}

export function panBy(view: View, dx: number, dy: number, container: Size): View {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, container);
}

/** Photo-relative point (0–1) → position in the stage, in pixels. */
export function toScreen(point: Point, image: Size, container: Size, view: View): Point {
  const fit = fitImage(container, image);
  return {
    x: view.x + view.zoom * (fit.x + point.x * image.width * fit.scale),
    y: view.y + view.zoom * (fit.y + point.y * image.height * fit.scale),
  };
}
```

- [ ] **Step 4: Uruchom testy i build**

Run: `cd web; npm test; npm run build`
Expected: wszystkie PASS, build bez błędów.

- [ ] **Step 5: Commit**

```powershell
git add web
git commit -m "feat: numeracja dróg na zdjęciu, ścieżki wariantów i geometria widoku ściany" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Przeglądarka ściany 2D (react-konva)

**Files:**
- Create: `web/src/crag/scene.ts`, `web/src/crag/scene.test.ts`, `web/src/crag/WallCanvas.tsx`, `web/src/crag/WallViewer.tsx`, `web/src/crag/WallViewer.test.tsx`, `web/src/lib/useElementSize.ts`, `web/src/lib/useHtmlImage.ts`
- Modify: `web/package.json`, `web/package-lock.json` (przez `npm install`)

**Interfaces:**
- Consumes: `orderedLines`, `linePath`, `labelTextColor` (Task 4), `toScreen`, `zoomAt`, `panBy`, `clampView`, `IDENTITY`, `View`, `Size`, `Point` (Task 4), `bandColor` (Task 3), `useTheme`.
- Produces (`@/crag/scene`): `interface SceneMark { x; y; kind: PointKind }`, `interface SceneLine { lineId; routeId: number | null; points: number[]; color: string; emphasis: "normal" | "dim" | "hover" | "selected"; marks: SceneMark[]; label: { x; y; text; fill; textColor } | null }`, `buildScene(args): SceneLine[]`.
- Produces (`@/crag/WallViewer`): `interface WallViewerProps { wall: WallOut; routes: Map<number, RouteOut>; selectedRouteId: number | null; hoveredRouteId: number | null; onSelectRoute(routeId: number | null): void; onHoverRoute(routeId: number | null): void; className?: string; style?: CSSProperties }`, `WallViewer(props)`.
- Produces: `useElementSize(ref): Size`, `useHtmlImage(url: string | null): { image: HTMLImageElement | null; status: ImageStatus }`, `type ImageStatus = "loading" | "loaded" | "failed"`.

Uwaga: Konva nie działa w jsdom, dlatego cała logika rysowania jest w czystej funkcji `buildScene` (testowanej), `WallCanvas` tylko ją rysuje, a testy `WallViewer` podmieniają `WallCanvas` i `useHtmlImage`. Rysowanie i gesty sprawdzamy ręcznie (Step 6).

- [ ] **Step 1: Zależności**

Run: `cd web; npm install konva@^10 react-konva@^19`

- [ ] **Step 2: Testy**

`web/src/crag/scene.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildScene } from "@/crag/scene";
import { IDENTITY } from "@/crag/view";
import { BAND_COLORS, UNGRADED_COLOR } from "@/lib/grades";
import { ln, makeRoute, makeWall, pt } from "@/test/fixtures";

// 100×100 photo in a 100×100 stage: photo coordinates × 100 = stage pixels.
const wall = makeWall(20, [
  ln(1, 10, 1, [pt(1, 0.1, 0.9, "start"), pt(2, 0.1, 0.5)]),
  ln(2, 20, 2, [pt(10, 0.4, 0.9, "start"), pt(11, 0.4, 0.6), pt(12, 0.4, 0.4, "stanowisko")]),
  ln(3, 21, 3, [pt(20, 0.4, 0.6), pt(21, 0.6, 0.25)], [2, 11]),
  ln(4, 30, null, [pt(30, 0.8, 0.9, "start"), pt(31, 0.8, 0.5)]),
]);
const routes = new Map([
  [1, makeRoute(1, "A", { grade_sort: 80 })],
  [2, makeRoute(2, "B", { grade_sort: 150 })],
  [3, makeRoute(3, "C", { grade: null, grade_sort: null })],
]);
const base = { wall, routes, image: { width: 100, height: 100 }, container: { width: 100, height: 100 }, view: IDENTITY, theme: "light" as const };

describe("buildScene", () => {
  it("linie w kolejności topo, numery, kolory pasm", () => {
    const scene = buildScene({ ...base, selectedRouteId: null, hoveredRouteId: null });
    expect(scene.map((line) => line.label?.text)).toEqual(["1", "2", "2a", "3"]);
    expect(scene[0]).toMatchObject({ lineId: 1, points: [10, 90, 10, 50], color: BAND_COLORS.light[0], emphasis: "normal" });
    expect(scene[0].label).toMatchObject({ x: 10, y: 90, fill: BAND_COLORS.light[0], textColor: "#FFFFFF" });
    expect(scene[2].color).toBe(UNGRADED_COLOR.light);
  });

  it("wpinki tylko widoczne, numer wariantu obok punktu odejścia", () => {
    const scene = buildScene({ ...base, selectedRouteId: null, hoveredRouteId: null });
    expect(scene[1].marks).toEqual([{ x: 40, y: 60, kind: "ring" }, { x: 40, y: 40, kind: "stanowisko" }]);
    expect(scene[2].label).toMatchObject({ x: 56, y: 60 });
  });

  it("wybrana droga na wierzchu z całą ścieżką, pozostałe przygaszone", () => {
    const scene = buildScene({ ...base, selectedRouteId: 3, hoveredRouteId: 1 });
    expect(scene.map((line) => [line.lineId, line.emphasis])).toEqual([[2, "dim"], [4, "dim"], [1, "hover"], [3, "selected"]]);
    expect(scene[3].points).toEqual([40, 90, 40, 60, 60, 25]);
  });
});
```

`web/src/crag/WallViewer.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WallViewer } from "@/crag/WallViewer";
import type { ImageStatus } from "@/lib/useHtmlImage";
import { makeWall } from "@/test/fixtures";

const imageState = vi.hoisted(() => ({ current: { image: null as HTMLImageElement | null, status: "loading" as ImageStatus } }));
vi.mock("@/lib/useHtmlImage", () => ({ useHtmlImage: () => imageState.current }));
vi.mock("@/lib/useElementSize", () => ({ useElementSize: () => ({ width: 400, height: 300 }) }));
vi.mock("@/crag/WallCanvas", () => ({ WallCanvas: () => <div data-testid="canvas" /> }));

const props = { routes: new Map(), selectedRouteId: null, hoveredRouteId: null, onSelectRoute: vi.fn(), onHoverRoute: vi.fn() };

describe("WallViewer", () => {
  it("ściana bez zdjęcia", () => {
    render(<WallViewer wall={makeWall(1, [], { image_url: null })} {...props} />);
    expect(screen.getByText("Brak zdjęcia tej ściany.")).toBeInTheDocument();
  });

  it("zdjęcie, które się nie wczytało", () => {
    imageState.current = { image: null, status: "failed" };
    render(<WallViewer wall={makeWall(1, [])} {...props} />);
    expect(screen.getByText("Nie udało się wczytać zdjęcia.")).toBeInTheDocument();
  });

  it("wczytywanie, potem rysunek", () => {
    imageState.current = { image: null, status: "loading" };
    const view = render(<WallViewer wall={makeWall(1, [])} {...props} />);
    expect(screen.getByText("Wczytywanie zdjęcia…")).toBeInTheDocument();
    imageState.current = { image: document.createElement("img"), status: "loaded" };
    view.rerender(<WallViewer wall={makeWall(1, [])} {...props} />);
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Scena i hooki**

`web/src/crag/scene.ts`:
```ts
import { labelTextColor, linePath, orderedLines } from "@/crag/topo";
import { toScreen, type Point, type Size, type View } from "@/crag/view";
import type { PointKind, RouteOut, WallOut } from "@/lib/api";
import { bandColor } from "@/lib/grades";
import type { Theme } from "@/lib/theme";

export interface SceneMark {
  x: number;
  y: number;
  kind: PointKind;
}

export interface SceneLine {
  lineId: number;
  routeId: number | null;
  /** Flat [x0, y0, x1, y1, …] in stage pixels. */
  points: number[];
  color: string;
  emphasis: "normal" | "dim" | "hover" | "selected";
  marks: SceneMark[];
  label: { x: number; y: number; text: string; fill: string; textColor: string } | null;
}

interface SceneArgs {
  wall: WallOut;
  routes: Map<number, RouteOut>;
  image: Size;
  container: Size;
  view: View;
  theme: Theme;
  selectedRouteId: number | null;
  hoveredRouteId: number | null;
}

/** A variant's number sits beside its branch point (a bolt of the parent line), not on top of it. */
const VARIANT_LABEL_OFFSET = 16;
const PAINT_ORDER = { dim: 0, normal: 1, hover: 2, selected: 3 } as const;

/** Everything the 2D viewer draws for one photo, in stage pixels and paint order (emphasised lines last, on top). */
export function buildScene({ wall, routes, image, container, view, theme, selectedRouteId, hoveredRouteId }: SceneArgs): SceneLine[] {
  const lines = new Map(wall.lines.map((line) => [line.id, line]));
  const screen = (point: Point) => toScreen(point, image, container, view);
  const scene = orderedLines(wall).map(({ line, label }): SceneLine => {
    const sort = line.route_id === null ? null : (routes.get(line.route_id)?.grade_sort ?? null);
    const color = bandColor(sort, theme);
    const emphasis: SceneLine["emphasis"] =
      line.route_id !== null && line.route_id === selectedRouteId
        ? "selected"
        : line.route_id !== null && line.route_id === hoveredRouteId
          ? "hover"
          : selectedRouteId !== null
            ? "dim"
            : "normal";
    // Only an emphasised variant repeats its parent's trunk; otherwise the trunk would be overdrawn in several colours.
    const path = emphasis === "selected" || emphasis === "hover" ? linePath(line, lines) : line.points;
    const first = line.points[0];
    const offset = line.parent_line_id === null ? 0 : VARIANT_LABEL_OFFSET;
    const at = first ? screen(first) : null;
    return {
      lineId: line.id,
      routeId: line.route_id,
      points: path.flatMap((point) => {
        const { x, y } = screen(point);
        return [x, y];
      }),
      color,
      emphasis,
      marks: line.points.filter((point) => point.visible).map((point) => ({ ...screen(point), kind: point.kind })),
      label: at ? { x: at.x + offset, y: at.y, text: label, fill: color, textColor: labelTextColor(sort, theme) } : null,
    };
  });
  return scene.sort((a, b) => PAINT_ORDER[a.emphasis] - PAINT_ORDER[b.emphasis]);
}
```

`web/src/lib/useElementSize.ts`:
```ts
import { useEffect, useState, type RefObject } from "react";

export function useElementSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
```

`web/src/lib/useHtmlImage.ts`:
```ts
import { useEffect, useState } from "react";

export type ImageStatus = "loading" | "loaded" | "failed";

interface Loaded {
  url: string;
  image: HTMLImageElement | null;
  status: ImageStatus;
}

export function useHtmlImage(url: string | null): { image: HTMLImageElement | null; status: ImageStatus } {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (!url) return;
    let active = true;
    const image = new window.Image();
    image.onload = () => {
      if (active) setLoaded({ url, image, status: "loaded" });
    };
    image.onerror = () => {
      if (active) setLoaded({ url, image: null, status: "failed" });
    };
    image.src = url;
    return () => {
      active = false;
    };
  }, [url]);
  if (!url) return { image: null, status: "failed" };
  return loaded?.url === url ? { image: loaded.image, status: loaded.status } : { image: null, status: "loading" };
}
```

- [ ] **Step 4: Rysowanie i gesty**

`web/src/crag/WallCanvas.tsx`:
```tsx
import type Konva from "konva";
import { useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, RegularPolygon, Stage, Text } from "react-konva";
import { buildScene, type SceneLine, type SceneMark } from "@/crag/scene";
import { clampView, IDENTITY, panBy, toScreen, zoomAt, type Point, type Size, type View } from "@/crag/view";
import type { RouteOut, WallOut } from "@/lib/api";
import { useTheme } from "@/lib/theme";

interface WallCanvasProps {
  image: HTMLImageElement;
  wall: WallOut;
  routes: Map<number, RouteOut>;
  size: Size;
  selectedRouteId: number | null;
  hoveredRouteId: number | null;
  onSelectRoute: (routeId: number | null) => void;
  onHoverRoute: (routeId: number | null) => void;
}

const WIDTH = { normal: 3, dim: 2.5, hover: 5, selected: 6 } as const;
const OPACITY = { normal: 1, dim: 0.35, hover: 1, selected: 1 } as const;
const HALO = "rgba(0,0,0,0.45)";
const WHEEL_STEP = 1.2;
/** Pointer travel (px) after which a gesture counts as a drag, not a click. */
const DRAG_THRESHOLD = 4;

type KonvaEvent = Konva.KonvaEventObject<MouseEvent | TouchEvent>;

const center = (points: Point[]) => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
});
const spread = ([a, b]: Point[]) => Math.hypot(a.x - b.x, a.y - b.y);

function Mark({ mark, color }: { mark: SceneMark; color: string }) {
  const common = { x: mark.x, y: mark.y, listening: false };
  switch (mark.kind) {
    case "stanowisko":
      return <Circle {...common} radius={5} fill={color} stroke="#FFFFFF" strokeWidth={1.5} />;
    case "hak":
      return <RegularPolygon {...common} sides={3} radius={5} fill="#FFFFFF" stroke={color} strokeWidth={1.5} />;
    case "ucho":
      return <Circle {...common} radius={4} stroke="#FFFFFF" strokeWidth={2} />;
    case "ogranicznik":
      return <Rect x={mark.x - 6} y={mark.y - 1.5} width={12} height={3} fill="#FFFFFF" stroke={color} strokeWidth={1} listening={false} />;
    default:
      return <Circle {...common} radius={3.5} fill="#FFFFFF" stroke={color} strokeWidth={1.5} />;
  }
}

export function WallCanvas({ image, wall, routes, size, selectedRouteId, hoveredRouteId, onSelectRoute, onHoverRoute }: WallCanvasProps) {
  const { theme } = useTheme();
  const [rawView, setView] = useState<View>(IDENTITY);
  const view = clampView(rawView, size);
  const gesture = useRef<{ last: Point; spread: number | null; travel: number } | null>(null);
  const dragged = useRef(false);

  const imageSize = { width: image.naturalWidth || wall.image_width || 1, height: image.naturalHeight || wall.image_height || 1 };
  const scene = buildScene({ wall, routes, image: imageSize, container: size, view, theme, selectedRouteId, hoveredRouteId });
  const topLeft = toScreen({ x: 0, y: 0 }, imageSize, size, view);
  const bottomRight = toScreen({ x: 1, y: 1 }, imageSize, size, view);

  function pointsOf(event: KonvaEvent): Point[] {
    const stage = event.target.getStage();
    if (!stage) return [];
    if ("touches" in event.evt) {
      const rect = stage.container().getBoundingClientRect();
      return Array.from(event.evt.touches).map((touch) => ({ x: touch.clientX - rect.left, y: touch.clientY - rect.top }));
    }
    const pointer = stage.getPointerPosition();
    return pointer ? [pointer] : [];
  }

  function start(points: Point[]) {
    if (points.length === 0) return;
    gesture.current = { last: center(points), spread: points.length > 1 ? spread(points) : null, travel: 0 };
    dragged.current = false;
  }

  function move(event: KonvaEvent) {
    const state = gesture.current;
    const points = pointsOf(event);
    if (!state || points.length === 0) return;
    const mid = center(points);
    const dx = mid.x - state.last.x;
    const dy = mid.y - state.last.y;
    const ratio = state.spread !== null && points.length > 1 ? spread(points) / state.spread : 1;
    if (view.zoom > 1 || points.length > 1) event.evt.preventDefault();
    setView((current) => zoomAt(panBy(current, dx, dy, size), mid, ratio, size));
    state.travel += Math.hypot(dx, dy);
    if (state.travel > DRAG_THRESHOLD) dragged.current = true;
    state.last = mid;
    if (points.length > 1) state.spread = spread(points);
  }

  function end(event: KonvaEvent) {
    const remaining = pointsOf(event);
    if (remaining.length > 0) start(remaining);
    else gesture.current = null;
  }

  function chooseLine(routeId: number | null, event: Konva.KonvaEventObject<Event>) {
    event.cancelBubble = true;
    if (dragged.current || routeId === null) return;
    onSelectRoute(routeId === selectedRouteId ? null : routeId);
  }

  const lineHandlers = (item: SceneLine) => ({
    onClick: (event: Konva.KonvaEventObject<Event>) => chooseLine(item.routeId, event),
    onTap: (event: Konva.KonvaEventObject<Event>) => chooseLine(item.routeId, event),
    onMouseEnter: () => onHoverRoute(item.routeId),
    onMouseLeave: () => onHoverRoute(null),
  });

  const zoomButton = (factor: number) => setView((current) => zoomAt(current, { x: size.width / 2, y: size.height / 2 }, factor, size));

  return (
    <>
      <Stage
        width={size.width}
        height={size.height}
        style={{ cursor: hoveredRouteId !== null ? "pointer" : view.zoom > 1 ? "grab" : "default" }}
        onWheel={(event) => {
          event.evt.preventDefault();
          const pointer = event.target.getStage()?.getPointerPosition();
          if (pointer) setView((current) => zoomAt(current, pointer, event.evt.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, size));
        }}
        onMouseDown={(event) => start(pointsOf(event))}
        onMouseMove={(event) => {
          if (gesture.current) move(event);
        }}
        onMouseUp={() => {
          gesture.current = null;
        }}
        onMouseLeave={() => {
          gesture.current = null;
        }}
        onTouchStart={(event) => start(pointsOf(event))}
        onTouchMove={move}
        onTouchEnd={end}
        onClick={() => {
          if (!dragged.current) onSelectRoute(null);
        }}
        onTap={() => {
          if (!dragged.current) onSelectRoute(null);
        }}
        onDblClick={() => setView(IDENTITY)}
        onDblTap={() => setView(IDENTITY)}
      >
        <Layer>
          <KonvaImage image={image} x={topLeft.x} y={topLeft.y} width={bottomRight.x - topLeft.x} height={bottomRight.y - topLeft.y} />
          {scene.map((item) => (
            <Group key={item.lineId} opacity={OPACITY[item.emphasis]}>
              <Line points={item.points} stroke={HALO} strokeWidth={WIDTH[item.emphasis] + 3} tension={0.3} lineCap="round" lineJoin="round" listening={false} />
              <Line points={item.points} stroke={item.color} strokeWidth={WIDTH[item.emphasis]} tension={0.3} lineCap="round" lineJoin="round" hitStrokeWidth={18} {...lineHandlers(item)} />
              {item.marks.map((mark, index) => (
                <Mark key={index} mark={mark} color={item.color} />
              ))}
              {item.label && (
                <Group x={item.label.x} y={item.label.y} {...lineHandlers(item)}>
                  <Circle radius={11} fill={item.label.fill} stroke="#FFFFFF" strokeWidth={1.5} />
                  <Text text={item.label.text} fontFamily="IBM Plex Sans" fontStyle="600" fontSize={11} fill={item.label.textColor} width={22} height={22} offsetX={11} offsetY={11} align="center" verticalAlign="middle" />
                </Group>
              )}
            </Group>
          ))}
        </Layer>
      </Stage>
      <div className="absolute bottom-2 right-2 flex gap-1">
        {[
          { label: "Przybliż zdjęcie", text: "+", onClick: () => zoomButton(1.5) },
          { label: "Oddal zdjęcie", text: "−", onClick: () => zoomButton(1 / 1.5) },
          { label: "Całe zdjęcie", text: "⤢", onClick: () => setView(IDENTITY) },
        ].map((button) => (
          <button key={button.label} type="button" aria-label={button.label} title={button.label} onClick={button.onClick} className="size-8 rounded-md bg-background/90 text-sm font-semibold shadow-float hover:bg-background">
            {button.text}
          </button>
        ))}
      </div>
    </>
  );
}
```

`web/src/crag/WallViewer.tsx`:
```tsx
import { useRef, type CSSProperties, type ReactNode } from "react";
import { WallCanvas } from "@/crag/WallCanvas";
import type { RouteOut, WallOut } from "@/lib/api";
import { useElementSize } from "@/lib/useElementSize";
import { useHtmlImage } from "@/lib/useHtmlImage";

export interface WallViewerProps {
  wall: WallOut;
  routes: Map<number, RouteOut>;
  selectedRouteId: number | null;
  hoveredRouteId: number | null;
  onSelectRoute: (routeId: number | null) => void;
  onHoverRoute: (routeId: number | null) => void;
  className?: string;
  style?: CSSProperties;
}

function Message({ children }: { children: ReactNode }) {
  return <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground">{children}</p>;
}

/** The photo of one wall with its routes; a failed or missing photo shows a message and leaves the rest of the page working. */
export function WallViewer({ wall, className = "", style, ...canvas }: WallViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);
  const { image, status } = useHtmlImage(wall.image_url);
  return (
    // pan-y keeps vertical page scrolling at zoom 1 on phones while two-finger gestures reach the canvas.
    <div ref={containerRef} className={`relative overflow-hidden bg-map-bg ${className}`} style={{ touchAction: "pan-y", ...style }}>
      {!wall.image_url ? (
        <Message>Brak zdjęcia tej ściany.</Message>
      ) : status === "failed" ? (
        <Message>Nie udało się wczytać zdjęcia.</Message>
      ) : status === "loading" || !image ? (
        <Message>Wczytywanie zdjęcia…</Message>
      ) : (
        size.width > 0 && size.height > 0 && <WallCanvas image={image} wall={wall} size={size} {...canvas} />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Uruchom testy i build**

Run: `cd web; npm test; npm run build`
Expected: wszystkie PASS, build bez błędów.

- [ ] **Step 6: Sprawdzenie ręczne**

Tymczasowo nie ma jeszcze strony, która używa przeglądarki (Task 6) — rysowanie, gesty i wygląd sprawdza Step 6 w Task 6. Tu wystarczy, że build przechodzi.

- [ ] **Step 7: Commit**

```powershell
git add web
git commit -m "feat: przeglądarka ściany 2D z liniami dróg i wpinkami" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Strona skały — układ A

**Files:**
- Create: `web/src/crag/RouteList.tsx`, `web/src/crag/WallThumbnails.tsx`, `web/src/crag/CragInfo.tsx`, `web/src/crag/useCompactOnScroll.ts`, `web/src/crag/useCompactOnScroll.test.ts`, `web/src/lib/format.ts`
- Modify: `web/src/pages/CragPage.tsx` (cały plik), `web/src/pages/CragPage.test.tsx` (cały plik)

**Interfaces:**
- Consumes: `routeRows`, `RouteRow`, `RouteRows`, `labelTextColor` (Task 4), `WallViewer`, `WallViewerProps` (Task 5), `GradeBadge`, `bandColor` (Task 3), `formatViewHash` (Task 2), `useIsDesktop`, `Chip`, `Logo`, `ThemeToggle`, `countLabel`, `DROGI`, fixtures (Task 4).
- Produces: `CragPage` (domyślny eksport, trasa `/skaly/:slug` bez zmian); `nextCompact(current: boolean, scrollY: number): boolean`, `useCompactOnScroll(enabled: boolean): boolean`; `wallLabel(wall: WallOut, index: number): string`; `heightLabel(crag): string | null`; `formatDecimal(n: number): string`.

Decyzje:
- Lista dróg ma dwie grupy: „Na tym zdjęciu” (drogi pokazanego zdjęcia z numerami topo) i „Pozostałe drogi” (z podpowiedzią, na którym zdjęciu są, albo „bez topo”); gdy skała nie ma zdjęć, jedna grupa „Drogi”. Wybranie drogi z innego zdjęcia przełącza zdjęcie.
- Opis wybranej drogi pokazuje się w jej wierszu.
- „← Mapa” i logo: gdy strona została otwarta z mapy — `navigate(-1)` (mapa wraca do poprzedniego widoku z adresu); gdy otwarto ją bezpośrednio — mapa wycentrowana na skale przy zoomie 15.

- [ ] **Step 1: Testy**

`web/src/crag/useCompactOnScroll.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { nextCompact } from "@/crag/useCompactOnScroll";

describe("zwijanie zdjęcia na telefonie", () => {
  it("zwija się po przewinięciu, rozwija dopiero blisko góry (bez migania)", () => {
    expect(nextCompact(false, 100)).toBe(false);
    expect(nextCompact(false, 121)).toBe(true);
    expect(nextCompact(true, 30)).toBe(true);
    expect(nextCompact(true, 10)).toBe(false);
  });
});
```

`web/src/pages/CragPage.test.tsx` — zastąp cały plik:
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WallViewerProps } from "@/crag/WallViewer";
import type { CragDetail } from "@/lib/api";
import { ThemeProvider } from "@/lib/theme";
import CragPage from "@/pages/CragPage";
import { ln, makeCrag, makeRoute, makeWall, pt } from "@/test/fixtures";

// Konva needs a real canvas; the page is tested against a stand-in that exposes the viewer's props.
vi.mock("@/crag/WallViewer", () => ({
  WallViewer: ({ wall, selectedRouteId, onSelectRoute, onHoverRoute }: WallViewerProps) => (
    <div data-testid="viewer" data-wall={wall.id} data-selected={selectedRouteId ?? ""}>
      {wall.lines.map((line) => (
        <button key={line.id} type="button" onClick={() => onSelectRoute(line.route_id)} onMouseEnter={() => onHoverRoute(line.route_id)}>
          {`linia ${line.route_id}`}
        </button>
      ))}
    </div>
  ),
}));

afterEach(() => vi.unstubAllGlobals());

const left = makeWall(20, [
  ln(1, 10, 1, [pt(1, 0.1, 0.9, "start"), pt(2, 0.1, 0.5)]),
  ln(2, 20, 2, [pt(10, 0.4, 0.9, "start"), pt(11, 0.4, 0.6)]),
  ln(3, 21, 3, [pt(20, 0.4, 0.6), pt(21, 0.6, 0.3)], [2, 11]),
], { name: "Lewa ściana" });
const right = makeWall(21, [ln(4, 10, 4, [pt(30, 0.5, 0.9, "start"), pt(31, 0.5, 0.5)])], { name: "Prawa ściana" });
const routes = [
  makeRoute(1, "Kobylański pikuś", { grade: "VI.2+", grade_fr: "6c+", grade_sort: 146, length_m: 9, protection: "2r + DRZ", first_ascent: "P. Rostek", year: 1997, description: "Rysa" }),
  makeRoute(2, "Żelazny karzeł"),
  makeRoute(3, "Wariant karła"),
  makeRoute(4, "Prawa droga"),
  makeRoute(5, "Projekt", { grade: null, grade_fr: null, grade_sort: null }),
];
const crag = makeCrag([left, right], routes);

function renderAt(data: CragDetail | Response, entries = ["/skaly/brzuchata-turniczka"]) {
  const response = data instanceof Response ? data : new Response(JSON.stringify(data));
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response)));
  const router = createMemoryRouter(
    [
      { path: "/", element: <p>Mapa</p> },
      { path: "/skaly/:slug", element: <CragPage /> },
    ],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return router;
}

const rowsOf = (name: string) => within(screen.getByRole("list", { name })).getAllByRole("button");
const row = (name: RegExp) => screen.getByRole("button", { name });

describe("CragPage", () => {
  it("nagłówek, ścieżka i chipy", async () => {
    renderAt(crag);
    expect(await screen.findByRole("heading", { name: "Brzuchata Turniczka" })).toBeInTheDocument();
    expect(screen.getByText("Dolina Kobylańska")).toBeInTheDocument();
    expect(screen.getByText("wapień")).toBeInTheDocument();
    expect(screen.getByText("10 m")).toBeInTheDocument();
    expect(screen.getByText("wystawa N")).toBeInTheDocument();
    expect(screen.getByText("dojście 5 min")).toBeInTheDocument();
  });

  it("drogi z numerami jak na zdjęciu, pozostałe z podpowiedzią", async () => {
    renderAt(crag);
    await screen.findByRole("heading", { name: "Brzuchata Turniczka" });
    const onWall = rowsOf("Na tym zdjęciu");
    expect(onWall.map((button) => button.textContent)).toEqual([
      expect.stringContaining("Kobylański pikuś"), expect.stringContaining("Żelazny karzeł"), expect.stringContaining("Wariant karła"),
    ]);
    expect(within(onWall[2]).getByText("2a")).toBeInTheDocument();
    expect(within(onWall[0]).getByText("2r + DRZ · 9 m · P. Rostek, 1997")).toBeInTheDocument();
    const other = rowsOf("Pozostałe drogi");
    expect(within(other[0]).getByText("na zdjęciu „Prawa ściana”")).toBeInTheDocument();
    expect(within(other[1]).getByText("bez topo")).toBeInTheDocument();
    expect(within(other[1]).getByTitle("bez wyceny")).toBeInTheDocument();
  });

  it("kliknięcie drogi na liście zaznacza linię i pokazuje opis; drugie odznacza", async () => {
    renderAt(crag);
    await userEvent.click(await screen.findByRole("button", { name: /Kobylański pikuś/ }));
    expect(row(/Kobylański pikuś/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-selected", "1");
    expect(screen.getByText("Rysa")).toBeInTheDocument();
    await userEvent.click(row(/Kobylański pikuś/));
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-selected", "");
  });

  it("kliknięcie i najechanie linii na zdjęciu zaznacza drogę na liście", async () => {
    renderAt(crag);
    await userEvent.hover(await screen.findByRole("button", { name: "linia 3" }));
    expect(row(/Wariant karła/)).toHaveAttribute("data-hovered", "true");
    await userEvent.click(screen.getByRole("button", { name: "linia 2" }));
    expect(row(/Żelazny karzeł/)).toHaveAttribute("aria-pressed", "true");
  });

  it("droga z innego zdjęcia przełącza zdjęcie i numerację", async () => {
    renderAt(crag);
    await userEvent.click(await screen.findByRole("button", { name: /Prawa droga/ }));
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-wall", "21");
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-selected", "4");
    expect(within(rowsOf("Na tym zdjęciu")[0]).getByText("1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prawa ściana" })).toHaveAttribute("aria-pressed", "true");
  });

  it("miniatury przełączają zdjęcie", async () => {
    renderAt(crag);
    await userEvent.click(await screen.findByRole("button", { name: "Prawa ściana" }));
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-wall", "21");
    expect(rowsOf("Na tym zdjęciu")).toHaveLength(1);
  });

  it("skała bez zdjęć: komunikat i lista dróg", async () => {
    renderAt(makeCrag([], routes));
    expect(await screen.findByText("Ta skała nie ma jeszcze zdjęć z topo.")).toBeInTheDocument();
    expect(rowsOf("Drogi")).toHaveLength(5);
    expect(screen.queryByTestId("viewer")).not.toBeInTheDocument();
  });

  it("← Mapa wraca do mapy, z której przyszliśmy", async () => {
    const router = renderAt(crag, ["/#12.00/50.10000/19.70000", "/skaly/brzuchata-turniczka"]);
    await userEvent.click(await screen.findByRole("button", { name: "← Mapa" }));
    expect(await screen.findByText("Mapa")).toBeInTheDocument();
    expect(router.state.location.hash).toBe("#12.00/50.10000/19.70000");
  });

  it("← Mapa po wejściu z linku: mapa przy skale", async () => {
    const router = renderAt(crag);
    await userEvent.click(await screen.findByRole("button", { name: "← Mapa" }));
    expect(await screen.findByText("Mapa")).toBeInTheDocument();
    expect(router.state.location.hash).toBe("#15.00/50.16614/19.76472");
  });

  it("404 → nie znaleziono", async () => {
    renderAt(new Response(JSON.stringify({ code: "not_found", message: "Nie znaleziono: skała" }), { status: 404 }));
    expect(await screen.findByText("Nie znaleziono skały")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Drobne moduły**

`web/src/lib/format.ts`:
```ts
/** Polish decimal comma: 9.5 → "9,5", 10 → "10". */
export function formatDecimal(n: number): string {
  return String(n).replace(".", ",");
}
```

`web/src/crag/useCompactOnScroll.ts`:
```ts
import { useEffect, useState } from "react";

const COMPACT_AFTER = 120;
const EXPAND_BEFORE = 24;

/** Collapse after scrolling down a bit, expand only near the top again — the gap stops the photo flickering at one threshold. */
export function nextCompact(current: boolean, scrollY: number): boolean {
  return current ? scrollY > EXPAND_BEFORE : scrollY > COMPACT_AFTER;
}

/** Phone layout: whether the sticky photo should shrink to a strip while the route list scrolls. */
export function useCompactOnScroll(enabled: boolean): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const update = () => setCompact((current) => nextCompact(current, window.scrollY));
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [enabled]);
  return enabled && compact;
}
```

`web/src/crag/WallThumbnails.tsx`:
```tsx
import type { WallOut } from "@/lib/api";

export const wallLabel = (wall: WallOut, index: number) => wall.name ?? `Zdjęcie ${index + 1}`;

export function WallThumbnails({ walls, activeId, onSelect }: { walls: WallOut[]; activeId: number | null; onSelect: (wallId: number) => void }) {
  return (
    <div role="group" aria-label="Zdjęcia ścian" className="flex gap-2 overflow-x-auto pb-1">
      {walls.map((wall, index) => (
        <button
          key={wall.id}
          type="button"
          aria-pressed={wall.id === activeId}
          title={wallLabel(wall, index)}
          onClick={() => onSelect(wall.id)}
          className="h-16 w-20 shrink-0 overflow-hidden rounded-md border-2 border-transparent bg-secondary text-xs aria-pressed:border-brand"
        >
          {wall.thumb_url ? <img src={wall.thumb_url} alt={wallLabel(wall, index)} loading="lazy" className="size-full object-cover" /> : wallLabel(wall, index)}
        </button>
      ))}
    </div>
  );
}
```

`web/src/crag/CragInfo.tsx`:
```tsx
import { Chip } from "@/components/Chip";
import type { CragDetail } from "@/lib/api";
import { formatDecimal } from "@/lib/format";

export function heightLabel({ height_min: min, height_max: max }: Pick<CragDetail, "height_min" | "height_max">): string | null {
  const low = min ?? max;
  const high = max ?? min;
  if (low === null || high === null) return null;
  return low === high ? `${formatDecimal(low)} m` : `${formatDecimal(low)}–${formatDecimal(high)} m`;
}

function Collapsible({ title, text, open }: { title: string; text: string; open: boolean }) {
  return (
    <details open={open} className="rounded-[10px] bg-secondary/60 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-semibold">{title}</summary>
      <p className="mt-2 whitespace-pre-line text-muted-foreground">{text}</p>
    </details>
  );
}

export function CragInfo({ crag, descriptionOpen }: { crag: CragDetail; descriptionOpen: boolean }) {
  const height = heightLabel(crag);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {crag.rock_type && <Chip>{crag.rock_type}</Chip>}
        {height && <Chip>{height}</Chip>}
        {crag.aspects.length > 0 && <Chip>{`wystawa ${crag.aspects.join(", ")}`}</Chip>}
        {crag.approach_minutes !== null && <Chip>{`dojście ${crag.approach_minutes} min`}</Chip>}
        {crag.child_friendly && <Chip>dla dzieci</Chip>}
      </div>
      {crag.description && <Collapsible title="Opis" text={crag.description} open={descriptionOpen} />}
      {crag.approach_description && <Collapsible title="Dojście" text={crag.approach_description} open={false} />}
    </div>
  );
}
```

`web/src/crag/RouteList.tsx`:
```tsx
import { useEffect, useRef } from "react";
import { GradeBadge } from "@/components/GradeBadge";
import { labelTextColor, type RouteRow, type RouteRows } from "@/crag/topo";
import type { RouteOut } from "@/lib/api";
import { formatDecimal } from "@/lib/format";
import { bandColor } from "@/lib/grades";
import { useTheme } from "@/lib/theme";

interface RouteListProps {
  rows: RouteRows;
  wallNames: Map<number, string>;
  selectedRouteId: number | null;
  hoveredRouteId: number | null;
  onChoose: (row: RouteRow) => void;
  onHover: (routeId: number | null) => void;
}

function meta(route: RouteOut): string {
  const author = [route.first_ascent, route.year].filter((part) => part !== null).join(", ");
  return [route.protection, route.length_m !== null ? `${formatDecimal(route.length_m)} m` : null, author || null]
    .filter((part) => part !== null)
    .join(" · ");
}

function Row({ row, hint, selected, hovered, onChoose, onHover }: { row: RouteRow; hint: string | null; selected: boolean; hovered: boolean } & Pick<RouteListProps, "onChoose" | "onHover">) {
  const { theme } = useTheme();
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    // Selecting on the photo brings the row into view; the scroll margin keeps it below the sticky photo on phones.
    if (selected) ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  const { route } = row;
  const details = meta(route);
  return (
    <li ref={ref} className="scroll-mt-[32vh] lg:scroll-mt-4">
      <button
        type="button"
        aria-pressed={selected}
        data-hovered={hovered || undefined}
        onClick={() => onChoose(row)}
        onMouseEnter={() => onHover(route.id)}
        onMouseLeave={() => onHover(null)}
        className={`flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left ${selected ? "bg-secondary" : hovered ? "bg-secondary/60" : "hover:bg-secondary/60"}`}
      >
        <span
          aria-hidden
          className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${row.label ? "" : "bg-secondary text-muted-foreground"}`}
          style={row.label ? { backgroundColor: bandColor(route.grade_sort, theme), color: labelTextColor(route.grade_sort, theme) } : undefined}
        >
          {row.label ?? "–"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display font-semibold leading-snug">{route.name}</span>
          {details && <span className="block text-xs text-muted-foreground">{details}</span>}
          {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
          {selected && route.description && <span className="mt-1 block whitespace-pre-line text-sm">{route.description}</span>}
        </span>
        <GradeBadge grade={route.grade} sort={route.grade_sort} french={route.grade_fr} />
      </button>
    </li>
  );
}

function Group({ title, rows, hintFor, ...rest }: { title: string; rows: RouteRow[]; hintFor: (row: RouteRow) => string | null } & Omit<RouteListProps, "rows" | "wallNames">) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h2>
      <ul aria-label={title} className="flex flex-col">
        {rows.map((row) => (
          <Row
            key={row.route.id}
            row={row}
            hint={hintFor(row)}
            selected={row.route.id === rest.selectedRouteId}
            hovered={row.route.id === rest.hoveredRouteId}
            onChoose={rest.onChoose}
            onHover={rest.onHover}
          />
        ))}
      </ul>
    </section>
  );
}

export function RouteList({ rows, wallNames, ...rest }: RouteListProps) {
  if (rows.onWall.length + rows.other.length === 0) return <p className="text-sm text-muted-foreground">Ta skała nie ma jeszcze dróg.</p>;
  const otherHint = (row: RouteRow) => (row.wallId === null ? "bez topo" : `na zdjęciu „${wallNames.get(row.wallId) ?? ""}”`);
  return (
    <div className="flex flex-col gap-4">
      {rows.onWall.length > 0 && <Group title="Na tym zdjęciu" rows={rows.onWall} hintFor={() => null} {...rest} />}
      {rows.other.length > 0 && <Group title={rows.onWall.length > 0 ? "Pozostałe drogi" : "Drogi"} rows={rows.other} hintFor={otherHint} {...rest} />}
    </div>
  );
}
```

- [ ] **Step 3: Strona skały**

`web/src/pages/CragPage.tsx` — zastąp cały plik:
```tsx
import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CragInfo } from "@/crag/CragInfo";
import { RouteList } from "@/crag/RouteList";
import { routeRows, type RouteRow } from "@/crag/topo";
import { useCompactOnScroll } from "@/crag/useCompactOnScroll";
import { WallThumbnails, wallLabel } from "@/crag/WallThumbnails";
import { WallViewer } from "@/crag/WallViewer";
import { api, ApiError } from "@/lib/api";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { formatViewHash } from "@/map/view";

const CRAG_ZOOM = 15;

export default function CragPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isDesktop = useIsDesktop();
  const compact = useCompactOnScroll(!isDesktop);
  const { data: crag, error, isPending } = useQuery({ queryKey: ["crag", slug], queryFn: () => api.crag(slug) });
  const [wallId, setWallId] = useState<number | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [hoveredRouteId, setHoveredRouteId] = useState<number | null>(null);

  useEffect(() => {
    if (!crag) return;
    document.title = `${crag.name} · topo`;
    return () => {
      document.title = "topo";
    };
  }, [crag]);

  const routes = useMemo(() => new Map((crag?.routes ?? []).map((route) => [route.id, route])), [crag]);
  const wall = crag?.walls.find((candidate) => candidate.id === wallId) ?? crag?.walls[0] ?? null;
  const rows = useMemo(() => (crag ? routeRows(crag, wall?.id ?? null) : { onWall: [], other: [] }), [crag, wall]);
  const wallNames = useMemo(() => new Map((crag?.walls ?? []).map((candidate, index) => [candidate.id, wallLabel(candidate, index)])), [crag]);

  function backToMap() {
    // Came from the map: go back, so the map restores its view from the URL. Opened from a link: show the map at this crag.
    if (location.key !== "default") navigate(-1);
    else navigate(crag ? `/${formatViewHash({ longitude: crag.lng, latitude: crag.lat, zoom: CRAG_ZOOM })}` : "/");
  }

  function chooseRow(row: RouteRow) {
    if (row.wallId !== null && row.wallId !== wall?.id) setWallId(row.wallId);
    setSelectedRouteId((current) => (current === row.route.id ? null : row.route.id));
  }

  const aspect = wall?.image_width && wall.image_height ? wall.image_height / wall.image_width : 4 / 3;
  const viewerHeight = isDesktop ? "calc(100vh - 13rem)" : compact ? "30vh" : `min(${Math.round(aspect * 100)}vw, 65vh)`;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 lg:px-6">
      <header className="flex items-center justify-between py-3">
        <button type="button" onClick={backToMap} aria-label="Wróć do mapy">
          <Logo />
        </button>
        <ThemeToggle />
      </header>
      {isPending && <p className="text-muted-foreground">Wczytywanie…</p>}
      {error && <p role="alert">{error instanceof ApiError && error.status === 404 ? "Nie znaleziono skały" : error.message}</p>}
      {crag && (
        <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[58fr_42fr] lg:items-start lg:gap-8">
          {/* Phone: "contents" makes these direct children of the long column, so the photo can stick while the list scrolls. */}
          <div className="contents lg:sticky lg:top-4 lg:flex lg:flex-col lg:gap-3">
            <div>
              <nav className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                <button type="button" onClick={backToMap} className="uppercase hover:text-foreground">
                  ← Mapa
                </button>
                {crag.path.map((area) => (
                  <Fragment key={area.id}>
                    {" · "}
                    <span>{area.name}</span>
                  </Fragment>
                ))}
              </nav>
              <h1 className="font-display text-4xl font-extrabold tracking-tight">{crag.name}</h1>
            </div>
            {wall ? (
              <div className="sticky top-0 z-10 -mx-4 bg-background lg:static lg:mx-0">
                <WallViewer
                  key={wall.id}
                  wall={wall}
                  routes={routes}
                  selectedRouteId={selectedRouteId}
                  hoveredRouteId={hoveredRouteId}
                  onSelectRoute={setSelectedRouteId}
                  onHoverRoute={setHoveredRouteId}
                  className="transition-[height] duration-200 lg:rounded-[10px]"
                  style={{ height: viewerHeight }}
                />
              </div>
            ) : (
              <p className="rounded-[10px] bg-secondary p-4 text-sm text-muted-foreground">Ta skała nie ma jeszcze zdjęć z topo.</p>
            )}
            {crag.walls.length > 1 && <WallThumbnails walls={crag.walls} activeId={wall?.id ?? null} onSelect={setWallId} />}
          </div>
          <div className="flex flex-col gap-4">
            <CragInfo crag={crag} descriptionOpen={isDesktop} />
            <RouteList
              rows={rows}
              wallNames={wallNames}
              selectedRouteId={selectedRouteId}
              hoveredRouteId={hoveredRouteId}
              onChoose={chooseRow}
              onHover={setHoveredRouteId}
            />
            {crag.source === "portalgorski" && crag.source_url && (
              <p className="text-xs text-muted-foreground">
                Źródło danych:{" "}
                <a href={crag.source_url} target="_blank" rel="noreferrer" className="underline">
                  Portal Górski
                </a>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Uruchom testy i build**

Run: `cd web; npm test; npm run build`
Expected: wszystkie PASS, build bez błędów.

- [ ] **Step 5: Commit**

```powershell
git add web
git commit -m "feat: strona skały — zdjęcie ściany, miniatury, informacje i lista dróg" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Sprawdzenie ręczne (cały plan)**

`docker compose up -d`, `cd web; npm run dev`, otwórz w przeglądarce stronę skały z wariantami, np. http://localhost:5173/skaly/zjazdowa-turnia, i skałę z wieloma ścianami, np. http://localhost:5173/skaly/wielka-wronia-baszta:
- komputer (okno ≥ 1024 px): dwie kolumny, lewa przyklejona przy przewijaniu listy; linie w kolorach pasm, numery „1”, „2”, „2a”…, wpinki i stanowiska widoczne;
- najechanie na wiersz pogrubia linię, najechanie na linię podświetla wiersz; kliknięcie linii zaznacza wiersz (i odwrotnie), pozostałe linie przygasają; zaznaczony wariant pokazuje całą drogę od startu;
- kółko myszy przybliża względem kursora, przeciąganie przesuwa, podwójne kliknięcie i „⤢” wracają do całego zdjęcia;
- miniatury przełączają ściany, numeracja listy zmienia się razem ze zdjęciem; droga z „Pozostałe drogi” przełącza zdjęcie;
- motyw ciemny: kolory linii i plakietek ciemne, numery czytelne;
- telefon (narzędzia deweloperskie, tryb urządzenia, np. 390×844): jedna kolumna, przy przewijaniu listy zdjęcie zwija się do paska u góry, wybrana droga widoczna; przybliżanie dwoma palcami (w trybie urządzenia: Shift + przeciąganie);
- ściana bez zdjęcia / zablokowany adres zdjęcia (w narzędziach deweloperskich zablokuj `/media/…`) — komunikat w miejscu zdjęcia, lista działa;
- „← Mapa” po wejściu z mapy wraca do tego samego widoku; po wejściu z linku pokazuje mapę przy skale.

---

## Po zakończeniu planu 4

- Strona skały w układzie A z widokiem 2D: zdjęcia ścian z liniami i wpinkami, numeracja jak na topo, lista dróg z podświetlaniem w obie strony, układ na telefon i komputer.
- Mapa: sektory widoczne do zoomu 15, obrysy zostają, karta z zakresem wycen i listami, widok w adresie.
- Poza zakresem (kolejne plany): przełącznik i widok 2.5D (plan 5), testy E2E w Playwright ze spec §10 (do dodania, gdy będą dane testowe w bazie), wydzielenie logiki kliknięcia mapy do czystej funkcji (sugestia z przeglądu planu 3).
- Następny krok: plan 5 — mapy głębi (GPU, CLI) i widok 2.5D.
