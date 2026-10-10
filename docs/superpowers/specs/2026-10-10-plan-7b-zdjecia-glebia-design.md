# Topo — plan 7b: wgrywanie i wymiana zdjęć ścian, kolejka głębi

Data: 2026-10-10
Status: zatwierdzony w rozmowie (użytkownik: „ok, pisz spec potem od razu plan i potem od razu zrób sam”)
Uzupełnia: `docs/superpowers/specs/2026-10-08-topo-design.md` §5 (API), §6.4 (głębia), §7 (pliki), §8 (kolejka); `docs/superpowers/specs/2026-10-09-plan-6-edycja-historia-design.md` (historia i cofanie).

Plan 7 = 7a edytor topo (gotowy), **7b zdjęcia i kolejka głębi** (ten dokument), 7c edytor modelu 2.5D.

## 1. Cel

Zalogowani znajomi dodają do skały nową ścianę ze zdjęciem albo wymieniają zdjęcie istniejącej ściany. Zdjęcie od razu widać w 2D; mapa głębi i segmentacja liczą się w tle, po czym ściana sama dostaje widok 2.5D (według dotychczasowej reguły roślinności).

**Kryteria sukcesu**
1. „⋯ → Dodaj ścianę” na stronie skały: wybór zdjęcia → ściana jest na skale, otwiera się edytor topo tej ściany.
2. „⋯ → Podmień zdjęcie”: linie dróg zostają bez zmian, otwiera się edytor topo, żeby je poprawić.
3. Po wgraniu napis „Model 2.5D w przygotowaniu”; gdy działa `depth-worker`, po chwili (bez przeładowania strony) pojawia się 2.5D albo nic (dużo roślinności).
4. Błąd liczenia → „Nie udało się policzyć 2.5D” i (po zalogowaniu) „Ponów”.
5. Dodanie ściany i podmianę zdjęcia widać w historii skały i da się je cofnąć; cofnięcie podmiany przywraca poprzednie zdjęcie razem z jego gotową głębią.

## 2. Zakres

**W 7b:** endpointy wgrywania (nowa ściana, podmiana, ponowienie głębi), wersjonowane katalogi zdjęć, worker kolejki głębi (`topo depth-worker`) i usługa w docker-compose, wpisy historii i cofanie podmiany, okno wgrywania i status 2.5D na stronie skały.

**Poza 7b:** ręczne poprawki modelu 2.5D i ręczny włącznik 2.5D w UI (7c), kadrowanie / obracanie w przeglądarce, pasek postępu wysyłania, HEIC, usuwanie starych plików, przeliczanie modelem Large ścian zrobionych Small (jest `topo depth --only-model small`).

## 3. Pliki

- Każde wgranie zdjęcia trafia do nowego podkatalogu `media/walls/{wall_id}/{n}/` (`n` = 1 + największy istniejący numerowany podkatalog tej ściany): `original.{ext}`, `display.webp` (1600 px), `thumb.webp` (400 px), a po przeliczeniu `depth.png` i `segments.png`.
- Ściany z importu zostają w `walls/{id}/` — ścieżki są w bazie, nic się nie przenosi.
- **Katalog zdjęcia** = katalog nadrzędny `wall.image_path`. Głębia i segmentacja są zawsze zapisywane i szukane w katalogu zdjęcia: `process_wall`, `_restore_depth` (cofanie), adres `segments_url` w API skały, galeria `topo depth-preview`.
- Pliki nigdy nie są usuwane (cofnięcie podmiany i cofnięcie usunięcia ściany ich potrzebują).
- Walidacja: najwyżej 30 MB; Pillow musi otworzyć plik (JPEG, PNG, WebP; zbyt duży obraz — `DecompressionBombError` — też jest błędem); zły plik → 422 `invalid_image` „Nieprawidłowy plik obrazu”, za duży → 413 `too_large`. EXIF obracany jak w imporcie.

## 4. API

Wszystkie wymagają zalogowania (401 jak dotąd). Multipart wymaga zależności `python-multipart`.

- `POST /api/crags/{id}/walls` (multipart: `file`, opcjonalnie `name`, `comment`) → 201 `{"id", "version"}`. Jedna transakcja historii: ściana `source=manual`, `sort_order` = największy w skale + 1, pola `image_*`, `depth_status=pending`, nowe zadanie `depth_job`.
- `PUT /api/walls/{id}/image` (multipart: `file`, opcjonalnie `comment`) → 200 `{"id", "version"}`. Wiersz ściany zablokowany (`FOR UPDATE`) na czas zapisu; nowy podkatalog; zmiana pól `image_*` (wersjonowanych); pola pochodne zerowane bez historii (`depth_status=pending`, `depth_path`, `depth_model`, `vegetation_ratio`, `route_vegetation_ratio`, `depth_enabled=NULL`); nowe zadanie. `version` ściany się nie zmienia — linie zostają, otwarty edytor topo nie dostaje konfliktu.
- `POST /api/walls/{id}/depth` → 202 `{"queued": true}`. Ponowienie: `depth_status=pending` i nowe zadanie; ściana bez zdjęcia → 422 `no_image`. Bez wpisu w historii.
- Dodanie zadania (`enqueue_depth`) nie tworzy duplikatu, gdy dla ściany czeka już zadanie `queued`.
- `depth_job.model` staje się nullable (migracja 0006): przy dodaniu pusty, worker wpisuje nazwę modelu, którym liczył.

