# Topo — plan 8: wyszukiwarka, strony obszarów, publiczne zmiany

Data: 2026-10-10
Status: zatwierdzony w rozmowie (mockupy: `.superpowers/brainstorm/1672-1791667445/content/` — `wyszukiwarka.html` wariant A, `obszar.html` wariant A)
Uzupełnia: `docs/superpowers/specs/2026-10-08-topo-design.md` §5, §6.6, `docs/superpowers/specs/2026-10-08-frontend-design.md` §3, `docs/superpowers/specs/2026-10-09-plan-6-edycja-historia-design.md` (ostatnie zmiany).

## 1. Cel

Znaleźć skałę, ścianę albo drogę po nazwie (także „wszystkie drogi VI–VI.2 w Dolinie Kobylańskiej”), przeglądać region i sektor jako listę skał, a ostatnie zmiany czytać bez logowania.

**Kryteria sukcesu**
1. Wpisanie „zabi kon” w pole na mapie podpowiada „Żabi Koń”; Enter przybliża mapę do skały i otwiera jej kartę.
2. Wybór drogi z podpowiedzi otwiera stronę skały na zdjęciu tej drogi z zaznaczoną drogą; wybór ściany — stronę skały na tym zdjęciu.
3. Chipy: „drogi”, wycena VI – VI.2, obszar „Dolina Kobylańska” bez tekstu → lista takich dróg z „jeszcze N”.
4. „Lista skał” w karcie regionu otwiera stronę regionu: mała mapa, sektory, skały z sortowaniem.
5. Niezalogowany otwiera „Ostatnie zmiany” i widzi nazwy obszarów zamiast numerów; nie widzi przycisków cofania.

## 2. Wyszukiwarka

### 2.1 API `GET /api/search` (publiczne)
Parametry: `q` (0–100 znaków), `type` (`all` | `routes` | `crags`, domyślnie `all`), `grade_min`, `grade_max` (wyceny jak w bazie, np. `VI`, `VI.2+`; nieznana → 422), `area` (slug obszaru), `offset` (dróg, domyślnie 0).

- Porównanie bez wielkości liter i polskich znaków: `unaccent(lower(name))` (rozszerzenie `unaccent`, migracja 0008) z `ILIKE '%…%'`; kolejność: nazwa zaczyna się od frazy, potem pozostałe; potem alfabetycznie.
- `q` krótsze niż 2 znaki i brak filtrów → pusta odpowiedź. Bez `q`, ale z filtrem (wycena albo obszar) → tylko drogi.
- Odpowiedź: `{"areas": [...], "crags": [...], "walls": [...], "routes": [...], "totals": {"areas", "crags", "walls", "routes"}}`. Limity: obszary 5, skały 8, ściany 5, drogi 20 (stronicowane `offset`).
  - obszar: `id, name, slug, kind, parent_name`;
  - skała: `id, name, slug, area_name, route_count`;
  - ściana (tylko z nazwą): `id, name, crag_name, crag_slug`;
  - droga: `id, name, grade, grade_sort, crag_name, crag_slug, length_m`.
- `type=routes` → tylko drogi; `type=crags` → tylko skały. Filtr wyceny dotyczy dróg (przy `all` obszary, skały i ściany bez zmian). Filtr obszaru: wszystko w obszarze i jego podobszarach (rekurencyjnie).

### 2.2 Interfejs (pasek mapy, wariant A)
- Pole „Szukaj skały, ściany lub drogi…” w pasku mapy; pod nim, gdy pole ma fokus, chipy: `wszystko | drogi | skały`, „wycena: od – do ▾” (lista wycen Kurtyki III … VI.8), „obszar: … ▾” (regiony i sektory z mapy, z wyszukiwaniem) z ✕ do wyczyszczenia.
- Lista podpowiedzi pod chipami (zapytanie 250 ms po ostatniej zmianie): grupy „Obszary”, „Skały”, „Ściany”, „Drogi · N” — droga z numerkiem w kolorze pasma i plakietką wyceny, podpis skała · długość; na końcu „jeszcze N dróg” dociąga kolejne 20.
- ↑↓ zmienia zaznaczoną podpowiedź, Enter otwiera zaznaczoną (domyślnie pierwszą), Esc zamyka listę, klik poza paskiem zamyka listę.
- Wybór: region/sektor → `fitBounds` obrysu i karta obszaru; skała → przybliżenie do punktu (zoom ≥ 15) i karta skały; obszar (najwyższy poziom) → `/obszary/{slug}`; ściana → `/skaly/{slug}?sciana={id}`; droga → `/skaly/{slug}?droga={id}`.
- Strona skały czyta `?sciana` (pokazuje to zdjęcie) i `?droga` (zaznacza drogę i pokazuje pierwsze zdjęcie z jej linią).
- Telefon: pasek na całą szerokość, lista pod nim z przewijaniem (do 60% wysokości ekranu).

