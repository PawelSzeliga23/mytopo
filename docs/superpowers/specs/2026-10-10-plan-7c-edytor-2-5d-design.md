# Topo — plan 7c: edytor modelu 2.5D

Data: 2026-10-10
Status: zatwierdzony w rozmowie (użytkownik: „tak lecisz”); prototyp: `api/topo/depth_preview_view.html` (galeria `topo depth-preview`)
Uzupełnia: `docs/superpowers/specs/2026-10-08-topo-design.md` §6.4 (2.5D, edytor w planie 7), `docs/superpowers/specs/2026-10-10-plan-7b-zdjecia-glebia-design.md` (katalogi zdjęć, historia zdjęcia).

## 1. Cel

Zalogowani poprawiają model 2.5D ściany tam, gdzie głębia albo segmentacja się pomyliły: spłaszczają wybrzuszenia, wycinają drzewa i tło, domalowują skałę i podłoże, wygładzają powierzchnię, ustawiają kolory hologramu i decydują, czy ściana ma 2.5D. Każde „Zapisz” to jeden wpis w historii, który da się cofnąć.

**Kryteria sukcesu**
1. „⋯ → Edytuj model 2.5D” otwiera pełnoekranowy edytor; gumką usunięte drzewo po zapisie znika z widoku 2.5D na stronie skały.
2. Ctrl+Z / ↶ cofa pojedyncze pociągnięcia i operacje, Ctrl+Y / ↷ je ponawia; po zapisie stos zostaje.
3. „Przywróć” pędzlem oddaje oryginał z workera także po kilku zapisach.
4. Kolory skały i podłoża oraz przełącznik 2.5D (auto / zawsze / nigdy) widać na stronie skały po zapisie.
5. Zapis modelu widać w historii („model 2.5D: oryginał → wersja 1”) i da się go cofnąć.

## 2. Zakres

**W 7c:** strona edytora, pędzle (obracanie, spłaszcz, gumka, przywróć, maluj skałę, maluj podłoże, rozmiar), operacje „Wygładź” i „Przytnij krawędź”, kolory, przełącznik 2.5D, stos kroków, zapis z kontrolą konfliktu, historia i cofanie, kolory ściany w widoku 2.5D.

**Poza 7c:** „wycinanie skoków” i „kolory na zdjęciu” z prototypu, szkic lokalny (rastry za duże na localStorage), ponowne liczenie roślinności z poprawionej segmentacji, edycja głębi wyższej rozdzielczości niż siatka widoku.

## 3. Model danych i pliki

- Nowe kolumny `wall` (i `wall_version`, migracja 0007): `model_path` (String 500, null = oryginał z workera), `rock_color`, `ground_color` (String 7, `#rrggbb`, null = domyślne kolory hologramu).
- Pliki zapisu w katalogu zdjęcia (`photo_folder`): `model-{n}-depth.png` (PNG 16-bit, 1 kanał) i `model-{n}-segments.png` (PNG 8-bit, klasy 0–4), `n` = 1 + największy numer modelu w tym katalogu; `model_path` = `{katalog}/model-{n}`. Oryginały `depth.png` i `segments.png` zostają nietknięte. Pliki nigdy nie są usuwane.
- Rozmiar obu plików = rozmiar oryginalnego `depth.png` tej ściany.
- Podmiana zdjęcia (7b) zeruje `model_path`; kolory zostają.

## 4. API

- `WallOut` dostaje: `rock_color`, `ground_color`, `depth_enabled` (bool | null), `model_version` (n | null), `original_depth_url`, `original_segments_url`. `depth_url` i `segments_url` wskazują model, gdy `model_path` jest ustawione (i głębia gotowa), inaczej oryginały jak dotąd.
- `PUT /api/walls/{id}/model` (multipart, zalogowany): `base_model` (wersja modelu, od której edytor zaczął: liczba albo pusty = oryginał), opcjonalnie pliki `depth` i `segments` (zawsze oba albo żaden), `rock_color`, `ground_color` (`#rrggbb` albo `default` = domyślny), `depth_enabled` (`auto` | `on` | `off`), `comment`.
  - Ściana bez gotowej głębi → 422 `no_depth`.
  - `base_model` ≠ bieżące `model_version` → 409 `model_conflict` z `current_model`.
  - Pliki: PNG, rozmiar = oryginał, `depth` 16-bit jednokanałowy, `segments` 8-bit jednokanałowy z wartościami 0–4; inaczej 422 `invalid_model`. Do 30 MB razem.
  - Zły kolor → 422 (walidacja). Wiersz ściany zablokowany na czas zapisu.
  - Nic się nie zmienia → 200 bez wpisu w historii. Odpowiedź: `{"model_version", "changed": [...]}`.
