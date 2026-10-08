# Topo — wiki topo dróg wspinaczkowych (Polska)

Data: 2026-10-08
Status: zaakceptowany w rozmowie, do przeglądu jako dokument

## 1. Cel i kontekst

Prywatne, niekomercyjne wiki topo dróg wspinaczkowych dla autora i znajomych.

- Mapa całej Polski ze skałami; po kliknięciu skały — strona z modelem 2.5D ściany (zrobionym ze zdjęcia), narysowanymi drogami i wpinkami, a pod spodem opisy dróg.
- Dane startowe importowane z Portalu Górskiego (topo.portalgorski.pl), uzupełniane z wspinanie.pl.
- Brak kont. Oglądanie publiczne, edycja po jednym wspólnym haśle, każda zmiana podpisana nickiem i zapisana w historii z możliwością cofnięcia.
- Stack: React (front), FastAPI (API), Postgres + PostGIS (baza). Maksymalne użycie gotowych bibliotek.
- Uruchamiane lokalnie przez Docker Compose; produkcyjnie autor przenosi obrazy na własny serwer (bez GPU) i wystawia przez tunel.

**Kryteria sukcesu**
1. Po imporcie mapa pokazuje wszystkie skały z Portalu Górskiego z trzema poziomami przybliżenia (region → sektor → skała).
2. Strona skały pokazuje każdą zaimportowaną ścianę w 2.5D i 2D z poprawnie nałożonymi liniami i wpinkami oraz listę dróg.
3. Znajomy z hasłem może dodać ścianę (zdjęcie), narysować nową drogę z wpinkami i zapisać ją; zmiana jest widoczna w historii i da się ją cofnąć.

## 2. Źródła danych

### 2.1 Portal Górski — źródło główne
Około 7 obszarów, 43 regiony, 86 sektorów, 631 skał, 2318 ścian (zdjęć), 12 674 dróg. Brak robots.txt; pobieramy grzecznie (1–2 s przerwy).

| Dane | Źródło |
|---|---|
| Hierarchia obszar → region → sektor → skała → ściana | URL-e stron (`/Nazwa,Sektor,Region,Obszar,skala,{id}`, `/Nazwa,obszar,{id}`) |
| Współrzędne skał | `GET /topo/json/start`, `GET /topo/json/get/id/{id}` |
| Rodzaj skały, wysokość, wystawa, formacje, czas dojścia, opis i dojście | HTML strony skały (`table.tblData` i sekcje opisu) |
| Zdjęcia ścian | `imageMain` w `new TopoEditorFactory({...})` na stronie skały (`/images/original/...`) |
| Linie dróg, punkty, typy wpinek, kolor, kolejność, warianty | `POST /topo/topoEditor/loadPaths` z `imageId={id}&pathId=0` |
| Nazwa, wycena i asekuracja drogi | `pathsLabelTooltips` w odpowiedzi `loadPaths` (np. „Lewy kant Żabiego Konia V+”, „9r + ST”) |

Typy punktów z Portalu (`kindName`): `ring`, `hak`, `ucho skalne`, `stanowisko zjazdowe`; `typeId=1` oznacza punkt startowy/niewidoczny.

Czarno-białe wersje zdjęć (`imagePlan`) **nie są pobierane**.

**Do weryfikacji przy imporcie:** zdjęcia mają ~1600 px na dłuższym boku (np. 1063×1600), a współrzędne punktów sięgają tylko ~y=711. Portal zapisuje więc piksele względem pomniejszonego obrazka w edytorze. Importer musi ustalić tę skalę (z kodu `topoEditor.js` albo empirycznie na kilku ścianach) i przeliczyć punkty na wartości 0–1. Linie o podejrzanej skali (punkty poza 0–1) trafiają do raportu.

### 2.2 wspinanie.pl/topo — uzupełnienie
Statyczne strony HTML z listami dróg: nazwa, wycena, liczba ringów („5R+ST”), autor drogi, historia skały. robots.txt: `Crawl-delay: 120` — respektujemy (import puszczany na noc). Używane do dopisania autora, roku i historii do istniejących skał i dróg, dopasowywanych po nazwie skały i drogi (normalizacja: małe litery, bez polskich znaków i interpunkcji). Niedopasowane wpisy trafiają do raportu, nie tworzą nowych rekordów.

