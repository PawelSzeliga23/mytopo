# Plan 8: wyszukiwarka, strony obszarów, publiczne zmiany — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wyszukiwarka w pasku mapy (podpowiedzi, chipy filtrów, akcje wyboru), strony `/obszary/:slug` dla obszaru, regionu i sektora, publiczne „Ostatnie zmiany” z poprawkami z planu 6.

**Architecture:** Jedno publiczne `GET /api/search` (SQL z `unaccent`, rekurencyjny zbiór obszarów) zwraca grupy wyników; front `SearchBox` w `TopBar` woła je z opóźnieniem i oddaje wybór do `MapPage` (mapa przybliża i zaznacza) albo nawiguje do strony skały z `?droga` / `?sciana`. `GET /api/areas/{slug}` dostaje skały z podsektorów; nowa leniwa strona `AreaPage` z małą mapą MapLibre.

**Tech Stack:** FastAPI + SQLAlchemy (SQL tekstowy), Postgres `unaccent`; React 19 + TanStack Query + react-map-gl/MapLibre, vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-plan-8-wyszukiwarka-obszary-design.md`

## Global Constraints

- Teksty po polsku, kod i komentarze po angielsku; system wizualny „Przewodnik” (Fraunces/Plex Sans, tokeny shadcn, `--brand`).
- Komputer od 1024 px (`useIsDesktop`), telefon jedna kolumna.
- Testy z kodem, uruchamiane na końcu zadania: `docker compose run --rm api pytest`, `cd web; npx vitest run; npx tsc -b; npx oxlint`. Bez E2E.
- Inline na branchu `plan-8-wyszukiwarka-obszary`, commit na zadanie z `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Przed scaleniem: uruchomić całą aplikację (API, front dev, worker głębi) dla użytkownika.

## Review Focus

- Fraza z polskimi znakami i bez nich daje te same wyniki („zabi” ↔ „Żabi”) — test w Task 1.
- Znaki `%` i `_` w frazie nie działają jak symbole wieloznaczne — test w Task 1.
- Region ze skałami bezpośrednio i w sektorach: oba rodzaje na stronie — test w Task 2.
- Enter bez zaznaczenia otwiera pierwszą podpowiedź z kolejności grup (obszary, skały, ściany, drogi) — test w Task 4.
- `?droga` drogi bez linii na żadnym zdjęciu: strona skały otwiera się normalnie z zaznaczoną drogą na liście — test w Task 4.

---

### Task 1: `GET /api/search`
**Files:** Create `api/alembic/versions/0008_unaccent.py`, `api/topo/search.py`, `api/topo/api/search.py`, `api/tests/test_search.py`; Modify `api/topo/api/app.py`, `api/topo/schemas.py`.
- [ ] Migracja: `CREATE EXTENSION IF NOT EXISTS unaccent` (downgrade: `DROP EXTENSION IF EXISTS unaccent`). Funkcja niemodyfikowalna nie jest potrzebna (bez indeksu; dane ~20 tys. dróg).
- [ ] `search.py`: `search(session, q, type, grade_min_sort, grade_max_sort, area_id, offset) -> dict` — `_pattern(q)` escapuje `\ % _`; wspólny warunek `unaccent(lower(x.name)) LIKE unaccent(lower(:pattern)) ESCAPE '\'`; porządek `(unaccent(lower(name)) LIKE unaccent(lower(:prefix))) DESC, name`; obszary w filtrze: `WITH RECURSIVE sub AS (SELECT id FROM area WHERE id=:area UNION ALL SELECT a.id FROM area a JOIN sub ON a.parent_id = sub.id)`; sumy przez `count(*) OVER ()`.
- [ ] Endpoint z walidacją (`grade_sort` z `topo.grades`; nieznana wycena / obszar → 422 `invalid_grade` / 404).
- [ ] Testy wg spec §5 → commit `feat: wyszukiwarka w API`.

### Task 2: Obszary, zmiany publiczne, poprawki API
**Files:** Modify `api/topo/queries.py` (`crag_summaries(area_id, recursive=True)` z `sector_name`), `api/topo/api/areas.py`, `api/topo/schemas.py`, `api/topo/api/changes.py` (GET bez `current_editor`), `api/topo/changes.py` (nazwy obszarów w różnicach `area_id`/`parent_id`), `api/topo/api/auth.py` (`/me` → `{"nick": null}`), testy.
- [ ] Testy → implementacja → `pytest` → commit `feat: obszary ze skałami z sektorów, publiczne zmiany, nazwy obszarów w historii`.

### Task 3: Front — strona obszaru
**Files:** Create `web/src/pages/AreaPage.tsx` (+ test), `web/src/area/AreaMap.tsx`; Modify `web/src/App.tsx`, `web/src/lib/api.ts` (`AreaDetail`, `api.area`), `web/src/map/DetailCard.tsx` („Lista skał”), `web/src/pages/CragPage.tsx` (ścieżka jako linki).
- [ ] Test strony (atrapa `AreaMap`): region — sektory, skały z podsektorów, sortowanie, linki; obszar — tylko regiony → commit `feat: strony regionu i sektora`.

### Task 4: Front — wyszukiwarka, `?droga`/`?sciana`, poprawki historii
**Files:** Create `web/src/map/SearchBox.tsx` (+ test), `web/src/lib/useDebounced.ts`; Modify `web/src/map/TopBar.tsx`, `web/src/map/MapPage.tsx` (`focusArea`, `selectCrag` z wyszukiwarki), `web/src/lib/api.ts` (`search`), `web/src/pages/CragPage.tsx` (parametry), `web/src/history/format.ts` (`isRestore`), `web/src/history/ConflictDialog.tsx`, `web/src/lib/session.tsx` (`/me` z `nick: null`), `web/src/components/UserMenu.tsx` (link zmian dla wszystkich), `web/src/pages/ChangesPage.tsx` (bez wymogu logowania, jeśli jest).
- [ ] Testy (wyszukiwarka, strona skały z parametrami, historia) → commit `feat: wyszukiwarka na mapie`.

### Task 5: Sprawdzenie, przegląd, uruchomienie dla użytkownika
- [ ] Całe testy; przegląd w przeglądarce (Playwright): wyszukiwanie, strona regionu, zmiany bez logowania.
- [ ] Przegląd gałęzi, poprawki (RED→GREEN).
- [ ] „Wnioski z wykonania”; uruchomienie API + front + worker; pytanie o scalenie.