## 5. Historia i cofanie

- Z `SKIP_FIELDS` wypada tylko `image_path`: zmiana zdjęcia jest różnicą pola `image_path` (pozostałe `image_*` zostają ukryte, idą razem z nim).
- Front: etykieta „zdjęcie”, wartość „z importu” dla `walls/{id}/display.webp`, „wersja {n}” dla `walls/{id}/{n}/display.webp`. Nowa ściana w historii: „Dodano ścianę …” z „zdjęcie: wersja 1”.
- Cofnięcie podmiany: gdy plan przywraca `image_path` ściany, przywraca też `image_original_path`, `thumb_path`, `image_width`, `image_height` z wersji sprzed transakcji, a potem `_restore_depth` tej ściany odczytuje głębię i segmentację z katalogu przywróconego zdjęcia (gotowe → `ready`, brak → `pending` i nowe zadanie).
- Ściana przywrócona przez cofnięcie usunięcia bez `depth.png` w katalogu zdjęcia też dostaje zadanie.

## 6. Worker głębi

`topo depth-worker [--model large|small] [--interval 5]`, w obrazie `depth`:
1. Wczytuje model głębi i segmentację raz.
2. Przy starcie zadania `running` (po awarii) wracają do `queued`.
3. Pętla: najstarsze zadanie `queued` (`SELECT … FOR UPDATE SKIP LOCKED`), status `running`, commit; liczy głębię i segmentację **bieżącego** zdjęcia ściany (`process_wall`, bez `force`: jeśli zdjęcie już ma gotową głębię, np. po cofnięciu, nic nie liczy); zadanie `done` albo `failed` z `error` (ściana `depth_status=failed` jak w `process_wall`). Ściana usunięta w międzyczasie → zadanie `done`.
4. Brak zadań → czeka `interval` sekund. Ctrl+C / SIGTERM kończy po bieżącym zadaniu.

docker-compose: usługa `depth-worker` (obraz `topo-depth`, profil `depth`, GPU, `restart: unless-stopped`, `command: topo depth-worker`). Uruchomienie: `docker compose --profile depth up -d depth-worker`. Na serwerze bez GPU: `topo depth-worker --model small`.

Odstępstwo od specyfikacji głównej (§8 „wątek w API”): pętla działa w osobnym procesie, bo obraz API nie ma torch; tabela i `SKIP LOCKED` bez zmian.

## 7. Interfejs

- **Menu „⋯” skały:** „Dodaj ścianę” (zawsze, dla zalogowanych — menu i tak jest tylko dla nich); przy bieżącej ścianie „Podmień zdjęcie” (albo „Dodaj zdjęcie”, gdy ściana nie ma zdjęcia).
- **`PhotoUploadDialog`** (Dialog jak `WallEditDialog`): przycisk wyboru pliku (`accept="image/jpeg,image/png,image/webp"`), podgląd wybranego zdjęcia, pole nazwy (tylko nowa ściana), komentarz, „Wyślij” → „Wysyłanie…”. Plik > 30 MB odrzucany od razu w przeglądarce. Błąd → toast z komunikatem API. Sukces → odświeżenie skały i przejście do `/skaly/{slug}/topo/{wallId}`.
- **Podmiana** pokazuje ostrzeżenie: „Linie dróg zostaną — po wgraniu otworzy się edytor, żeby je dopasować.”
- **Status 2.5D** pod zdjęciem w przeglądarce ściany (mały tekst w stylu podpisu): `pending` → „Model 2.5D w przygotowaniu”; `failed` → „Nie udało się policzyć 2.5D” + dla zalogowanych przycisk „Ponów” (`POST /depth`).
- **Odświeżanie:** zapytanie skały ma `refetchInterval` 15 s, dopóki któraś ściana ma `depth_status=pending`.

## 8. Testy

- pytest (bez modeli; atrapy estymatora i segmentera): nowa ściana (201, pliki w `walls/{id}/1/`, zadanie, historia), podmiana (nowy podkatalog `2`, pola zerowane, `version` bez zmian, zadanie bez duplikatu), 401, 422 zły plik, 413, ponowienie, cofnięcie podmiany (stare ścieżki, głębia z dysku), cofnięcie dodania; worker: przejęcie zadania, sukces, błąd, usunięta ściana, zadania `running` po restarcie; `process_wall` zapisuje do katalogu zdjęcia; `segments_url` z katalogu zdjęcia.
- vitest: `PhotoUploadDialog` (wysyła FormData, za duży plik, przejście do edytora), napisy statusu i „Ponów”, formatowanie pola „zdjęcie” w historii.
- Bez E2E (prośba użytkownika); użytkownik sprawdza klikając.
