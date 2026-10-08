# Plan 3: szkielet frontu, system wizualny i mapa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplikacja React z systemem wizualnym „Przewodnik” (motyw jasny i ciemny) i stroną główną — mapą na cały ekran z trzema poziomami (regiony → sektory → skały), kartami szczegółów i przełącznikiem podkładów.

**Architecture:** Vite + React + TypeScript w katalogu `web/`, uruchamiany na hoście (Node 22) z proxy `/api` i `/media` do API w Dockerze (`localhost:8000`). Tailwind v4 + shadcn/ui z tokenami kolorów projektu; motyw przez klasę `dark` na `<html>`. Mapa: MapLibre GL przez `react-map-gl/maplibre`; styl podkładu i warstwy danych budowane czystymi funkcjami (testowalne bez przeglądarki), komponenty UI testowane w jsdom. Logika „co jest widoczne przy jakim przybliżeniu” jest w definicjach warstw (`minzoom`/`maxzoom`/`filter`), więc niewidoczne obiekty nie są klikalne.

**Tech Stack:** Vite 8, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, React Router, TanStack Query 5, MapLibre GL + react-map-gl 8, Vitest + Testing Library (jsdom), fonty `@fontsource-variable/fraunces` i `@fontsource/ibm-plex-sans`.

**Spec:** `docs/superpowers/specs/2026-10-08-frontend-design.md` (wygląd) oraz `docs/superpowers/specs/2026-10-08-topo-design.md` §6.1 (mapa).

## Global Constraints

- Styl A „Przewodnik”: kolory i fonty dokładnie z `2026-10-08-frontend-design.md` §2 (tokeny niżej w Task 2 mają te wartości); nagłówki/nazwy Fraunces, tekst IBM Plex Sans; logo „topo” + kropka w kolorze akcentu.
- Motyw: domyślnie z `prefers-color-scheme`, przełącznik zapamiętany w `localStorage` pod kluczem `topo-theme` (dostęp w try/catch), klasa `dark` na `<html>` ustawiana przed pierwszym renderem.
- Kolory pasm trudności (linie, numerki, pasek rozkładu): jasny `#3E8FB0`, `#2F4FA0`, `#B23A2B`, `#2B2420`; ciemny `#4FA8CC`, `#5C7BD6`, `#E0604E`, `#EDE3D2`. Granice pasm (grade_sort): `94`, `140`, `200`.
- Wszystkie teksty interfejsu po polsku, z poprawną odmianą liczebników („1 skała”, „3 skały”, „5 skał”; „1 droga”, „2 drogi”, „5 dróg”).
- Mapa: komputer ≥ 1024 px — karta szczegółów jako pływający panel z prawej (~320 px); telefon — karta wysuwana od dołu (shadcn Drawer).
- Podkłady: „Mapa + cieniowanie” (OSM + półprzezroczyste cieniowanie Geoportalu, domyślny), „Ortofotomapa” (Geoportal), „OpenTopoMap”; w ciemnym motywie podkład przyciemniony (`raster-brightness-max`).
- Front działa na hoście: `cd web; npm run dev` (port 5173), API w Dockerze na `localhost:8000`.
- **Zasada testów:** testy pisane razem z kodem, uruchamiane raz na końcu zadania.

## Review Focus

1. **Obiekt niewidoczny przy danym przybliżeniu nie może być klikalny** (np. skała w sektorze przy widoku regionów) — Task 4 `test_crag_groups_have_zoom_gates`; warstwy z `minzoom` nie są odpytywane przez MapLibre.
2. **Skały poza sektorem i poza regionem** (bezpośrednio pod obszarem, np. Szczyrzyc) muszą być widoczne już przy najmniejszym przybliżeniu — Task 4, ten sam test (`crags-isolated` bez `minzoom`).
3. **API niedostępne lub błąd 500** — mapa pokazuje polski komunikat zamiast pustego ekranu; strona skały pokazuje „Nie znaleziono skały” dla 404 — Task 3 `getJson` testy, Task 6 `CragPage` test.
4. **Brak `localStorage` (tryb prywatny) / wyjątek przy dostępie** — motyw i podkład działają, tylko się nie zapamiętują — Task 2 `theme` test z rzucającym `localStorage`.
5. **Region bez dróg z wyceną** (same projekty) — pasek rozkładu trudności nie renderuje się zamiast dzielić przez zero — Task 5 `GradeBar` test.

---

## Struktura plików

```
api/topo/queries.py                  + area_kind w crag_summaries (Task 1)
api/tests/test_api_map.py            + asercja area_kind
web/
├── package.json, vite.config.ts, tsconfig*.json, components.json, index.html
├── src/
│   ├── main.tsx, App.tsx, index.css           (tokeny motywów)
│   ├── test/setup.ts
│   ├── lib/
│   │   ├── theme.tsx          ThemeProvider, useTheme
│   │   ├── api.ts             getJson, ApiError, typy odpowiedzi, api.*
│   │   ├── grades.ts          gradeBand, BAND_COLORS
│   │   ├── plural.ts          plural, countLabel, SKALY, DROGI
│   │   ├── aggregate.ts       aggregateBands (pasma dla regionów/sektorów)
│   │   └── useMediaQuery.ts   useMediaQuery, useIsDesktop
│   ├── components/
│   │   ├── ui/…               (shadcn: button, drawer)
│   │   ├── Logo.tsx, ThemeToggle.tsx, GradeBar.tsx, Chip.tsx
│   ├── map/
│   │   ├── style.ts           BASE_LAYERS, buildBaseStyle
│   │   ├── layers.ts          ZOOM, MAP_COLORS, regionLayers, sectorLayers, cragLayers, INTERACTIVE_LAYERS
│   │   ├── selection.ts       typ Selection
│   │   ├── TopBar.tsx, LayerSwitcher.tsx, DetailCard.tsx, useMapData.ts, MapPage.tsx
│   └── pages/CragPage.tsx     (tymczasowa strona skały — pełna w planie 4)
└── tests obok plików: *.test.ts / *.test.tsx
```

---

### Task 1: API — rodzaj obszaru skały na mapie

**Files:**
- Modify: `api/topo/queries.py`, `api/topo/api/map.py`
- Test: `api/tests/test_api_map.py`

**Interfaces:**
- Produces: `crag_summaries(...)` zwraca dodatkowo klucz `area_kind: str` (`obszar` | `region` | `sektor`); `GET /api/map/crags` ma w `properties` pole `area_kind`.

- [ ] **Step 1: Test**

W `api/tests/test_api_map.py::test_map_crags_with_grade_bands` dopisz na końcu:
```python
    assert zabi["properties"]["area_kind"] == "sektor"
    assert by_name["Samotna"]["properties"]["area_kind"] == "region"
```

- [ ] **Step 2: Implementacja**

W `api/topo/queries.py` w zapytaniu `crag_summaries` dodaj do SELECT `a.kind AS area_kind,` (obok `in_sector`) i do zwracanego słownika `"area_kind": r["area_kind"],`. W `api/topo/api/map.py` w `map_crags` dodaj `"area_kind"` do krotki kluczy przepisywanych do `properties`.

- [ ] **Step 3: Uruchom testy**

Run: `docker compose run --rm api pytest -q`
Expected: wszystkie PASS.

- [ ] **Step 4: Commit**