### 2.3 Odrzucone
- thetopo.com (dawniej 27crags) — robots.txt zabrania dostępu crawlerom AI, w tym Anthropic.
- theCrag — Cloudflare 403, API wymaga klucza.
- OpenBeta — brak danych z Polski.

## 3. Architektura

```
docker-compose
├── db        postgis/postgis:16-3.4 (osobny wolumen, shared_buffers=64MB)
├── api       FastAPI, Python 3.12
│             ├─ REST API (odczyt publiczny, zapis po haśle)
│             ├─ wątek workera: kolejka zadań głębi (tabela w Postgresie)
│             └─ /media: oryginały, WebP, miniatury, mapy głębi (wolumen)
├── web       React + Vite + TypeScript; w produkcji statyczne pliki przez nginx
└── CLI       `topo ...` (w obrazie api): import, depth, export
```

- Dwa warianty obrazu API: `api` (CPU, lekki, na serwer) i `api-gpu` (CUDA, do pracy lokalnej na RTX 3060).
- Na serwerze działa osobny kontener `db` z PostGIS (niezależny od istniejącego Postgresa autora). API łączy się przez `DATABASE_URL`, więc w przyszłości można podpiąć zewnętrzną bazę bez zmian w kodzie.
- Publiczny adres strony (`PUBLIC_URL`) i ścieżki nie są wpisane w kodzie, tylko w zmiennych środowiskowych, żeby działało za tunelem (np. Cloudflare Tunnel).

### 3.1 Biblioteki

| Część | Biblioteki |
|---|---|
| API | FastAPI, SQLAlchemy 2, GeoAlchemy2, Alembic, Pydantic v2 |
| Historia zmian | SQLAlchemy-Continuum |
| Obrazy | Pillow (+ pillow-heif), numpy |
| Głębia | Depth Anything V2 (transformers, PyTorch; Small na CPU, Large na GPU) |
| Importer | httpx, selectolax |
| CLI | Typer |
| Front — mapa | MapLibre GL JS, react-map-gl |
| Front — 2.5D | three.js, @react-three/fiber, @react-three/drei |
| Front — 2D i edytor | react-konva, zustand, zundo |
| Front — reszta | React Router, TanStack Query, Tailwind CSS, shadcn/ui (w tym Sonner) |
| Testy | pytest, testcontainers, Vitest, Playwright |

## 4. Model danych

```
area           id, parent_id, kind {obszar|region|sektor}, name, slug, description
crag           id, area_id, name, slug, location geometry(Point,4326),
               rock_type, height_min, height_max, aspects text[], formations text[],
               approach_minutes, child_friendly, surroundings, description, approach_description
wall           id, crag_id, name, description, sort_order, version (int, do kontroli konfliktów),
               image_original_path, image_path (WebP 1600 px), thumb_path (WebP 400 px),
               image_width, image_height,
               depth_path, depth_status {pending|ready|failed}, depth_model
route          id, crag_id, number, name, grade, grade_sort (int), length_m,
               protection, first_ascent, year, description
route_line     id, wall_id, route_id, color, sort_order, parent_line_id, parent_point_id
line_point     id, line_id, sort_order, x, y (float 0–1 względem zdjęcia),
               kind {start|ring|hak|ucho|stanowisko|ogranicznik|przelot}, visible  (przelot = punkt pomocniczy linii, niewidoczny)
depth_job      id, wall_id, model, status {queued|running|done|failed}, error, created_at
```

- Wszystkie tabele treści (`area`, `crag`, `wall`, `route`, `route_line`, `line_point`) mają `source` (`portalgorski` | `wspinanie` | `manual`), `source_id`, `source_url`. Unikalny klucz `(source, source_id)` pozwala powtarzać import bez duplikatów.
- Droga (`route`) jest odrębna od jej linii na zdjęciu (`route_line`), więc jedna droga może występować na kilku zdjęciach.
- Środki i obrysy regionów i sektorów nie są przechowywane, tylko liczone z położenia skał: widok zmaterializowany `area_geom` (środek: ST_Centroid; obrys: ST_ConvexHull z buforem 50 m, co zawsze daje poligon — również dla sektora z jedną lub dwiema skałami). Odświeżany po imporcie i edycjach.
- Skała może należeć bezpośrednio do regionu (bez sektora).
- `grade_sort`: odwzorowanie skali krakowskiej (I … VI.8, z „+”, „-” i wycenami łamanymi typu „VI.1+/2”) na liczbę całkowitą rosnącą z trudnością. Wycena łamana dostaje wartość między sąsiednimi. Nieznana wycena → `NULL`, a import zgłasza ją w raporcie.
- Historia: SQLAlchemy-Continuum dodaje tabele `*_version` i `transaction`; `transaction` rozszerzone o `author` (nick) i `comment`.

