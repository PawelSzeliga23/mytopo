# Raport z próbnego importu: Dolina Kobylańska

Data: 2026-10-08. Polecenie: `topo import portalgorski --only-area "Dolina Kobylańska"`.

## Przebieg

- Pierwszy import (z siecią, przerwa 1,5 s): ok. 10 minut (634 s).
- Wynik pierwszego importu: 49 skał nowych, 118 ścian, 643 drogi, 643 linie, 4232 punkty, **3 błędy**.
- Błędy: `'NoneType' object has no attribute 'strip'` w skałach Mur pod Okrętem, Podcięta Turnia, Zadnia Wronia Baszta.
- Przyczyna: w odpowiedzi `paths` pole `kindName` punktu bywa `null` (nie brak klucza), a parser wołał `.strip()` na `None`.
- Poprawka: `parse.py` traktuje `null` jak pusty tekst; dodany test `test_parse_paths_null_kind_name`. Pełny zestaw testów: 121 zaliczonych.
- Ponowny import po poprawce (`--offline`, z cache): 0 błędów, dane uzupełnione: 118 ścian, **663 drogi, 663 linie, 4347 punktów**.

## Wynik końcowy w bazie

- Region „Dolina Kobylańska”: 49 skał, 663 drogi (API `/api/map/areas?kind=region`).
- „Żabi Koń”: 3 ściany, linie: Żabi Koń 9, Mur przy Żabim Koniu 12, Kapliczka 7. Dane skały (typ skały, wysokość, ekspozycje, formacje) wypełnione.
- Rozmiar `./cache`: 140 MB, `./media`: 187 MB.

## Nieznane typy punktów (44 wystąpienia)

- ring zjazdowy: 34
- spit: 4
- niewidoczny fragment drogi: 4
- pętla: 2

Wszystkie trafiają do `przelot` (zgodnie z założeniem). Importer nie raportuje nieznanych wycen — brak takich komunikatów. Trzy adresy z listy skał z błędnym wzorcem (`([0-9]+)` w adresie: Czubatka, Okiennik, Kręta) zostały pominięte (to skały spoza doliny, błąd danych źródła).

Uwaga na przyszłość: „ring zjazdowy” i „spit” warto zmapować na własne typy (np. `ring` / `stanowisko`) w kolejnym kroku; dziś są traktowane jak zwykły punkt pośredni.

## Podglądy (`topo draw-wall`, pliki w `./cache/`)

- `podglad-9.png` (Żabi Koń, 9 linii): pionowa turnia; linie biegną wzdłuż filarów i zacięć, kółka wpinek leżą na skale, rozgałęzienia (warianty) schodzą się w sensownych punktach. Brak przesunięcia ani skali.
- `podglad-19.png` (Dwoista Turnia, 21 linii): linie prowadzą od podstawy ściany ku górze wzdłuż rys i ścian obu turni, wpinki na skale; kilka linii bez wpinek (tak w źródle). Brak przesunięcia.
- `podglad-117.png` (Karniowicka Skała II, 14 linii): linie na jasnej płycie, zgodnie z kształtem skały; długie linie „trawersowe” biegną po grzbiecie (to warianty wychodzące w bok, zgodne ze źródłem).
- `podglad-8.png` (Mur przy Żabim Koniu, 12 linii): linie ułożone równolegle wzdłuż pionowych zacięć i rys, wpinki na skale.

Wniosek: współrzędne 0–1 są poprawnie przeliczone, linie i kółka trafiają w skałę wzdłuż wiarygodnych dróg.

## Ponowny import (idempotencja)

`--offline`, dwukrotnie: „Skały: 0 nowych, 0 zaktualizowanych”, brak błędów, bez sieci, liczby stabilne (118 / 663 / 663 / 4347).