```powershell
git add api
git commit -m "feat: rodzaj obszaru skały w danych mapy" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Szkielet aplikacji, motywy i fonty

**Files:**
- Create: `web/` (Vite react-ts), `web/vite.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/index.css`, `web/src/test/setup.ts`, `web/src/lib/theme.tsx`, `web/src/components/Logo.tsx`, `web/src/components/ThemeToggle.tsx`, `web/src/map/MapPage.tsx` (tymczasowy), `web/src/pages/CragPage.tsx` (tymczasowy), shadcn `web/src/components/ui/button.tsx`, `web/src/components/ui/drawer.tsx`, `web/components.json`
- Modify: `.gitignore` (`web/dist/`), `README.md` (sekcja „Front”)
- Test: `web/src/lib/theme.test.tsx`

**Interfaces:**
- Produces:
  - `ThemeProvider({children})`, `useTheme(): { theme: "light" | "dark"; toggle(): void }` z `@/lib/theme`; `THEME_KEY = "topo-theme"`
  - `Logo()`, `ThemeToggle()` (przycisk z `aria-label="Przełącz motyw"`)
  - Klasy Tailwind z tokenów: `bg-background text-foreground bg-secondary text-muted-foreground border-border bg-brand text-brand-foreground bg-map-bg font-display font-sans` itd.
  - Alias importów `@/` → `web/src/`
  - `npm test` (vitest run), `npm run dev`, `npm run build`

- [ ] **Step 1: Utworzenie projektu i zależności**

Z katalogu repo (PowerShell):
```powershell
npm create vite@latest web -- --template react-ts --no-interactive
cd web
npm install
npm install react-router @tanstack/react-query maplibre-gl react-map-gl @fontsource-variable/fraunces @fontsource/ibm-plex-sans
npm install -D tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/node
```
(Jeśli `--no-interactive` nie istnieje w tej wersji create-vite — uruchom bez niego i wybierz brak automatycznego startu. Jeśli npm zgłosi konflikt peer dependency między `react-map-gl` a `maplibre-gl`, zainstaluj najnowszą wersję `maplibre-gl` zgodną z `react-map-gl` i zapisz to w raporcie.)

- [ ] **Step 2: Konfiguracja Vite, TypeScript i shadcn**

`web/vite.config.ts`:
```ts
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8000", "/media": "http://localhost:8000" },
  },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], css: false },
});
```

W `web/tsconfig.json` i `web/tsconfig.app.json` dodaj do `compilerOptions`: `"baseUrl": "."` i `"paths": { "@/*": ["./src/*"] }` (jeśli wersja TypeScript odrzuca `baseUrl`, zostaw same `paths`). W `tsconfig.app.json` dodaj też `"types": ["vitest/globals", "@testing-library/jest-dom"]` tylko jeśli testy tego wymagają do kompilacji.

shadcn (z katalogu `web`):
```powershell
npx shadcn@latest init --defaults --yes
npx shadcn@latest add button drawer --yes
```
(init może nadpisać `src/index.css` — w Step 3 zastępujesz go w całości.)

`package.json` → `scripts` ma zawierać: `"dev": "vite"`, `"build": "tsc -b && vite build"`, `"test": "vitest run"`.

- [ ] **Step 3: Tokeny motywów i fonty**

`web/src/index.css` (cały plik; jeśli shadcn dodał import `tw-animate-css`, zostaw tę linię pod importem tailwind):
```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;
  --background: #f4ecdd;
  --foreground: #2b2420;
  --card: #f4ecdd;
  --card-foreground: #2b2420;
  --popover: #f4ecdd;
  --popover-foreground: #2b2420;
  --primary: #2b2420;
  --primary-foreground: #f4ecdd;
  --secondary: #e6d8bf;
  --secondary-foreground: #2b2420;
  --muted: #e6d8bf;
  --muted-foreground: #716a62;
  --accent: #eadcc4;
  --accent-foreground: #2b2420;
  --destructive: #b23a2b;
  --border: #e1d3ba;
  --input: #e1d3ba;
  --ring: #c2541b;
  --brand: #c2541b;
  --brand-foreground: #f4ecdd;
  --map-bg: #e9ddc6;
}

.dark {
  --background: #1d1916;
  --foreground: #ede3d2;
  --card: #1d1916;
  --card-foreground: #ede3d2;
  --popover: #1d1916;
  --popover-foreground: #ede3d2;
  --primary: #e2763a;
  --primary-foreground: #1d1916;
  --secondary: #2e2722;
  --secondary-foreground: #ede3d2;
  --muted: #2e2722;
  --muted-foreground: #a49c90;
  --accent: #2e2722;
  --accent-foreground: #ede3d2;
  --destructive: #e0604e;
  --border: #3a312a;
  --input: #3a312a;
  --ring: #e2763a;
  --brand: #e2763a;
  --brand-foreground: #1d1916;
  --map-bg: #26201c;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-brand: var(--brand);
  --color-brand-foreground: var(--brand-foreground);
  --color-map-bg: var(--map-bg);
  --font-sans: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Fraunces Variable", Georgia, serif;
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground font-sans antialiased;
  }
}
```

`web/index.html` — w `<head>`: `<html lang="pl">`, `<title>topo</title>` i **przed** skryptem modułu:
```html
    <script>
      try {
        var saved = localStorage.getItem("topo-theme");
        var dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (dark) document.documentElement.classList.add("dark");
      } catch (e) {}
    </script>
```

`web/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/fraunces";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 4: Motyw, logo, przełącznik, routing**

`web/src/lib/theme.tsx`:
```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";
export const THEME_KEY = "topo-theme";

interface ThemeState {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // private mode / blocked storage: the theme still works, it just is not remembered
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const toggle = useCallback(() => {
    setTheme((previous) => {
      const next: Theme = previous === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  }, []);
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const state = useContext(ThemeContext);
  if (state === null) throw new Error("useTheme musi być użyty wewnątrz ThemeProvider");
  return state;
}
```

`web/src/components/Logo.tsx`:
```tsx
export function Logo() {
  return (
    <span className="font-display text-xl font-extrabold tracking-tight">
      topo<span className="text-brand">.</span>
    </span>
  );
}
```

`web/src/components/ThemeToggle.tsx`:
```tsx
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button variant="ghost" size="icon" aria-label="Przełącz motyw" onClick={toggle}>
      <span aria-hidden>{theme === "dark" ? "☀" : "☾"}</span>
    </Button>
  );
}
```

Tymczasowe strony (zastąpione w Task 6):

`web/src/map/MapPage.tsx`:
```tsx
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function MapPage() {
  return (
    <div className="flex items-center gap-4 p-4">
      <Logo />
      <ThemeToggle />
    </div>
  );
}
```

`web/src/pages/CragPage.tsx`:
```tsx
export default function CragPage() {
  return <p className="p-4">Strona skały</p>;
}
```

`web/src/App.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";
import { ThemeProvider } from "@/lib/theme";
import MapPage from "@/map/MapPage";
import CragPage from "@/pages/CragPage";

const router = createBrowserRouter([
  { path: "/", element: <MapPage /> },
  { path: "/skaly/:slug", element: <CragPage /> },
]);

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60_000, retry: 1 } } });

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
```

`web/src/test/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});
```

Usuń z szablonu Vite niepotrzebne pliki (`src/App.css`, `src/assets/react.svg`, `public/vite.svg` i ich importy).

- [ ] **Step 5: Test motywu**

`web/src/lib/theme.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/components/ThemeToggle";
import { THEME_KEY, ThemeProvider } from "@/lib/theme";

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe("motyw", () => {
  afterEach(() => vi.restoreAllMocks());

  it("przełącza klasę dark i zapamiętuje wybór", async () => {
    renderToggle();
    await userEvent.click(screen.getByRole("button", { name: "Przełącz motyw" }));
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");

    await userEvent.click(screen.getByRole("button", { name: "Przełącz motyw" }));
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
  });

  it("startuje od motywu ustawionego przed renderem", () => {
    document.documentElement.classList.add("dark");
    renderToggle();
    expect(screen.getByRole("button", { name: "Przełącz motyw" })).toHaveTextContent("☀");
  });

  it("działa, gdy localStorage rzuca wyjątek", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("zablokowane");
    });
    renderToggle();
    await userEvent.click(screen.getByRole("button", { name: "Przełącz motyw" }));
    expect(document.documentElement).toHaveClass("dark");
  });
});
```

- [ ] **Step 6: README, .gitignore, uruchom testy i build**

`.gitignore`: dopisz `web/dist/`. `README.md` — dopisz:
````markdown
## Front

```powershell
docker compose up -d api        # API na :8000
cd web
npm install
npm run dev                     # http://localhost:5173
npm test                        # testy
```
````

Run (w `web`): `npm test` — Expected: 3 PASS. `npm run build` — Expected: bez błędów TypeScript.

- [ ] **Step 7: Commit**

