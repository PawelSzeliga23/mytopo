# Topo — projekt wyglądu frontu

Data: 2026-10-08
Status: zatwierdzony w rozmowie (mockupy w `.superpowers/brainstorm/2008-1791466193/content/`: `styl-wizualny.html`, `mapa-uklad.html`, `skala-uklad.html`)
Uzupełnia: `docs/superpowers/specs/2026-10-08-topo-design.md` §6

## 1. Kierunek

„Terenowy, ciepły” — wariant **A „Przewodnik”**: kolory piaskowca i atramentu, rdzawy akcent, szeryfowe nagłówki jak w drukowanym przewodniku wspinaczkowym. Motyw jasny i ciemny z przełącznikiem. Przy wyborze układu **ergonomia ma pierwszeństwo przed spójnością wizualną**.

## 2. System wizualny

### 2.1 Kolory (zmienne CSS na `:root` i `[data-theme="dark"]`)

| Token | Jasny | Ciemny | Użycie |
|---|---|---|---|
| `--bg` | `#F4ECDD` | `#1D1916` | tło stron i paneli |
| `--surface` | `#E6D8BF` | `#2E2722` | plakietki, chipy, pola |
| `--map-bg` | `#E9DDC6` | `#26201C` | tło pod mapą / zastępcze |
| `--line` | `#E1D3BA` | `#3A312A` | obramowania, separatory |
| `--ink` | `#2B2420` | `#EDE3D2` | tekst główny |
| `--ink-muted` | `#2B2420` @ 65% | `#EDE3D2` @ 65% | tekst pomocniczy |
| `--accent` | `#C2541B` | `#E2763A` | akcent, pinezki, zaznaczenia |
| `--accent-ink` | `#F4ECDD` | `#1D1916` | tekst na akcencie |

Pasma trudności (wspólne z Portalem Górskim; linie na zdjęciach, numerki dróg, plakietki wycen):

| Pasmo | Zakres | Linia/numerek (jasny / ciemny) | Plakietka tło / tekst (jasny) | (ciemny) |
|---|---|---|---|---|
| 0 | ≤ V+ | `#3E8FB0` / `#4FA8CC` | `#D8E6EC` / `#245B72` | `#1F3A47` / `#8CCBE6` |
| 1 | VI- … VI.1+/2 | `#2F4FA0` / `#5C7BD6` | `#DCE1F0` / `#2F4FA0` | `#262F4D` / `#A7B9F0` |
| 2 | VI.2 … VI.4+/5 | `#B23A2B` / `#E0604E` | `#F2D9D4` / `#B23A2B` | `#4A2520` / `#F2A59A` |
| 3 | ≥ VI.5 | `#2B2420` / `#EDE3D2` | `#2B2420` / `#F4ECDD` | `#EDE3D2` / `#1D1916` |
| brak wyceny | — | `--ink-muted` | `--surface` / `--ink` | |

### 2.2 Typografia

- Nagłówki, nazwy skał i dróg, logo: **Fraunces** (800 dla tytułów, 600 dla nazw na listach).
- Tekst, liczby, interfejs: **IBM Plex Sans** (400, 600).
- Etykiety nad tytułami: Plex Sans, wersaliki, `letter-spacing: .08em`, 10–11 px, `--ink-muted`.
- Logo: „topo” w Fraunces 800 + kropka w kolorze akcentu.

### 2.3 Motyw

- Domyślnie zgodny z ustawieniem systemu (`prefers-color-scheme`); przełącznik ☾/☀ w pasku nadpisuje i zapamiętuje wybór w `localStorage` (odczyt w try/catch).
- Atrybut `data-theme` na `<html>` ustawiany przed pierwszym renderem (skrypt w `index.html`), bez mignięcia.

### 2.4 Komponenty

shadcn/ui ostylowane tokenami: przycisk (główny = `--ink` na jasnym / `--accent` na ciemnym), karta, chip (zaokrąglony, `--surface`), plakietka wyceny (kolory pasm), pasek rozkładu trudności (4 segmenty w kolorach pasm, szerokość proporcjonalna), wysuwana karta (Drawer/Sheet), pływający panel (cień `0 4px 14px rgba(43,36,32,.18)`, promień 10 px).

## 3. Mapa (strona główna)

- Mapa na cały ekran (MapLibre GL). Nad nią pływający pasek: logo, wyszukiwarka (pole; wyniki w planie 8), przełącznik motywu.
- Trzy poziomy jak w specu głównym §6.1. Pinezki regionów i skał w kolorze `--accent` z obwódką `--bg`, podpis nazwą (i liczbą skał dla regionów). Obrysy sektorów: wypełnienie `--surface` ~35% + kontur `--accent` cienki.
- Kliknięcie regionu / sektora / skały otwiera **kartę**: komputer — pływający panel z prawej (~320 px); telefon — karta wysuwana od dołu. Zawartość: etykieta rodzaju („Region” / „Sektor” / „Skała”), nazwa (Fraunces), chipy (liczba skał / dróg), pasek rozkładu trudności, przycisk „Przybliż” (region/sektor → `fitBounds`) albo „Otwórz skałę”.
- Przełącznik warstw (pływający, prawy dolny róg): „Mapa + cieniowanie” (domyślny: OSM + półprzezroczyste cieniowanie terenu z Geoportalu), „Ortofotomapa”, „OpenTopoMap”.
- W ciemnym motywie podkład mapy jest przyciemniany filtrem (raster `brightness/saturation`), żeby nie świecił.

## 4. Strona skały — układ A (realizacja w planie 4)

- **Komputer (≥ 1024 px):** dwie kolumny. Lewa (~58%): ścieżka (← Mapa · region · sektor), nazwa, przeglądarka ściany (2.5D/2D z przełącznikiem w rogu; pozostaje na miejscu przy przewijaniu — `position: sticky`), miniatury ścian. Prawa: chipy (rodzaj skały, wysokość, wystawa, dojście, dla dzieci), opis i dojście (zwijane), lista dróg.
- **Telefon:** jedna kolumna: zdjęcie ściany u góry; przy przewijaniu listy zwija się do paska (~30% wysokości ekranu) i zostaje przyklejone u góry, żeby wybrana droga była zawsze widoczna. Pod nim miniatury i lista.
- Wiersz drogi: numerek w kółku (kolor pasma), nazwa (Fraunces 600), pod nią asekuracja · długość · autor; plakietka wyceny z prawej. Wybrana droga: tło `--surface`, a jej linia na zdjęciu pogrubiona; najechanie/kliknięcie działa w obie strony.
- Numer na topo liczony **osobno dla każdego zdjęcia** z kolejności linii (`route_line.sort_order`); warianty jako „5a”, „5b”.

## 5. Kolejne strony

Wyszukiwarka, strony obszarów, ostatnie zmiany i edytor topo korzystają z tego systemu; ich układ ustalamy na mockupach przed odpowiednimi planami (spec główny §6.0).