- `depth_enabled` staje się zwykłym polem edycji (z historią); `topo wall-3d` w CLI dalej działa bez historii.

## 5. Historia i cofanie

- Z `SKIP_FIELDS` wypadają `depth_enabled`; nowe pola `model_path`, `rock_color`, `ground_color` nie są pomijane.
- Front: „model 2.5D” (`oryginał` / `wersja n`), „kolor skały”, „kolor podłoża” (wartość `#rrggbb`, pusty = „domyślny”), „2.5D” (`auto` / `zawsze` / `nigdy`).
- Cofnięcie zapisu przywraca poprzednie `model_path`, kolory i przełącznik — pliki są na dysku, nic nie trzeba liczyć.

## 6. Edytor

- Trasa `/skaly/:slug/model/:wallId` (leniwie), wejście z menu „⋯ → Edytuj model 2.5D” dla ściany z gotową głębią. Bez zalogowania — jak edytor topo.
- Układ jak edytor topo: pasek górny („← Wyjdź”, nazwa, ↶ ↷, „Zapisz (n zmian)”), model na środku, panel narzędzi z prawej (komputer) albo na dole (telefon).
- **Siatka:** edytor pracuje na węzłach siatki widoku (`gridSize`, dłuższy bok 384): głębia (0–1) i klasa każdego węzła; trójkąty rysowane, gdy trzy węzły to skała albo podłoże — jak widok 2.5D.
- **Narzędzia** (pędzel w węzłach siatki, 2–30, domyślnie 8):
  - obracanie (OrbitControls; jedyne narzędzie, przy którym działa obracanie i przybliżanie),
  - spłaszcz — węzły pędzla dostają medianę głębi pierścienia wokół (skała/podłoże),
  - gumka — klasa „inne” (0): trójkąty znikają,
  - przywróć — głębia i klasa z oryginału workera,
  - maluj skałę / maluj podłoże — klasa 3 / 4.
- **Operacje** (przyciski, każda to jeden krok): „Wygładź” (mediana 3×3 głębi węzłów skały/podłoża), „Przytnij krawędź” (węzły skały/podłoża stykające się z resztą → „inne”).
- **Widok:** hologram / zdjęcie, suwak głębi (tylko podgląd), drogi wł./wył. (linie leżą na poprawianym modelu, odświeżane po każdym kroku).
- **Ustawienia ściany:** kolor skały, kolor podłoża (z „domyślny”), 2.5D: auto / zawsze / nigdy.
- **Stos kroków:** krok = całe pociągnięcie pędzlem albo operacja; zapamiętuje tylko zmienione węzły (stare i nowe wartości). Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y, przyciski ↶ ↷; limit 100 kroków. Zmiany ustawień ściany nie idą na stos (to pola formularza).
- **Zapis:** „Zapisz (n zmian)” (n = kroki od ostatniego zapisu + zmienione ustawienia) → okno z komentarzem → węzły „wypiekane” do rastrów rozmiaru oryginału (każdy piksel bierze najbliższy węzeł) i wysyłane; po sukcesie nowy punkt odniesienia (`base_model`), stos zostaje. Pliki wysyłane tylko, gdy były kroki.
- **Konflikt (409):** okno „Ktoś zapisał model w międzyczasie” — „Nadpisz moim” (ponowny zapis z nową bazą) albo „Anuluj” (zmiany zostają w edytorze).
- **Wyjście** z niezapisanymi zmianami pyta „Porzucić zmiany?”; zamknięcie karty — ostrzeżenie przeglądarki.

## 7. Widok 2.5D na stronie skały

Hologram bierze `rock_color` / `ground_color` ściany (domyślne `#9ec2db` / `#949494`). Model z edytora wczytuje się sam, bo `depth_url` / `segments_url` wskazują poprawione pliki.

## 8. Testy

- pytest: zapis modelu (pliki, `model_path`, adresy w `WallOut`, oryginały), konflikt 409, zły rozmiar / tryb / klasy 422, brak głębi 422, kolory i przełącznik bez plików, nic do zmiany, 401, historia i cofnięcie, podmiana zdjęcia zeruje model.
- vitest: logika edycji (pędzle, przywróć, spłaszcz, wygładź, przytnij, stos kroków, wypiekanie do rastra i z powrotem), formatowanie historii, strona edytora z atrapą płótna 3D (zapis wysyła FormData, konflikt, wyjście), kolory w materiale hologramu.
- Bez E2E; użytkownik sprawdza klikając.