```powershell
git add .gitignore README.md web
git commit -m "feat: szkielet frontu (Vite, React, Tailwind, shadcn) z motywami Przewodnik" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Klient API, pasma trudności, odmiana liczebników, agregacja

**Files:**
- Create: `web/src/lib/api.ts`, `web/src/lib/grades.ts`, `web/src/lib/plural.ts`, `web/src/lib/aggregate.ts`, `web/src/lib/useMediaQuery.ts`
- Test: `web/src/lib/api.test.ts`, `web/src/lib/grades.test.ts`, `web/src/lib/plural.test.ts`, `web/src/lib/aggregate.test.ts`

**Interfaces:**
- Produces (`@/lib/api`):
  - `class ApiError extends Error { status: number }`
  - `getJson<T>(path: string): Promise<T>` — przy statusie ≥ 400 rzuca `ApiError` z `message` z ciała `{code, message}` (albo `"Błąd serwera (<status>)"`); przy błędzie sieci rzuca `ApiError(0, "Brak połączenia z serwerem")`
  - Typy: `AreaKind = "obszar" | "region" | "sektor"`, `AreaProps { id; name; slug; kind; parent_id: number | null; crag_count; route_count; center: [number, number]; bbox: [number, number, number, number] }`, `CragProps { id; name; slug; area_id; area_kind: AreaKind; in_sector: boolean; route_count; grade_bands: number[] }`, `AreaRef { id; name; slug; kind }`, `CragDetail { id; name; slug; path: AreaRef[]; lng; lat; rock_type: string | null; height_min: number | null; height_max: number | null; aspects: string[]; approach_minutes: number | null; child_friendly: boolean | null; description: string | null }` (pozostałe pola odpowiedzi ignorowane w tym planie)
  - `api.regions(): Promise<FeatureCollection<Point, AreaProps>>`, `api.sectorHulls(): Promise<FeatureCollection<Polygon, AreaProps>>`, `api.crags(): Promise<FeatureCollection<Point, CragProps>>`, `api.crag(slug: string): Promise<CragDetail>` (typy `FeatureCollection`, `Point`, `Polygon` z pakietu typów `geojson`)
- Produces (`@/lib/grades`): `BAND_LIMITS = [94, 140, 200]`, `gradeBand(sort: number | null): 0 | 1 | 2 | 3 | null`, `BAND_COLORS: Record<Theme, [string, string, string, string]>`, `BAND_LABELS = ["≤ V+", "VI- – VI.1+/2", "VI.2 – VI.4+/5", "≥ VI.5"]`
- Produces (`@/lib/plural`): `plural(n: number, forms: [string, string, string]): string`, `countLabel(n, forms): string`, `SKALY = ["skała", "skały", "skał"]`, `DROGI = ["droga", "drogi", "dróg"]`
- Produces (`@/lib/aggregate`): `aggregateBands(sectors: AreaProps[], crags: CragProps[]): Map<number, number[]>` — pasma (4 liczby) dla każdego obszaru, któremu podlegają skały: sumy skał bezpośrednio w obszarze + sumy sektorów należących do regionu
- Produces (`@/lib/useMediaQuery`): `useMediaQuery(query: string): boolean`, `useIsDesktop(): boolean` (`(min-width: 1024px)`)

- [ ] **Step 1: Testy**

`web/src/lib/api.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, getJson } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: Response | Error) {
  vi.stubGlobal("fetch", vi.fn(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response))));
}

