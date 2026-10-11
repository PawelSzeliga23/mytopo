# Globalny filtr: drogi sportowe / tradowe — projekt

Ustalone z użytkownikiem 2026-10-11 (brainstorming). Cel: jednym przełącznikiem zobaczyć w całej aplikacji tylko drogi sportowe albo tylko tradowe — np. „ile jest łatwych sportowych” w regionie czy sektorze.

## Klasyfikacja

Droga jest **sportowa**, gdy jakakolwiek jej linia na topo ma punkt `ring`, `hak` lub `ucho` **albo** opis asekuracji (`route.protection`, z importu) wymienia ringi, spity lub haki (`4r + ST`, `3s`, `1h`; wyrażenie `\d+\s*[rsh]\M`, bez rozróżniania wielkości liter — `2ST` to dwa stanowiska, nie spity). W przeciwnym razie **tradowa**. Nie ma grupy „nieznane”.

Dane po imporcie (11 908 dróg): ok. 9 tys. sportowych, ok. 2,9 tys. tradowych.

## Przełącznik

- Trzy stany: **Wszystkie / Sport / Trad**, domyślnie „Wszystkie”.
- W górnym pasku: na mapie obok wyszukiwarki, na stronie skały i obszaru obok menu użytkownika. Na telefonie jedna pigułka przełączająca kolejny stan.
- Zapamiętany w przeglądarce (`localStorage`, jak motyw), obowiązuje na wszystkich stronach.

## Zachowanie przy włączonym filtrze

- **Statystyki wszędzie liczą tylko drogi z filtra:** liczba dróg i skał, pasek wycen (`GradeBar`), zakres wycen — na mapie (karta skały, sektora, regionu), na stronie obszaru (podobszary, skały), w podpowiedziach wyszukiwarki.
- **Mapa:** skały, sektory i regiony bez ani jednej drogi danego rodzaju znikają. W trybach edycji mapy (przesuwanie skały, nowy sektor, dodawanie skały) filtr nie działa — widać wszystko.
- **Strona obszaru:** podobszary i skały bez dróg danego rodzaju znikają z list.
- **Strona skały:** drogi spoza filtra zostają na liście i na topo 2D/2.5D, ale są wygaszone (szare, półprzezroczyste) i nadal klikalne; zaznaczona albo wskazana droga rysuje się normalnie.
- **Wyszukiwarka:** drogi spoza filtra nie pojawiają się; skały i obszary — tylko gdy mają drogę danego rodzaju.
- Edytory (topo, 2.5D) filtr ignorują.

## Architektura

**Rodzaj liczony na bieżąco w SQL** — bez przechowywanej kolumny, więc nic się nie rozjeżdża przy zapisie topo, edycji drogi, imporcie czy cofaniu.

- Migracja `0010`: widok `route_kind(route_id, kind)` z regułą powyżej (jedno miejsce reguły).
- `crag_summaries` (skały na mapie i stronie obszaru): płaskie pola jak dziś (= wszystkie drogi) **plus** `by_kind: {sport: {...}, trad: {...}}` z tymi samymi polami (`route_count`, `grade_bands`, `grade_min(_sort)`, `grade_max(_sort)`).
- Obszary (`/api/map/areas`, dzieci w `/api/areas/{slug}`): nowa funkcja `area_stats` liczy dla całego poddrzewa `crag_count`, `route_count`, `grade_bands` w wariantach all/sport/trad (zastępuje `area_grade_bands`; geometria nadal z `area_geom`). Płaskie pola + `by_kind`.
- `/api/crags/{slug}`: każda droga ma `kind`.
- `/api/search`: parametr `kind=sport|trad` filtruje drogi i ogranicza skały/obszary do tych z drogą danego rodzaju; liczba dróg skały w podpowiedzi liczy tylko ten rodzaj. (Filtr po stronie serwera, bo wyniki są stronicowane i mają sumy.)
- Front: kontekst `RouteKindProvider` + `useRouteKind()`; pomocnik `applyKind(item, kind)` podmienia płaskie pola na wariant z `by_kind`, więc istniejący kod (karty, `GradeBar`, sumy, sortowanie) działa bez zmian; elementy z zerem dróg są odfiltrowywane. Zmiana filtra nie pobiera danych od nowa (poza wyszukiwarką).
- Topo: `buildScene` dostaje rodzaj z filtra; linie dróg spoza niego mają nowe wyróżnienie `muted` (szary kolor, krycie ok. 0,3, najniższa warstwa).

## Testy

- API: reguła klasyfikacji (punkty, opis `4r + ST`/`3s`/`1h`/`2ST`/`ST`/pusty), `by_kind` w mapie i stronie obszaru, `kind` drogi, `kind` w wyszukiwarce.
- Front: `applyKind`/filtrowanie, wygaszanie w `buildScene`, przełącznik zapamiętany w `localStorage`.
