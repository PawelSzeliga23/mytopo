# Topo — plan 7a: edytor topo

Data: 2026-10-09
Status: zatwierdzony w rozmowie, do przeglądu jako dokument (makieta układu: `.superpowers/brainstorm/2878-1791556262/content/uklad.html`, wariant A)
Uzupełnia: `docs/superpowers/specs/2026-10-08-topo-design.md` §6.5, `docs/superpowers/specs/2026-10-09-plan-6-edycja-historia-design.md` §2 (zobowiązanie dla edytorów planu 7), `docs/superpowers/specs/2026-10-08-frontend-design.md` (system wizualny).

Plan 7 jest podzielony na trzy plany: **7a edytor topo** (ten dokument), 7b wgrywanie i wymiana zdjęć z kolejką głębi, 7c edytor modelu 2.5D.

## 1. Cel

Zalogowani znajomi poprawiają linie dróg na zdjęciach ścian: przesuwają i dodają wpinki, rysują nowe linie i warianty, zmieniają typy punktów i kolejność — na komputerze i na telefonie. Każde „Zapisz” to jeden wpis w historii, który da się cofnąć.

**Kryteria sukcesu**
1. Na telefonie i komputerze można przesunąć ring, dodać linię nowej drogi od startu do stanowiska i zapisać; zmiana jest widoczna na stronie skały (2D i 2.5D).
2. Przesunięcie wspólnego stanowiska kilku dróg przesuwa końce wszystkich tych linii.
3. Ctrl+Z / ↶ cofa pojedyncze kroki; odświeżenie strony nie gubi szkicu.
4. Dwie osoby edytujące tę samą ścianę: druga dostaje 409 i nie traci swojego szkicu.
5. Zapis topo widać w historii skały („topo zdjęcia 3: zmieniono 2 linie, 5 punktów”) i da się go cofnąć.

## 2. Zakres

**W planie 7a:** pełnoekranowy edytor topo jednej ściany, zapis całej ściany z kontrolą wersji, szkic lokalny, stos kroków, nowa droga z edytora, warianty, wspólne punkty, cofanie zapisu przez historię z planu 6.

**Poza 7a:** wgrywanie i wymiana zdjęć (7b), edytor 2.5D i ręczny włącznik 2.5D (7c), nakładanie linii z innego zdjęcia, automatyczne wykrywanie wpinek, ręczny wybór koloru linii (kolor zawsze z wyceny drogi).

## 3. Interfejs

### 3.1 Wejście i układ (wariant A z makiety)
- Wejście: strona skały, menu „⋯ → Edytuj topo” (tylko zalogowani) dla bieżącego zdjęcia. Trasa `/skaly/:slug/topo/:wallId`, ładowana leniwie.
- Tryb pełnoekranowy (strona skały znika):
  - **komputer:** pasek górny („← Wyjdź”, „{skała} · {ściana} — edycja topo”, ↶ ↷, stan szkicu, „Zapisz (n zmian)”), narzędzia w pionie z lewej, zdjęcie na całą wysokość, z prawej lista linii i panel typu zaznaczonego punktu;
  - **telefon:** pasek górny (✕, nazwa ściany, ↶ ↷, „Zapisz”), zdjęcie na cały ekran, narzędzia w dolnym pasku, lista linii w wysuwanym panelu (☰), podpowiedź bieżącej czynności w rogu zdjęcia.
- Wygląd według systemu „Przewodnik”, jasny i ciemny motyw. Linie w kolorach wyceny jak w widoku 2D; zaznaczona linia grubsza, pozostałe przygaszone; punkty zaznaczonej linii jako uchwyty, przeloty jako małe puste kółka.