describe("getJson", () => {
  it("zwraca JSON", async () => {
    stubFetch(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    await expect(getJson("/api/x")).resolves.toEqual({ ok: 1 });
  });

  it("przekazuje polski komunikat z API", async () => {
    stubFetch(new Response(JSON.stringify({ code: "not_found", message: "Nie znaleziono: skała" }), { status: 404 }));
    await expect(getJson("/api/crags/x")).rejects.toMatchObject({ status: 404, message: "Nie znaleziono: skała" });
  });

  it("ma komunikat zastępczy dla odpowiedzi bez JSON", async () => {
    stubFetch(new Response("<html>", { status: 502 }));
    await expect(getJson("/api/x")).rejects.toMatchObject({ status: 502, message: "Błąd serwera (502)" });
  });

  it("zgłasza brak połączenia", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    const error = await getJson("/api/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, message: "Brak połączenia z serwerem" });
  });
});
```

`web/src/lib/grades.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { BAND_COLORS, gradeBand } from "@/lib/grades";

describe("gradeBand", () => {
  it.each([
    [null, null],
    [86, 0],
    [93, 0],
    [94, 1],
    [133, 1],
    [140, 2],
    [193, 2],
    [200, 3],
  ])("%s → %s", (sort, band) => {
    expect(gradeBand(sort)).toBe(band);
  });

  it("ma kolory pasm dla obu motywów", () => {
    expect(BAND_COLORS.light).toEqual(["#3E8FB0", "#2F4FA0", "#B23A2B", "#2B2420"]);
    expect(BAND_COLORS.dark).toEqual(["#4FA8CC", "#5C7BD6", "#E0604E", "#EDE3D2"]);
  });
});
```

`web/src/lib/plural.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { countLabel, DROGI, SKALY } from "@/lib/plural";

describe("countLabel", () => {
  it.each([
    [0, "0 skał"],
    [1, "1 skała"],
    [2, "2 skały"],
    [4, "4 skały"],
    [5, "5 skał"],
    [12, "12 skał"],
    [14, "14 skał"],
    [22, "22 skały"],
    [49, "49 skał"],
    [112, "112 skał"],
    [124, "124 skały"],
  ])("%s skał", (n, label) => {
    expect(countLabel(n, SKALY)).toBe(label);
  });

  it("odmienia drogi", () => {
    expect(countLabel(1, DROGI)).toBe("1 droga");
    expect(countLabel(3, DROGI)).toBe("3 drogi");
    expect(countLabel(645, DROGI)).toBe("645 dróg");
  });
});
```

`web/src/lib/aggregate.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { AreaProps, CragProps } from "@/lib/api";
import { aggregateBands } from "@/lib/aggregate";

const area = (id: number, kind: AreaProps["kind"], parent_id: number | null): AreaProps => ({
  id, name: `A${id}`, slug: `a${id}`, kind, parent_id, crag_count: 0, route_count: 0, center: [0, 0], bbox: [0, 0, 0, 0],
});
const crag = (id: number, area_id: number, area_kind: CragProps["area_kind"], grade_bands: number[]): CragProps => ({
  id, name: `C${id}`, slug: `c${id}`, area_id, area_kind, in_sector: area_kind === "sektor", route_count: 0, grade_bands,
});

describe("aggregateBands", () => {
  it("sumuje skały sektora i skały bezpośrednio w regionie", () => {
    const sectors = [area(10, "sektor", 1), area(11, "sektor", 1)];
    const crags = [crag(100, 10, "sektor", [1, 2, 0, 0]), crag(101, 11, "sektor", [0, 1, 1, 0]), crag(102, 1, "region", [2, 0, 0, 1])];
    const bands = aggregateBands(sectors, crags);
    expect(bands.get(10)).toEqual([1, 2, 0, 0]);
    expect(bands.get(11)).toEqual([0, 1, 1, 0]);
    expect(bands.get(1)).toEqual([3, 3, 1, 1]);
  });

  it("nie zmienia danych wejściowych", () => {
    const crags = [crag(100, 1, "region", [1, 0, 0, 0])];
    aggregateBands([], crags);
    expect(crags[0].grade_bands).toEqual([1, 0, 0, 0]);
  });
});
```

- [ ] **Step 2: Implementacja**

`web/src/lib/api.ts`:
```ts
import type { FeatureCollection, Point, Polygon } from "geojson";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type AreaKind = "obszar" | "region" | "sektor";

export interface AreaProps {
  id: number;
  name: string;
  slug: string;
  kind: AreaKind;
  parent_id: number | null;
  crag_count: number;
  route_count: number;
  center: [number, number];
  bbox: [number, number, number, number];
}

export interface CragProps {
  id: number;
  name: string;
  slug: string;
  area_id: number;
  area_kind: AreaKind;
  in_sector: boolean;
  route_count: number;
  grade_bands: number[];
}

export interface AreaRef {
  id: number;
  name: string;
  slug: string;
  kind: AreaKind;
}

export interface CragDetail {
  id: number;
  name: string;
  slug: string;
  path: AreaRef[];
  lng: number;
  lat: number;
  rock_type: string | null;
  height_min: number | null;
  height_max: number | null;
  aspects: string[];
  approach_minutes: number | null;
  child_friendly: boolean | null;
  description: string | null;
}

export async function getJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { Accept: "application/json" } });
  } catch {
    throw new ApiError(0, "Brak połączenia z serwerem");
  }
  if (!response.ok) {
    let message = `Błąd serwera (${response.status})`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // body is not JSON — keep the generic message
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export const api = {
  regions: () => getJson<FeatureCollection<Point, AreaProps>>("/api/map/areas?kind=region"),
  sectorHulls: () => getJson<FeatureCollection<Polygon, AreaProps>>("/api/map/areas?kind=sektor&geometry=hull"),
  crags: () => getJson<FeatureCollection<Point, CragProps>>("/api/map/crags"),
  crag: (slug: string) => getJson<CragDetail>(`/api/crags/${encodeURIComponent(slug)}`),
};
```

`web/src/lib/grades.ts`:
```ts
import type { Theme } from "@/lib/theme";

export type Band = 0 | 1 | 2 | 3;

export const BAND_LIMITS = [94, 140, 200] as const;
export const BAND_LABELS = ["≤ V+", "VI- – VI.1+/2", "VI.2 – VI.4+/5", "≥ VI.5"] as const;

export const BAND_COLORS: Record<Theme, [string, string, string, string]> = {
  light: ["#3E8FB0", "#2F4FA0", "#B23A2B", "#2B2420"],
  dark: ["#4FA8CC", "#5C7BD6", "#E0604E", "#EDE3D2"],
};

export function gradeBand(sort: number | null): Band | null {
  if (sort === null) return null;
  if (sort < BAND_LIMITS[0]) return 0;
  if (sort < BAND_LIMITS[1]) return 1;
  if (sort < BAND_LIMITS[2]) return 2;
  return 3;
}
```

`web/src/lib/plural.ts`:
```ts
export type Forms = readonly [one: string, few: string, many: string];

export const SKALY: Forms = ["skała", "skały", "skał"];
export const DROGI: Forms = ["droga", "drogi", "dróg"];

export function plural(n: number, [one, few, many]: Forms): string {
  if (n === 1) return one;
  const lastDigit = n % 10;
  const lastTwo = n % 100;
  if (lastDigit >= 2 && lastDigit <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return few;
  return many;
}

export function countLabel(n: number, forms: Forms): string {
  return `${n} ${plural(n, forms)}`;
}
```

`web/src/lib/aggregate.ts`:
```ts
import type { AreaProps, CragProps } from "@/lib/api";

function add(target: Map<number, number[]>, id: number, bands: number[]): void {
  const current = target.get(id) ?? [0, 0, 0, 0];
  target.set(id, current.map((value, index) => value + (bands[index] ?? 0)));
}

/** Grade-band totals per area: crags directly in an area, plus each sector's totals added to its parent region. */
export function aggregateBands(sectors: AreaProps[], crags: CragProps[]): Map<number, number[]> {
  const totals = new Map<number, number[]>();
  for (const crag of crags) add(totals, crag.area_id, crag.grade_bands);
  for (const sector of sectors) {
    const own = totals.get(sector.id);
    if (own && sector.parent_id !== null) add(totals, sector.parent_id, own);
  }
  return totals;
}
```

`web/src/lib/useMediaQuery.ts`:
```ts
import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");
```

- [ ] **Step 3: Uruchom testy**

Run (w `web`): `npm test` — Expected: wszystkie PASS. `npm run build` — bez błędów.

- [ ] **Step 4: Commit**

```powershell
git add web
git commit -m "feat: klient API, pasma trudności i odmiana liczebników" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Styl podkładu i warstwy danych mapy

**Files:**
- Create: `web/src/map/style.ts`, `web/src/map/layers.ts`
- Test: `web/src/map/style.test.ts`, `web/src/map/layers.test.ts`

**Interfaces:**
- Produces (`@/map/style`): `type BaseLayer = "osm" | "orto" | "topo"`, `BASE_LAYERS: { id: BaseLayer; label: string }[]`, `GLYPHS_URL`, `buildBaseStyle(base: BaseLayer, dark: boolean): StyleSpecification` (źródła i warstwy podkładu; bez danych)
- Produces (`@/map/layers`): `ZOOM = { regionsUntil: 10.5, sectorsFrom: 10, sectorsUntil: 14, looseCragsFrom: 10, sectorCragsFrom: 12.5 }`, `MAP_COLORS: Record<Theme, { brand; halo; ink; surface }>`, `regionLayers(c): LayerProps[]`, `sectorLayers(c): LayerProps[]`, `cragLayers(c): LayerProps[]`, `INTERACTIVE_LAYERS: string[]` (= `["region-points", "sector-fill", "crags-isolated", "crags-loose", "crags-sector"]`)

- [ ] **Step 1: Testy**

`web/src/map/style.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildBaseStyle, GLYPHS_URL } from "@/map/style";

const ids = (style: ReturnType<typeof buildBaseStyle>) => style.layers.map((layer) => layer.id);

describe("buildBaseStyle", () => {
  it("domyślny podkład: OSM z cieniowaniem Geoportalu", () => {
    const style = buildBaseStyle("osm", false);
    expect(ids(style)).toEqual(["background", "base", "hillshade"]);
    expect(style.glyphs).toBe(GLYPHS_URL);
    expect(JSON.stringify(style.sources)).toContain("tile.openstreetmap.org");
    expect(JSON.stringify(style.sources)).toContain("ShadedRelief");
    expect(JSON.stringify(style.sources)).toContain("{bbox-epsg-3857}");
  });

  it("ortofotomapa i OpenTopoMap bez cieniowania", () => {
    expect(ids(buildBaseStyle("orto", false))).toEqual(["background", "base"]);
    expect(JSON.stringify(buildBaseStyle("orto", false).sources)).toContain("ORTOFOTOMAPA");
    expect(JSON.stringify(buildBaseStyle("topo", false).sources)).toContain("opentopomap.org");
  });

  it("w ciemnym motywie przyciemnia podkład", () => {
    const base = buildBaseStyle("osm", true).layers.find((layer) => layer.id === "base");
    expect(base).toMatchObject({ paint: { "raster-brightness-max": 0.55 } });
    const light = buildBaseStyle("osm", false).layers.find((layer) => layer.id === "base");
    expect(light).toMatchObject({ paint: { "raster-brightness-max": 1 } });
  });
});
```

`web/src/map/layers.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { cragLayers, INTERACTIVE_LAYERS, MAP_COLORS, regionLayers, sectorLayers, ZOOM } from "@/map/layers";

const colors = MAP_COLORS.light;

describe("warstwy mapy", () => {
  it("regiony znikają po przybliżeniu", () => {
    for (const layer of regionLayers(colors)) expect(layer.maxzoom).toBe(ZOOM.regionsUntil);
  });

  it("sektory widoczne w środkowym zakresie", () => {
    for (const layer of sectorLayers(colors)) {
      expect(layer.minzoom).toBe(ZOOM.sectorsFrom);
      expect(layer.maxzoom).toBe(ZOOM.sectorsUntil);
    }
  });

  it("test_crag_groups_have_zoom_gates", () => {
    const byId = Object.fromEntries(cragLayers(colors).map((layer) => [layer.id, layer]));
    expect(byId["crags-isolated"].minzoom).toBeUndefined();
    expect(byId["crags-isolated"].filter).toEqual(["==", ["get", "area_kind"], "obszar"]);
    expect(byId["crags-loose"].minzoom).toBe(ZOOM.looseCragsFrom);
    expect(byId["crags-loose"].filter).toEqual(["==", ["get", "area_kind"], "region"]);
    expect(byId["crags-sector"].minzoom).toBe(ZOOM.sectorCragsFrom);
    expect(byId["crags-sector"].filter).toEqual(["==", ["get", "area_kind"], "sektor"]);
  });

  it("klikalne są tylko punkty i obrysy", () => {
    const all = [...regionLayers(colors), ...sectorLayers(colors), ...cragLayers(colors)].map((layer) => layer.id);
    for (const id of INTERACTIVE_LAYERS) expect(all).toContain(id);
  });
});
```

- [ ] **Step 2: Implementacja**

`web/src/map/style.ts`:
```ts
import type { StyleSpecification } from "maplibre-gl";

export type BaseLayer = "osm" | "orto" | "topo";

export const BASE_LAYERS: { id: BaseLayer; label: string }[] = [
  { id: "osm", label: "Mapa + cieniowanie" },
  { id: "orto", label: "Ortofotomapa" },
  { id: "topo", label: "OpenTopoMap" },
];

export const GLYPHS_URL = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

const GEOPORTAL = "https://mapy.geoportal.gov.pl/wss/service/PZGIK";
const HILLSHADE_URL =
  `${GEOPORTAL}/NMT/GRID1/WMS/ShadedRelief?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=Raster&STYLES=` +
  "&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE";
const ORTO_URL =
  `${GEOPORTAL}/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA` +
  "&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}";

const BASE_SOURCES = {
  osm: { tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], maxzoom: 19, attribution: "© OpenStreetMap" },
  orto: { tiles: [ORTO_URL], maxzoom: 19, attribution: "© GUGiK (Geoportal)" },
  topo: { tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"], maxzoom: 17, attribution: "© OpenTopoMap (CC-BY-SA)" },
} as const;

export function buildBaseStyle(base: BaseLayer, dark: boolean): StyleSpecification {
  const source = BASE_SOURCES[base];
  const style: StyleSpecification = {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      base: { type: "raster", tiles: [...source.tiles], tileSize: 256, maxzoom: source.maxzoom, attribution: source.attribution },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": dark ? "#26201c" : "#e9ddc6" } },
      {
        id: "base",
        type: "raster",
        source: "base",
        paint: { "raster-brightness-max": dark ? 0.55 : 1, "raster-saturation": dark ? -0.3 : 0 },
      },
    ],
  };
  if (base === "osm") {
    style.sources.hillshade = {
      type: "raster",
      tiles: [HILLSHADE_URL],
      tileSize: 256,
      attribution: "© GUGiK (Geoportal)",
    };
    style.layers.push({
      id: "hillshade",
      type: "raster",
      source: "hillshade",
      minzoom: 8,
      paint: { "raster-opacity": dark ? 0.25 : 0.35 },
    });
  }
  return style;
}
```

`web/src/map/layers.ts`:
```ts
import type { ExpressionSpecification } from "maplibre-gl";
import type { LayerProps } from "react-map-gl/maplibre";
import type { Theme } from "@/lib/theme";

export const ZOOM = {
  regionsUntil: 10.5,
  sectorsFrom: 10,
  sectorsUntil: 14,
  looseCragsFrom: 10,
  sectorCragsFrom: 12.5,
} as const;

export interface MapColors {
  brand: string;
  halo: string;
  ink: string;
  surface: string;
}

export const MAP_COLORS: Record<Theme, MapColors> = {
  light: { brand: "#C2541B", halo: "#F4ECDD", ink: "#2B2420", surface: "#E6D8BF" },
  dark: { brand: "#E2763A", halo: "#1D1916", ink: "#EDE3D2", surface: "#2E2722" },
};

export const INTERACTIVE_LAYERS = ["region-points", "sector-fill", "crags-isolated", "crags-loose", "crags-sector"];

const FONT = ["Noto Sans Bold"];
const e = (expression: unknown) => expression as ExpressionSpecification;
const fadeOut = (until: number) => e(["interpolate", ["linear"], ["zoom"], until - 0.5, 1, until, 0]);
const fadeIn = (from: number) => e(["interpolate", ["linear"], ["zoom"], from, 0, from + 0.5, 1]);

function labelPaint(c: MapColors, opacity: ExpressionSpecification | number = 1) {
  return { "text-color": c.ink, "text-halo-color": c.halo, "text-halo-width": 1.5, "text-opacity": opacity };
}

export function regionLayers(c: MapColors): LayerProps[] {
  const opacity = fadeOut(ZOOM.regionsUntil);
  return [
    {
      id: "region-points",
      type: "circle",
      maxzoom: ZOOM.regionsUntil,
      paint: {
        "circle-radius": 8,
        "circle-color": c.brand,
        "circle-stroke-color": c.halo,
        "circle-stroke-width": 2,
        "circle-opacity": opacity,
        "circle-stroke-opacity": opacity,
      },
    },
    {
      id: "region-labels",
      type: "symbol",
      maxzoom: ZOOM.regionsUntil,
      layout: {
        "text-field": e(["concat", ["get", "name"], " · ", ["to-string", ["get", "crag_count"]]]),
        "text-font": FONT,
        "text-size": 13,
        "text-offset": [0, 1.2],
        "text-anchor": "top",
      },
      paint: labelPaint(c, opacity),
    },
  ];
}

export function sectorLayers(c: MapColors): LayerProps[] {
  const { sectorsFrom: from, sectorsUntil: until } = ZOOM;
  const visible = e(["interpolate", ["linear"], ["zoom"], from, 0, from + 0.5, 1, until - 0.5, 1, until, 0]);
  return [
    {
      id: "sector-fill",
      type: "fill",
      minzoom: from,
      maxzoom: until,
      paint: { "fill-color": c.surface, "fill-opacity": e(["*", 0.35, visible]) },
    },
    {
      id: "sector-outline",
      type: "line",
      minzoom: from,
      maxzoom: until,
      paint: { "line-color": c.brand, "line-width": 1.2, "line-opacity": visible },
    },
    {
      id: "sector-labels",
      type: "symbol",
      minzoom: from,
      maxzoom: until,
      layout: { "text-field": e(["get", "name"]), "text-font": FONT, "text-size": 12 },
      paint: labelPaint(c, visible),
    },
  ];
}

export function cragLayers(c: MapColors): LayerProps[] {
  const groups: { id: string; kind: string; minzoom?: number }[] = [
    { id: "crags-isolated", kind: "obszar" },
    { id: "crags-loose", kind: "region", minzoom: ZOOM.looseCragsFrom },
    { id: "crags-sector", kind: "sektor", minzoom: ZOOM.sectorCragsFrom },
  ];
  return groups.flatMap(({ id, kind, minzoom }) => {
    const filter = e(["==", ["get", "area_kind"], kind]);
    const opacity = minzoom === undefined ? 1 : fadeIn(minzoom);
    return [
      {
        id,
        type: "circle",
        ...(minzoom === undefined ? {} : { minzoom }),
        filter,
        paint: {
          "circle-radius": e(["interpolate", ["linear"], ["zoom"], 9, 4, 15, 7]),
          "circle-color": c.brand,
          "circle-stroke-color": c.halo,
          "circle-stroke-width": 1.5,
          "circle-opacity": opacity,
          "circle-stroke-opacity": opacity,
        },
      },
      {
        id: `${id}-labels`,
        type: "symbol",
        minzoom: Math.max(minzoom ?? 0, 12),
        filter,
        layout: {
          "text-field": e(["get", "name"]),
          "text-font": FONT,
          "text-size": 11,
          "text-offset": [0, 0.9],
          "text-anchor": "top",
          "text-optional": true,
        },
        paint: labelPaint(c),
      },
    ] satisfies LayerProps[];
  });
}
```

- [ ] **Step 3: Uruchom testy**

Run (w `web`): `npm test`, `npm run build` — Expected: PASS, bez błędów TypeScript (jeśli kompilator nie przyjmuje literału w miejscu `LayerProps`, użyj pomocnika `e(...)` albo jawnego typu zamiast zmieniać kształt warstw).

- [ ] **Step 4: Commit**

```powershell
git add web
git commit -m "feat: styl podkładu (OSM, Geoportal, OpenTopoMap) i warstwy danych mapy" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Komponenty interfejsu mapy

**Files:**
- Create: `web/src/components/Chip.tsx`, `web/src/components/GradeBar.tsx`, `web/src/map/selection.ts`, `web/src/map/TopBar.tsx`, `web/src/map/LayerSwitcher.tsx`, `web/src/map/DetailCard.tsx`
- Test: `web/src/components/GradeBar.test.tsx`, `web/src/map/DetailCard.test.tsx`, `web/src/map/LayerSwitcher.test.tsx`

**Interfaces:**
- Consumes: `useTheme` (Task 2), `BAND_COLORS`, `BAND_LABELS`, `countLabel`, `SKALY`, `DROGI`, `useIsDesktop`, typy `AreaProps`, `CragProps` (Task 3), `BASE_LAYERS`, `BaseLayer` (Task 4), shadcn `Button`, `Drawer*`.
- Produces:
  - `Chip({children})`
  - `GradeBar({ bands: number[] })` — nic nie renderuje przy sumie 0; segmenty z `title` = etykieta pasma i liczba
  - `type Selection = { type: "region" | "sektor"; area: AreaProps; bands: number[] } | { type: "crag"; crag: CragProps }`
  - `TopBar()` — pływający pasek: logo, pole wyszukiwania (wyłączone, placeholder „Szukaj skały lub drogi…”, `title="Wyszukiwarka w przygotowaniu"`), `ThemeToggle`
  - `LayerSwitcher({ value: BaseLayer; onChange(base: BaseLayer): void })` — przyciski z `aria-pressed`
  - `DetailCardBody({ selection, onZoom, onOpenCrag })` i `DetailCard({ selection, onClose, onZoom(bbox), onOpenCrag(slug) })` — panel z prawej na komputerze, Drawer na telefonie

- [ ] **Step 1: Testy**

`web/src/components/GradeBar.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GradeBar } from "@/components/GradeBar";
import { ThemeProvider } from "@/lib/theme";

const renderBar = (bands: number[]) =>
  render(
    <ThemeProvider>
      <GradeBar bands={bands} />
    </ThemeProvider>,
  );

describe("GradeBar", () => {
  it("rysuje segmenty proporcjonalnie", () => {
    renderBar([1, 1, 0, 2]);
    const segments = screen.getAllByTestId("grade-segment");
    expect(segments).toHaveLength(3);
    expect(segments[0]).toHaveStyle({ width: "25%" });
    expect(segments[2]).toHaveStyle({ width: "50%" });
    expect(segments[2]).toHaveAttribute("title", "≥ VI.5: 2");
  });

  it("nic nie rysuje bez dróg z wyceną", () => {
    const { container } = renderBar([0, 0, 0, 0]);
    expect(container).toBeEmptyDOMElement();
  });
});
```

`web/src/map/DetailCard.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AreaProps, CragProps } from "@/lib/api";
import { ThemeProvider } from "@/lib/theme";
import { DetailCardBody } from "@/map/DetailCard";