## 5. API (zarys)

Odczyt (publiczny):
- `GET /api/map/areas?kind=region|sektor` — GeoJSON (środek, obrys, nazwa, liczba dróg)
- `GET /api/map/crags` — GeoJSON punktów skał (nazwa, slug, liczba dróg, rozkład wycen)
- `GET /api/areas/{slug}` — region lub sektor z listą skał
- `GET /api/crags/{slug}` — skała ze ścianami, liniami, punktami i drogami (jedno zapytanie dla strony skały)
- `GET /api/search?q=&grade_min=&grade_max=&area=` — skały i drogi
- `GET /api/changes?limit=&before=` — ostatnie zmiany (transakcje z autorem i opisem zmienionych obiektów)

Zapis (wymaga ciasteczka sesji edycji):
- `POST /api/auth/login {password, nick}` → ustawia ciasteczko HttpOnly (podpisane, ważne 1 rok); `POST /api/auth/logout`
- CRUD: `POST/PATCH/DELETE` dla `areas`, `crags`, `routes`
- `POST /api/crags/{id}/walls` (multipart, zdjęcie) → tworzy ścianę i zadanie głębi
- `PUT /api/walls/{id}/lines {version, lines:[...]}` — zapis całej topografii ściany w jednej transakcji; zła `version` → 409
- `POST /api/changes/{transaction_id}/revert` — cofnięcie zmiany jako nowa transakcja

Hasło edycji w zmiennej `EDIT_PASSWORD`, klucz podpisu ciasteczka w `SECRET_KEY`.

## 6. Frontend

### 6.0 Proces projektowania wyglądu
Wygląd ma być ładny i nowoczesny. Przed implementacją każdej strony (mapa, strona skały, edytor topo, wyszukiwarka, strony obszarów, ostatnie zmiany) odbywa się osobna rozmowa o designie z autorem (z użyciem skilla `frontend-design`): kierunek wizualny, typografia, kolory, układ na telefonie i na komputerze. Wynikiem są **mockupy do akceptacji przed wdrożeniem**. Pierwsza taka rozmowa ustala wspólny system wizualny (kolory, fonty, komponenty), z którego korzystają kolejne strony.

### 6.1 Mapa (strona główna)
- MapLibre GL + react-map-gl, na całą stronę.
- Trzy warstwy zależne od przybliżenia, z płynnym przenikaniem (interpolacja `*-opacity` po `zoom`):
  - daleko: regiony — pinezka z nazwą i liczbą dróg
  - średnio: sektory — obrys + nazwa; skały bez sektora widoczne już na tym poziomie
  - blisko: skały — punkt z nazwą, kolor według rozkładu trudności
- Kliknięcie regionu lub sektora → `fitBounds` do jego obrysu. Kliknięcie skały → strona skały.
- Przełącznik podkładów: OSM (domyślny) z półprzezroczystym cieniowaniem LIDAR z Geoportalu na wierzchu; sama ortofotomapa Geoportalu; OpenTopoMap. Dokładne adresy usług WMS/WMTS Geoportalu ustalane przy implementacji.
- Po zalogowaniu: przycisk „dodaj skałę” → kliknięcie na mapie ustawia punkt.

### 6.2 Strona skały
- Nagłówek: nazwa, ścieżka obszar → region → sektor, wystawa, wysokość, rodzaj skały, czas dojścia, opis i dojście.
- Przeglądarka ściany: 2.5D domyślnie, przełącznik na 2D; miniatury do przełączania ścian.
- Lista dróg z numerami jak na topo: nazwa, wycena (krakowska + francuska), długość, asekuracja, autor i rok, opis. Kliknięcie drogi na liście podświetla ją na topo i odwrotnie.
- Po zalogowaniu: edycja pól skały i dróg, „edytuj topo”, wgranie nowej ściany.