### 3.2 Narzędzia
- **Zaznacz / przesuń (V):** klik w linię zaznacza ją; przeciąganie punktu przesuwa go; przytrzymanie (lub klik z narzędziem) na odcinku wstawia między punkty nowy punkt typu `przelot`.
- **Nowa linia (N):** wybór drogi — drogi skały bez linii na tym zdjęciu albo „+ nowa droga” (nazwa, wycena); potem klikanie punktów od dołu do góry: pierwszy `start`, kolejne `ring`; Enter / „Gotowe” kończy (ostatni punkt można zmienić na `stanowisko`).
- **Dodaj punkt (P):** klik dokleja punkt na końcu zaznaczonej linii.
- **Wariant (W):** klik w punkt istniejącej linii, potem klikanie dalszych punktów — nowa linia z `parent_line_id` i `parent_point_id` (numer „5a”).
- **Usuń (Delete):** zaznaczony punkt albo linia; usunięcie linii z wariantami pyta o potwierdzenie, warianty tracą powiązanie (jak w planie 6).
- **Typ punktu:** przyciski start, ring, hak, ucho, stanowisko, ogranicznik, przelot dla zaznaczonego punktu.
- **Lista linii:** numery jak na topo, nazwa drogi; klik zaznacza; ↑↓ zmieniają kolejność (numerację); zmiana drogi przypisanej do linii.

### 3.3 Wspólne punkty
- Punkty różnych linii w tym samym miejscu (odległość < 0,3% dłuższego boku zdjęcia) są traktowane jako jeden: przeciąganie przesuwa wszystkie razem.
- Nowy punkt postawiony w tym promieniu od istniejącego przyjmuje dokładnie jego położenie (przyklejenie).
- Odklejenie: przeciąganie z Alt (komputer) albo przycisk „Odklej” przy zaznaczonym punkcie (telefon) — przesuwa tylko punkt zaznaczonej linii.
- Bez zmian w modelu danych: wspólność wynika z położenia.

### 3.4 Gesty i dotyk
- Jeden palec / mysz: edycja. Dwa palce: przybliżanie i przesuwanie. Kółko myszy: przybliżanie; spacja + przeciąganie lub środkowy przycisk: przesuwanie.
- Telefon: podczas przeciągania punktu nad palcem lupa (powiększony fragment z krzyżykiem).
- Uchwyty punktów mają stały rozmiar na ekranie niezależnie od przybliżenia (min. 24 px pola dotyku na telefonie).

### 3.5 Cofanie, szkic i zapis
- Stos kroków: zustand + zundo, limit 100. Krok = jedna czynność (całe przeciągnięcie, dodanie punktu, zmiana typu, kolejności, drogi, usunięcie). Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, przyciski ↶ ↷.
- Szkic w `localStorage` (klucz `topo-draft-{wallId}`, odczyt i zapis w try/catch) z wersją bazową ściany i czasem. Przy otwarciu edytora:
  - szkic z tą samą wersją → „Masz niezapisany szkic z {czas} — Przywróć / Porzuć”;
  - szkic ze starszą wersją → „Ktoś zapisał zmiany po Twoim szkicu — Porzuć szkic / Przywróć mimo to”.
- „Zapisz (n zmian)” — opcjonalny komentarz, wysyła cały szkic; po sukcesie szkic dostaje prawdziwe id i nową wersję, stos kroków zostaje (checkpoint). Pojedyncze kroki nie trafiają do historii serwera.
- „Wyjdź” / ✕ z niezapisanymi zmianami → „Porzucić zmiany?” (szkic i tak zostaje w `localStorage` do porzucenia).
- 401 przy zapisie → okienko logowania i ponowienie (jak w planie 6, edytor nie odmontowuje się).
- 409 przy zapisie → okienko „Ktoś zapisał topo w międzyczasie”: „Otwórz najnowszą” (szkic zostaje w `localStorage`) albo „Nadpisz moją” (po potwierdzeniu zapis z aktualną wersją serwera).

## 4. API

### 4.1 `PUT /api/walls/{id}/lines` (wymaga sesji)

```
{ version: int, comment?: str,
  new_routes: [{ ref: str, name: str, grade?: str }],
  lines: [{ id?: int, ref?: str,
            route_id?: int, route_ref?: str,
            sort_order: int,
            parent?: { line_id?: int, line_ref?: str, point_id?: int, point_ref?: str },
            points: [{ id?: int, ref?: str, sort_order: int, x: float, y: float, kind: str }] }] }
```