const region: AreaProps = {
  id: 1, name: "Dolina Kobylańska", slug: "dolina-kobylanska", kind: "region", parent_id: 34,
  crag_count: 49, route_count: 645, center: [19.75, 50.15], bbox: [19.7, 50.1, 19.8, 50.2],
};
const crag: CragProps = {
  id: 7, name: "Żabi Koń", slug: "zabi-kon", area_id: 102, area_kind: "sektor", in_sector: true,
  route_count: 1, grade_bands: [1, 0, 0, 0],
};

const wrap = (ui: ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe("DetailCardBody", () => {
  it("region: liczby po polsku i przybliżanie", async () => {
    const onZoom = vi.fn();
    wrap(<DetailCardBody selection={{ type: "region", area: region, bands: [5, 4, 3, 1] }} onZoom={onZoom} onOpenCrag={vi.fn()} />);
    expect(screen.getByText("Region")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dolina Kobylańska" })).toBeInTheDocument();
    expect(screen.getByText("49 skał")).toBeInTheDocument();
    expect(screen.getByText("645 dróg")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Przybliż" }));
    expect(onZoom).toHaveBeenCalledWith([19.7, 50.1, 19.8, 50.2]);
  });

  it("skała: otwieranie strony skały", async () => {
    const onOpenCrag = vi.fn();
    wrap(<DetailCardBody selection={{ type: "crag", crag }} onZoom={vi.fn()} onOpenCrag={onOpenCrag} />);
    expect(screen.getByText("Skała")).toBeInTheDocument();
    expect(screen.getByText("1 droga")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Otwórz skałę" }));
    expect(onOpenCrag).toHaveBeenCalledWith("zabi-kon");
  });
});
```

`web/src/map/LayerSwitcher.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LayerSwitcher } from "@/map/LayerSwitcher";

describe("LayerSwitcher", () => {
  it("zaznacza aktywny podkład i zmienia go", async () => {
    const onChange = vi.fn();
    render(<LayerSwitcher value="osm" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Mapa + cieniowanie" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Ortofotomapa" }));
    expect(onChange).toHaveBeenCalledWith("orto");
  });
});
```

- [ ] **Step 2: Implementacja**

`web/src/components/Chip.tsx`:
```tsx
import type { ReactNode } from "react";

export function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-block rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground">{children}</span>;
}
```

`web/src/components/GradeBar.tsx`:
```tsx
import { BAND_COLORS, BAND_LABELS } from "@/lib/grades";
import { useTheme } from "@/lib/theme";