## 3. Strony obszarów `/obszary/:slug` (wariant A)

- **Region i sektor** — komputer: dwie kolumny jak strona skały. Lewa (~44%, przyklejona): ścieżka (← Mapa · obszar nadrzędny jako link), nazwa (Fraunces 800), chipy (sektory / skały / drogi), mała mapa (MapLibre, ten sam podkład co mapa główna, bez interakcji poza przesuwaniem i przybliżaniem): obrysy sektorów obszaru i pinezki skał; klik w pinezkę → strona skały; „Na mapie ↗” → mapa główna przybliżona do obrysu. Prawa: „Sektory” (dla regionu; nazwa, „n skał · m dróg”, pasek rozkładu wycen; klik → strona sektora), „Skały” z sortowaniem `nazwa | liczba dróg | trudność` (trudność = najwyższa wycena), wiersz: nazwa (Fraunces 600), podpis „sektor · zakres wycen”, pasek rozkładu wycen, liczba dróg; klik → strona skały. Telefon: jedna kolumna (mapa ~35% wysokości).
- **Obszar** (najwyższy poziom, np. Jura): ścieżka, nazwa, chipy, lista regionów (jak sektory) — bez skał i bez mapy.
- API `GET /api/areas/{slug}`: `crags` obejmują skały z podsektorów (pole `sector_name`, a także `lng`, `lat`), `children` dostają `grade_bands`; obszar najwyższego poziomu zwraca `crags: []`.
- Wejścia: karta regionu/sektora na mapie — przycisk „Lista skał”; ścieżka na stronie skały — elementy są linkami do `/obszary/{slug}`.

## 4. Ostatnie zmiany

- `GET /api/changes` publiczne; cofanie (`POST …/revert`) dalej wymaga zalogowania; niezalogowany nie widzi przycisków „Cofnij/Przywróć”; filtry (w tym „z importu”) działają dla wszystkich.
- Link „⟲ Ostatnie zmiany” w pasku także dla niezalogowanych (obok „✎ Edytuj”).
- Poprawki z planu 6:
  - pola `area_id` i `parent_id` w historii pokazują nazwy obszarów (API zamienia identyfikatory na nazwy, także obszarów już usuniętych — z ostatniej wersji);
  - „Przywróć” zamiast „Cofnij”, gdy wpis niczego nie tworzy, a coś usuwa (np. usunięcie skały ze zmianą wersji ścian);
  - okno konfliktu cofania: „{kto}: {obecna wartość}; cofnięcie ustawi {wartość sprzed}” (bez powtórzonej wartości);
  - `GET /api/auth/me` bez logowania zwraca 200 `{"nick": null}` (bez błędu 401 w konsoli przeglądarki).

## 5. Testy

- pytest: wyszukiwanie (polskie znaki, kolejność, grupy i sumy, `type`, filtr wyceny i obszaru z podobszarami, sam filtr bez `q`, `offset`, zła wycena 422, krótkie `q`), obszar z podsektorami (skały z `sector_name`, `grade_bands` dzieci), zmiany bez logowania, nazwy obszarów w różnicach, `/api/auth/me` bez logowania.
- vitest: wyszukiwarka (opóźnienie, chipy → parametry, klawisze, akcje wyboru), strona obszaru (sortowanie, sektory, linki), strona skały z `?droga` / `?sciana`, „Przywróć”, okno konfliktu, link zmian dla niezalogowanych.
- Bez E2E; przegląd w przeglądarce na koniec, potem uruchomienie całej aplikacji dla użytkownika przed scaleniem.