### 6.3 Widok 2.5D
- `PlaneGeometry` z siatką ~256×384 i `MeshStandardMaterial` z `map` = zdjęcie, `displacementMap` = mapa głębi.
- Punkty linii: (x,y) → głębia odczytana z mapy głębi (wczytanej do canvas po stronie klienta) → pozycja 3D na powierzchni. Linie przez `<Line>` z drei, wpinki jako billboardy z ikonami według typu, numer drogi przy starcie.
- OrbitControls z ograniczeniem ±30° w poziomie i ±20° w pionie oraz przybliżaniem; suwak „głębia” skaluje `displacementScale`.
- Trójkąty na dużych skokach głębi są ukrywane lub przyciemniane (próg skoku względem sąsiadów), żeby ograniczyć „rozciągnięte” krawędzie.
- Bez WebGL albo przy `depth_status != ready` widok przełącza się sam na 2D.

### 6.4 Widok 2D
react-konva: zdjęcie (WebP), wygładzone linie (`tension`), ikony wpinek, numery; przybliżanie dwoma palcami i kółkiem, przesuwanie.

### 6.5 Edytor topo (po zalogowaniu, 2D)
- Narzędzia: zaznacz/przesuń, nowa linia, dodaj punkt, typ punktu (start, ring, hak, ucho, stanowisko, przelot), kolor.
- Nowa linia: wybór drogi ze skały albo „+ nowa droga” (nazwa, wycena), potem klikanie punktów od dołu do góry. Przeciąganie punktów, wstawianie między punkty, usuwanie (Delete / przytrzymanie na dotyku).
- Wariant: „nowa linia od tego punktu” ustawia `parent_line_id` i `parent_point_id`.
- Cofnij i ponów w edytorze: zustand + zundo.
- Zapis całej ściany przyciskiem „Zapisz” (`PUT /api/walls/{id}/lines` z `version`); przy 409 komunikat „ktoś zapisał zmiany w międzyczasie — przeładuj” i zachowanie lokalnego szkicu do ręcznego przeniesienia.

### 6.6 Pozostałe strony
- Wyszukiwarka: nazwa skały lub drogi, zakres wycen, filtr obszaru.
- Strona regionu i sektora: lista skał z liczbą dróg i rozkładem wycen, mała mapa.
- Ostatnie zmiany: lista transakcji (kto, kiedy, co), podgląd różnic pól, przycisk „cofnij” po zalogowaniu.

## 7. Przechowywanie plików

Na ścianę: oryginał (zachowywany, ~1,2 MB), WebP 1600 px q80 (~300 KB), miniatura WebP 400 px (~25 KB), mapa głębi PNG 16-bit ~768 px (~100 KB). Łącznie dla ~2318 ścian ≈ 3,8 GB (bez oryginałów ≈ 1 GB). Baza ≈ 50 MB.

Układ: `media/walls/{wall_id}/original.{ext}`, `display.webp`, `thumb.webp`, `depth.png`. Pliki serwowane przez nginx z nagłówkami cache. Na hoście katalog `./media/` (bind mount), żeby łatwo przenieść go na serwer (rsync); surowe odpowiedzi importu w `./cache/`.

## 8. Import i przetwarzanie (CLI)

**Kolejność (decyzja z 2026-10-08):** historia zmian (SQLAlchemy-Continuum, tabela `transaction` z `author` i `comment`) jest włączana *przed* pierwszym importem — każdy zaimportowany rekord ma wersję bazową podpisaną `import:portalgorski`, więc ręczne poprawki można cofnąć do danych z portalu. Zmiana z autorem spoza prefiksu `import:` (albo bez autora) to „ręczna zmiana”, której import nie nadpisuje.

```
lokalnie (compose z api-gpu):
  topo import portalgorski [--only-area SLUG]   # pobranie do cache/, potem parsowanie do bazy
  topo import wspinanie                          # 120 s przerwy, na noc
  topo depth --all [--model large|small] [--only-model small] [--force]
  topo export ./out                              # pg_dump + kopia media/
na serwerze:
  pg_restore + rsync media/
```