export function GradeBar({ bands }: { bands: number[] }) {
  const { theme } = useTheme();
  const total = bands.reduce((sum, value) => sum + value, 0);
  if (total === 0) return null;
  return (
    <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-label="Rozkład trudności">
      {bands.map((count, band) =>
        count > 0 ? (
          <span
            key={band}
            data-testid="grade-segment"
            title={`${BAND_LABELS[band]}: ${count}`}
            className="block h-full rounded-sm"
            style={{ width: `${(count / total) * 100}%`, backgroundColor: BAND_COLORS[theme][band] }}
          />
        ) : null,
      )}
    </div>
  );
}
```

`web/src/map/selection.ts`:
```ts
import type { AreaProps, CragProps } from "@/lib/api";

export type Selection =
  | { type: "region" | "sektor"; area: AreaProps; bands: number[] }
  | { type: "crag"; crag: CragProps };
```

`web/src/map/TopBar.tsx`:
```tsx
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

const floating = "rounded-[10px] bg-background shadow-[0_4px_14px_rgba(43,36,32,0.18)]";

export function TopBar() {
  return (
    <header className={`absolute inset-x-3 top-3 z-10 flex items-center gap-3 px-3 py-2 lg:right-auto lg:w-[520px] ${floating}`}>
      <Logo />
      <input
        type="search"
        disabled
        placeholder="Szukaj skały lub drogi…"
        title="Wyszukiwarka w przygotowaniu"
        className="min-w-0 flex-1 rounded-md border border-input bg-card px-3 py-1.5 text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
      <ThemeToggle />
    </header>
  );
}
```

`web/src/map/LayerSwitcher.tsx`:
```tsx
import { BASE_LAYERS, type BaseLayer } from "@/map/style";

export function LayerSwitcher({ value, onChange }: { value: BaseLayer; onChange: (base: BaseLayer) => void }) {
  return (
    <div
      role="group"
      aria-label="Podkład mapy"
      className="absolute bottom-8 right-3 z-10 flex flex-col gap-1 rounded-[10px] bg-background p-1.5 text-xs shadow-[0_4px_14px_rgba(43,36,32,0.18)]"
    >
      {BASE_LAYERS.map((layer) => (
        <button
          key={layer.id}
          type="button"
          aria-pressed={layer.id === value}
          onClick={() => onChange(layer.id)}
          className="rounded-md px-2.5 py-1 text-left aria-pressed:bg-primary aria-pressed:text-primary-foreground hover:bg-accent"
        >
          {layer.label}
        </button>
      ))}
    </div>
  );
}
```

`web/src/map/DetailCard.tsx`:
```tsx
import { Chip } from "@/components/Chip";
import { GradeBar } from "@/components/GradeBar";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { countLabel, DROGI, SKALY } from "@/lib/plural";
import { useIsDesktop } from "@/lib/useMediaQuery";
import type { Selection } from "@/map/selection";

type BBox = [number, number, number, number];

interface BodyProps {
  selection: Selection;
  onZoom: (bbox: BBox) => void;
  onOpenCrag: (slug: string) => void;
}

const KIND_LABEL = { region: "Region", sektor: "Sektor", crag: "Skała" } as const;

