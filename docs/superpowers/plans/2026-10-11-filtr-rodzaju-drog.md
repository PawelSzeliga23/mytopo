# Plan: globalny filtr dróg sportowych / tradowych

Spec: `docs/superpowers/specs/2026-10-11-filtr-rodzaju-drog-design.md`. Gałąź `filtr-rodzaju-drog`, wykonanie inline. Testy pisane razem z kodem, uruchamiane na końcu.

## Zadanie 1: API

- `api/alembic/versions/0010_rodzaj_drogi.py`: `CREATE VIEW route_kind` (sport, gdy punkt `ring`/`hak`/`ucho` na linii drogi albo `protection ~* '\d+\s*[rsh]\M'`), w dół `DROP VIEW`.
- `api/topo/queries.py`:
  - `crag_summaries`: `LEFT JOIN route_kind`, kolumny z `FILTER` dla sport/trad, w wyniku `by_kind`.
  - `area_stats(session, ids | None, kind=None)` zamiast `area_grade_bands`: rekurencyjne poddrzewo, `crag_count` (skały z co najmniej jedną drogą danego wariantu dla sport/trad), `route_count`, `grade_bands` × all/sport/trad.
- `api/topo/api/map.py`: `map_crags` przepuszcza `by_kind`; `map_areas` dokłada liczby z `area_stats` (płaskie + `by_kind`).
- `api/topo/api/areas.py` + `schemas.py`: `AreaChild` i `CragSummary` z `by_kind`.
- `api/topo/api/crags.py` + `RouteOut.kind`: rodzaje z widoku dla dróg skały.
- `api/topo/search.py` + `api/topo/api/search.py`: parametr `kind`.
- Testy: `tests/test_route_kind.py` (reguła), uzupełnienia w `test_api_map.py`, `test_api_areas.py`, `test_api_crags.py`, `test_search.py`.

## Zadanie 2: stan filtra i przełącznik

- `web/src/lib/routeKind.tsx`: `RouteKind = "all" | "sport" | "trad"`, `RouteKindProvider` (localStorage `topo-route-kind`, try/catch), `useRouteKind()`, `applyKind(item, kind)`, `hasRoutes(item)`.
- `web/src/components/RouteKindToggle.tsx`: trzy segmenty (`radiogroup`) od `sm`, pod `sm` jedna pigułka przełączająca kolejny stan.
- `App.tsx`: provider; `TopBar`, nagłówki `CragPage` i `AreaPage`: przełącznik.
- `web/src/lib/api.ts`: typy `by_kind`, `RouteOut.kind`, `SearchParams.kind`.

## Zadanie 3: mapa i strona obszaru

- `MapPage`: kolekcje z `useMapData` przepuszczone przez filtr (rzutowanie `applyKind` + usunięcie zer) tylko w trybie przeglądania i bez oczekującego `?przesun`; centra skał i szukanie przesuwanej skały z danych pełnych.
- `AreaPage`: dzieci i skały przez `applyKind`, bez zer; sumy w chipach z przefiltrowanych.
- Testy: `lib/routeKind.test.ts` (rzutowanie, filtrowanie kolekcji).

## Zadanie 4: strona skały i wyszukiwarka

- `crag/scene.ts`: argument `kind` (domyślnie `all`); droga innego rodzaju → `emphasis: "muted"`, kolor szary, warstwa najniższa. `WallCanvas`, `Wall3D`: `muted` w `WIDTH`/`OPACITY`, rodzaj z `useRouteKind()`.
- `RouteList`: wiersze dróg spoza filtra wygaszone (`opacity-40`, zaznaczony/wskazany normalnie).
- `SearchBox`: `kind` w parametrach zapytania (i kluczu).
- Testy: `crag/scene.test.ts` (muted), `RouteKindToggle`/provider.

## Zadanie 5: sprawdzenie

- `pytest`, `vitest`, `tsc`; przeklikanie w przeglądarce (mapa, region, skała, wyszukiwarka, przełącznik po odświeżeniu).