- Dwa etapy: `fetch` zapisuje surowe odpowiedzi (HTML, JSON, zdjęcia) w `cache/` z kluczem od URL i parametrów; `parse` buduje bazę wyłącznie z cache. Ponowne uruchomienie pomija już pobrane pliki (wznawianie po przerwaniu).
- Przerwy: Portal Górski 1–2 s; wspinanie.pl 120 s. Ponawianie z rosnącą przerwą (3 próby). Nagłówek User-Agent z nazwą projektu.
- Idempotencja: upsert po `(source, source_id)`.
- Ochrona ręcznych zmian: jeśli rekord ma w historii transakcję z autorem innym niż importer, ponowny import go nie nadpisuje i zgłasza w raporcie.
- Zdjęcia: korekta orientacji EXIF, zapis oryginału, WebP i miniatury.
- Raport końcowy: liczby obszarów, regionów, sektorów, skał, ścian, dróg i punktów; błędy; linie z podejrzaną skalą; nieznane wyceny; niedopasowane wpisy z wspinanie.pl.
- Głębia: Depth Anything V2 — lokalnie na GPU domyślnie Large (licencja CC-BY-NC, projekt jest niekomercyjny), na serwerze Small na CPU (Apache 2.0) dla nowo wgranych zdjęć. Model zapisywany w `wall.depth_model`, co pozwala później przeliczyć lokalnie ściany zrobione modelem Small.
- Kolejka na serwerze: tabela `depth_job` i wątek w API pobierający zadania (`SELECT … FOR UPDATE SKIP LOCKED`). Bez Redisa i Celery.

## 9. Obsługa błędów

- API: jednolity format `{code, message}`; 401 (brak sesji edycji), 404, 409 (konflikt wersji ściany), 422 (walidacja: punkt poza 0–1, nieznany typ punktu, zły plik).
- Wgrywanie: tylko JPG, PNG, WebP i HEIC, maksymalnie 30 MB.
- Front: komunikaty po polsku (Sonner). Częściowe błędy nie wywracają strony: brak głębi → 2D, błąd podkładu → inny podkład, błąd jednej ściany → reszta strony działa.
- Importer: błąd pojedynczej skały lub ściany nie przerywa importu, tylko trafia do raportu.
- Głębia: błąd → `depth_status=failed` i `depth_job.error`; ponowienie z CLI albo przyciskiem po zalogowaniu.

## 10. Testy

**Zasada pracy:** testy pisane razem z kodem funkcji, ale **uruchamiane dopiero na końcu pisania danej funkcji** (nie po każdej małej zmianie).

- API (pytest + testcontainers z PostGIS): CRUD, logowanie hasłem, historia i cofanie, konflikt 409, zapytania mapy (środki, obrysy, skały bez sektora).
- Importer: zapisane prawdziwe odpowiedzi Portalu (kilka skał, w tym Żabi Koń, id 111, ściana 46) w `tests/fixtures/`; testy parsera offline, w tym przeliczanie skali punktów i `grade_sort`.
- Głębia: dla przykładowego zdjęcia powstaje mapa głębi o oczekiwanym rozmiarze (model Small, CPU; test oznaczony jako wolny).
- Front (Vitest): logika edytora (dodawanie, przesuwanie, usuwanie, warianty, cofanie), przeliczanie punktów 2D → 3D, odwzorowanie wycen.
- E2E (Playwright): mapa → przybliżenie → skała → kliknięcie drogi podświetla linię; logowanie → narysowanie drogi → zapis → zmiana widoczna w historii.

## 11. Kamienie milowe

1. Szkielet: repo, compose, baza, migracje Alembic, API odczytu.
2. Importer Portalu Górskiego, a po nim sprawdzenie na prawdziwych danych (skala punktów, wyceny, hierarchia).
3. Mapa z trzema poziomami i podkładami.
4. Strona skały: widok 2D i lista dróg.
5. Mapy głębi (GPU, CLI) i widok 2.5D.
6. Hasło, edycja tekstu, historia zmian i cofanie.
7. Edytor topo i wgrywanie zdjęć z kolejką głębi.
8. Wyszukiwarka, strony regionu i sektora, ostatnie zmiany.
9. Importer wspinanie.pl, eksport i instrukcja wdrożenia na serwer (tunel).

## 12. Poza zakresem pierwszej wersji (pomysły na później)

- **Prawdziwe modele 3D (opcja C):** fotogrametria (COLMAP lub aplikacje typu Polycam/Scaniverse) → glTF albo Gaussian splat wgrywany do ściany; jeśli istnieje, pokazywany zamiast 2.5D. Drogi rysowane w 3D (raycasting na siatkę), punkty z (x,y,z).
- Konta użytkowników z listą projektów i dziennikiem przejść.
- Tryb offline / PWA do pracy pod skałą bez zasięgu.