export function DetailCardBody({ selection, onZoom, onOpenCrag }: BodyProps) {
  const name = selection.type === "crag" ? selection.crag.name : selection.area.name;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{KIND_LABEL[selection.type]}</p>
      <h2 className="font-display text-2xl font-extrabold leading-tight tracking-tight">{name}</h2>
      <div className="flex flex-wrap gap-1.5">
        {selection.type === "crag" ? (
          <Chip>{countLabel(selection.crag.route_count, DROGI)}</Chip>
        ) : (
          <>
            <Chip>{countLabel(selection.area.crag_count, SKALY)}</Chip>
            <Chip>{countLabel(selection.area.route_count, DROGI)}</Chip>
          </>
        )}
      </div>
      <GradeBar bands={selection.type === "crag" ? selection.crag.grade_bands : selection.bands} />
      {selection.type === "crag" ? (
        <Button className="mt-2" onClick={() => onOpenCrag(selection.crag.slug)}>
          Otwórz skałę
        </Button>
      ) : (
        <Button className="mt-2" onClick={() => onZoom(selection.area.bbox)}>
          Przybliż
        </Button>
      )}
    </div>
  );
}

interface CardProps extends Omit<BodyProps, "selection"> {
  selection: Selection | null;
  onClose: () => void;
}

export function DetailCard({ selection, onClose, onZoom, onOpenCrag }: CardProps) {
  const isDesktop = useIsDesktop();
  if (isDesktop) {
    if (selection === null) return null;
    return (
      <aside className="absolute right-3 top-3 z-20 w-80 rounded-[10px] bg-background p-4 shadow-[0_4px_14px_rgba(43,36,32,0.18)]">
        <button type="button" aria-label="Zamknij" onClick={onClose} className="absolute right-3 top-2 text-lg text-muted-foreground hover:text-foreground">
          ×
        </button>
        <DetailCardBody selection={selection} onZoom={onZoom} onOpenCrag={onOpenCrag} />
      </aside>
    );
  }
  return (
    <Drawer open={selection !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="px-4 pb-6">
        <DrawerTitle className="sr-only">Szczegóły</DrawerTitle>
        <DrawerDescription className="sr-only">Informacje o wybranym miejscu na mapie</DrawerDescription>
        {selection && <DetailCardBody selection={selection} onZoom={onZoom} onOpenCrag={onOpenCrag} />}
      </DrawerContent>
    </Drawer>
  );
}
```

- [ ] **Step 3: Uruchom testy**

Run (w `web`): `npm test`, `npm run build` — Expected: PASS, bez błędów.

- [ ] **Step 4: Commit**

```powershell
git add web
git commit -m "feat: komponenty mapy (pasek, karta szczegółów, podkłady, rozkład trudności)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Strona mapy i tymczasowa strona skały

**Files:**
- Create: `web/src/map/useMapData.ts`
- Modify: `web/src/map/MapPage.tsx` (cały plik), `web/src/pages/CragPage.tsx` (cały plik)
- Test: `web/src/pages/CragPage.test.tsx`

**Interfaces:**
- Consumes: wszystko z Task 2–5.
- Produces: `useMapData(): { regions?, sectors?, crags?, error: Error | null }`; `MapPage` (mapa z danymi, kliknięcia, karta, podkłady zapamiętane w `localStorage` pod `topo-base`); `CragPage` (nagłówek skały z API; topo w planie 4).

- [ ] **Step 1: Test strony skały**

`web/src/pages/CragPage.test.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/lib/theme";
import CragPage from "@/pages/CragPage";

afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string, response: Response) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response)));
  const router = createMemoryRouter([{ path: "/skaly/:slug", element: <CragPage /> }], { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe("CragPage", () => {
  it("pokazuje nagłówek skały", async () => {
    renderAt(
      "/skaly/zabi-kon",
      new Response(
        JSON.stringify({
          id: 1, name: "Żabi Koń", slug: "zabi-kon", lng: 19.75, lat: 50.15,
          path: [
            { id: 34, name: "Jura Krakowsko Częstochowska", slug: "jura", kind: "obszar" },
            { id: 100, name: "Dolina Kobylańska", slug: "dolina-kobylanska", kind: "region" },
          ],
          rock_type: "wapień", height_min: 10, height_max: 40, aspects: ["W", "NW"], approach_minutes: 10,
          child_friendly: true, description: null,
        }),
      ),
    );
    expect(await screen.findByRole("heading", { name: "Żabi Koń" })).toBeInTheDocument();
    expect(screen.getByText("Dolina Kobylańska")).toBeInTheDocument();
    expect(screen.getByText("wapień")).toBeInTheDocument();
    expect(screen.getByText("10–40 m")).toBeInTheDocument();
    expect(screen.getByText("W, NW")).toBeInTheDocument();
  });

  it("404 → nie znaleziono", async () => {
    renderAt("/skaly/nie-ma", new Response(JSON.stringify({ code: "not_found", message: "Nie znaleziono: skała" }), { status: 404 }));
    expect(await screen.findByText("Nie znaleziono skały")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implementacja**

`web/src/map/useMapData.ts`:
```ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useMapData() {
  const regions = useQuery({ queryKey: ["map", "regions"], queryFn: api.regions });
  const sectors = useQuery({ queryKey: ["map", "sectors"], queryFn: api.sectorHulls });
  const crags = useQuery({ queryKey: ["map", "crags"], queryFn: api.crags });
  return {
    regions: regions.data,
    sectors: sectors.data,
    crags: crags.data,
    error: regions.error ?? sectors.error ?? crags.error ?? null,
  };
}
```

`web/src/map/MapPage.tsx` (cały plik):
```tsx
import { useMemo, useRef, useState } from "react";
import Map, { Layer, Source, type MapLayerMouseEvent, type MapRef } from "react-map-gl/maplibre";
import { useNavigate } from "react-router";
import { aggregateBands } from "@/lib/aggregate";
import type { AreaProps, CragProps } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { DetailCard } from "@/map/DetailCard";
import { cragLayers, INTERACTIVE_LAYERS, MAP_COLORS, regionLayers, sectorLayers } from "@/map/layers";
import { LayerSwitcher } from "@/map/LayerSwitcher";
import type { Selection } from "@/map/selection";
import { BASE_LAYERS, buildBaseStyle, type BaseLayer } from "@/map/style";
import { TopBar } from "@/map/TopBar";
import { useMapData } from "@/map/useMapData";

const BASE_KEY = "topo-base";
const INITIAL_VIEW = { longitude: 19.8, latitude: 50.35, zoom: 8 };

function readBase(): BaseLayer {
  try {
    const saved = localStorage.getItem(BASE_KEY);
    return BASE_LAYERS.some((layer) => layer.id === saved) ? (saved as BaseLayer) : "osm";
  } catch {
    return "osm";
  }
}

function saveBase(base: BaseLayer): void {
  try {
    localStorage.setItem(BASE_KEY, base);
  } catch {
    // not remembered in private mode
  }
}

function byId<P extends { id: number }>(collection?: { features: { properties: P }[] }): globalThis.Map<number, P> {
  return new globalThis.Map((collection?.features ?? []).map((feature) => [feature.properties.id, feature.properties]));
}

export default function MapPage() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const mapRef = useRef<MapRef>(null);
  const [base, setBase] = useState<BaseLayer>(readBase);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [cursor, setCursor] = useState("");
  const { regions, sectors, crags, error } = useMapData();

  const style = useMemo(() => buildBaseStyle(base, theme === "dark"), [base, theme]);
  const colors = MAP_COLORS[theme];
  const index = useMemo(
    () => ({ regions: byId<AreaProps>(regions), sectors: byId<AreaProps>(sectors), crags: byId<CragProps>(crags) }),
    [regions, sectors, crags],
  );
  const bands = useMemo(
    () => aggregateBands([...index.sectors.values()], [...index.crags.values()]),
    [index],
  );

  // Feature properties coming back from MapLibre lose nested arrays (bbox, bands), so look the originals up by id.
  function handleClick(event: MapLayerMouseEvent) {
    const feature = event.features?.[0];
    if (!feature) {
      setSelection(null);
      return;
    }
    const id = Number(feature.properties?.id);
    const layer = feature.layer.id;
    if (layer === "region-points" || layer === "sector-fill") {
      const area = (layer === "region-points" ? index.regions : index.sectors).get(id);
      if (area) setSelection({ type: area.kind === "sektor" ? "sektor" : "region", area, bands: bands.get(id) ?? [0, 0, 0, 0] });
      return;
    }
    const crag = index.crags.get(id);
    if (crag) setSelection({ type: "crag", crag });
  }

  function zoomTo([minX, minY, maxX, maxY]: [number, number, number, number]) {
    mapRef.current?.fitBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      { padding: 80, duration: 800 },
    );
    setSelection(null);
  }

  return (
    <div className="fixed inset-0 bg-map-bg">
      <Map
        ref={mapRef}
        initialViewState={INITIAL_VIEW}
        mapStyle={style}
        interactiveLayerIds={INTERACTIVE_LAYERS}
        onClick={handleClick}
        onMouseEnter={() => setCursor("pointer")}
        onMouseLeave={() => setCursor("")}
        cursor={cursor}
        style={{ position: "absolute", inset: 0 }}
        attributionControl={{ compact: true }}
      >
        {sectors && (
          <Source id="sectors" type="geojson" data={sectors}>
            {sectorLayers(colors).map((layer) => (
              <Layer key={layer.id} {...layer} />
            ))}
          </Source>
        )}
        {regions && (
          <Source id="regions" type="geojson" data={regions}>
            {regionLayers(colors).map((layer) => (
              <Layer key={layer.id} {...layer} />
            ))}
          </Source>
        )}
        {crags && (
          <Source id="crags" type="geojson" data={crags}>
            {cragLayers(colors).map((layer) => (
              <Layer key={layer.id} {...layer} />
            ))}
          </Source>
        )}
      </Map>
      <TopBar />
      <LayerSwitcher
        value={base}
        onChange={(next) => {
          setBase(next);
          saveBase(next);
        }}
      />
      {error && (
        <div role="alert" className="absolute inset-x-3 top-20 z-10 rounded-[10px] bg-destructive px-4 py-2 text-sm text-white lg:w-[520px]">
          Nie udało się wczytać mapy: {error.message}
        </div>
      )}
      <DetailCard
        selection={selection}
        onClose={() => setSelection(null)}
        onZoom={zoomTo}
        onOpenCrag={(slug) => navigate(`/skaly/${slug}`)}
      />
    </div>
  );
}
```

`web/src/pages/CragPage.tsx` (cały plik):
```tsx
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { Link, useParams } from "react-router";
import { Chip } from "@/components/Chip";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { api, ApiError } from "@/lib/api";