Jedna transakcja historii (autor = nick, komentarz):
1. `version` różna od `wall.version` → 409 `version_conflict` „Ktoś zapisał topo w międzyczasie” z `current_version`.
2. Nowe drogi: `Route(crag_id = wall.crag_id, source = "manual")`, wycena przez `apply_grade` (422 przy nieznanej).
3. Linie i punkty z `id` (muszą należeć do tej ściany) — aktualizacja pól; z `ref` — utworzenie; istniejące linie i punkty ściany nieobecne w ciele — usunięcie przez ORM (`delete` z odpięciem wariantów spoza zbioru, jak w planie 6).
4. Warianty (`parent`) ustawiane po utworzeniu wszystkich obiektów.
5. `visible = kind != "przelot"`; `color` = kolor pasma wyceny drogi (kolumna nieużywana przez widok, wypełniana dla spójności).
6. `wall.version += 1`, `refresh_area_geom`, `commit`.

Odpowiedź: `{ version, ids: { "<ref>": id, … } }`.

Walidacja (422, komunikaty po polsku): x, y w [0, 1] i skończone; znany `kind`; linia ma ≥ 2 punkty; droga należy do skały ściany; rodzic wariantu na tej ścianie, punkt rodzica należy do linii rodzica, bez cykli; każdy `ref` unikalny; `id` spoza ściany → 422.

Linia bez zmian nie tworzy wersji (porównanie pól przed przypisaniem). Zapis bez żadnych zmian → 200 z dotychczasową wersją, bez transakcji.

### 4.2 Zmiany w istniejącym kodzie
- Cofanie (`topo/revert.py`): jeśli cofnięcie zmienia linie lub punkty ściany, podnosi `wall.version` tej ściany (żeby otwarty edytor wykrył zmianę).
- `GET /api/crags/{slug}` już zwraca `version`, linie i punkty z id — bez zmian.
- Historia (`topo/changes.py`): bez zmian — zapis topo jest streszczany jako obiekt `topo` („zmieniono n linii, m punktów”).

## 5. Struktura kodu

- API: `api/topo/topo_edit.py` (schemat wejścia, walidacja, zastosowanie szkicu), endpoint w `api/topo/api/walls.py`, schemat Pydantic w `api/topo/schemas_edit.py`.
- Front `web/src/editor/`: `store.ts` (stan + zundo), `shared.ts` (wspólne punkty), `draft.ts` (szkic w `localStorage`, ciało `PUT`, scalenie `ref → id`), `EditorCanvas.tsx` (react-konva, korzysta z `web/src/crag/view.ts`, gesty, lupa), `EditorPage.tsx` (układ, narzędzia, lista linii, panel punktu, okienka), `api.ts` w `web/src/lib` dostaje `api.saveWallLines`.

## 6. Obsługa błędów
401 → logowanie i ponowienie; 409 → okienko konfliktu, szkic zostaje; 422 → komunikat z API przy zapisie, szkic zostaje; brak zdjęcia ściany → edytor niedostępny („Ta ściana nie ma zdjęcia”).

## 7. Testy
**Zasada:** pisane razem z kodem, uruchamiane raz na końcu zadania; bez E2E w Playwright — na koniec użytkownik przeklikuje sam.
- API: zapis z nowymi, zmienionymi i usuniętymi liniami; zachowanie id; warianty przez `ref`; nowa droga w tym samym zapisie; 409 przy starej wersji; walidacje (zakres, typ, < 2 punkty, droga z innej skały, cykl wariantów, obce `id`); zapis bez zmian bez transakcji; cofnięcie zapisu topo przywraca linie i podnosi `version`.
- Front (Vitest): operacje sklepu i cofanie kroków (przeciągnięcie = 1 krok); wspólne punkty (przesunięcie razem, przyklejenie, odklejenie); budowanie ciała `PUT` i scalenie `ref → id`; szkic w `localStorage` (wersja bazowa, przywrócenie); okienko 409.

## 8. Kolejność z oceną
Najpierw edytor na froncie bez zapisu (szkic tylko lokalny) — **STOP**: użytkownik przeklikuje na komputerze i telefonie i zgłasza poprawki. Dopiero potem zapis, konflikty i historia.