export default function CragPage() {
  const { slug = "" } = useParams();
  const { data: crag, error, isPending } = useQuery({ queryKey: ["crag", slug], queryFn: () => api.crag(slug) });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <Link to="/" aria-label="Wróć do mapy">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      {isPending && <p className="text-muted-foreground">Wczytywanie…</p>}
      {error && (
        <p role="alert">{error instanceof ApiError && error.status === 404 ? "Nie znaleziono skały" : error.message}</p>
      )}
      {crag && (
        <>
          <nav className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <Link to="/">← Mapa</Link>
            {crag.path.map((area) => (
              <Fragment key={area.id}>
                {" · "}
                <span>{area.name}</span>
              </Fragment>
            ))}
          </nav>
          <h1 className="font-display text-4xl font-extrabold tracking-tight">{crag.name}</h1>
          <div className="flex flex-wrap gap-1.5">
            {crag.rock_type && <Chip>{crag.rock_type}</Chip>}
            {crag.height_min !== null && crag.height_max !== null && <Chip>{`${crag.height_min}–${crag.height_max} m`}</Chip>}
            {crag.aspects.length > 0 && <Chip>{crag.aspects.join(", ")}</Chip>}
            {crag.approach_minutes !== null && <Chip>{`dojście ${crag.approach_minutes} min`}</Chip>}
            {crag.child_friendly && <Chip>dla dzieci</Chip>}
          </div>
          <p className="rounded-[10px] bg-secondary p-4 text-sm text-muted-foreground">
            Topo tej skały (zdjęcia ścian z drogami) pojawi się w kolejnym etapie.
          </p>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Uruchom testy i build**

Run (w `web`): `npm test` — Expected: wszystkie PASS. `npm run build` — bez błędów.

- [ ] **Step 4: Sprawdzenie w przeglądarce (ręczne)**

```powershell
docker compose up -d db api
cd web
npm run dev
```
Otwórz http://localhost:5173. Sprawdź i opisz w raporcie:
- mapa ładuje się z podkładem OSM i cieniowaniem (w Jurze widać skałki), widać pinezki regionów z podpisami „Dolina Kobylańska · 49”;
- kliknięcie regionu otwiera kartę („49 skał”, „645 dróg”, pasek trudności), „Przybliż” przybliża do doliny; widać obrysy sektorów, przy dalszym przybliżeniu skały z nazwami;
- kliknięcie skały → „Otwórz skałę” → strona `/skaly/<slug>` z nagłówkiem i chipami;
- przełącznik motywu zmienia kolory interfejsu i przyciemnia mapę; wybór podkładu (Ortofotomapa, OpenTopoMap) działa i jest pamiętany po odświeżeniu;
- przy wąskim oknie (≤ 1023 px) karta otwiera się od dołu.
W konsoli przeglądarki nie może być błędów (poza ewentualnymi ostrzeżeniami o brakujących kafelkach poza Polską).

- [ ] **Step 5: Commit**

```powershell
git add web
git commit -m "feat: mapa skał z trzema poziomami i tymczasowa strona skały" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Po zakończeniu planu 3

- Strona główna: mapa w stylu „Przewodnik” z regionami, sektorami i skałami; motyw jasny/ciemny; trzy podkłady.
- Następny krok: plan 4 — strona skały (układ A z `2026-10-08-frontend-design.md` §4): przeglądarka 2D zdjęć ścian z liniami i wpinkami, lista dróg, podświetlanie w obie strony.

## Wnioski z wykonania (do uwzględnienia w kolejnych planach)

- **MapLibre 6 + Vite:** worker trzeba wskazać jawnie (`web/src/map/worker.ts`, `setWorkerUrl` z importem `?url`) — inaczej mapa nie ładuje danych GeoJSON ani w dev, ani w buildzie. Wyrażenia z `["zoom"]` muszą być na najwyższym poziomie `interpolate`/`step`; test `validateStyleMin` w `layers.test.ts` tego pilnuje.
- **Klikalność a zanikanie warstw:** `isClickableAt` (w `layers.ts`) decyduje o klikaniu i kursorze — przy zmianie progów w `ZOOM` zmieniają się razem. W planie 4 warto wynieść logikę `handleClick` (cechy + zoom + indeks → `Selection`) do czystej funkcji z testem (MapLibre nie działa w jsdom).
- **Spec §6.1 (`2026-10-08-topo-design.md`) jest nieaktualny w części mapy:** obowiązuje `2026-10-08-frontend-design.md` (liczba skał przy regionie, piny w kolorze akcentu, karta zamiast przejścia od razu na stronę skały). Do odnotowania w spec.
- **Drobne na później:** cień paneli powtarzany w 3 plikach → token `--shadow-float` (plan 4); brak `color-scheme` w ciemnym motywie; `font-heading` w shadcn Drawer niezdefiniowany; skrypt motywu w `body` zamiast `head`; domyślne ponowienia react-query opóźniają komunikat o niedostępnym API (~7 s) i 404 skały; brak testów 500 dla mapy/strony skały; `GradeBar` bez zabezpieczenia na >4 pasma.
- **Poprawki od użytkownika (po przeglądzie mapy):** sektory mają zostawać widoczne trochę dłużej przy przybliżaniu (podnieść `ZOOM.sectorsUntil`, razem z progami `isClickableAt`); obrysy sektorów zostają też przy bardzo dużym przybliżeniu (bez górnego `maxzoom` dla linii), ale nazwy sektorów znikają jak dotąd.
- **Bogatsza karta podglądu (plan 4, od użytkownika):** karta skały pobiera po kliknięciu `/api/crags/{slug}` i pokazuje zakres wycen („V – VI.3”, skrajne wg `grade_sort`) oraz krótką listę dróg (numer, nazwa, plakietka wyceny w kolorze pasma; pierwsze ~8 + „wszystkie drogi →”). Karta regionu/sektora: zakres wycen (wymaga dodania najłatwiejszej/najtrudniejszej wyceny do właściwości w `/api/map/areas`) i lista skał z liczbą dróg zamiast listy dróg.
- **Niesprawdzone ręcznie:** karta na telefonie (Drawer), podkłady Ortofotomapa/OpenTopoMap z danymi, komunikat przy wyłączonym API.
