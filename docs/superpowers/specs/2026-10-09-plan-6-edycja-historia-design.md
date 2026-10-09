# Topo — plan 6: hasło, edycja danych, historia i cofanie

Data: 2026-10-09
Status: zatwierdzony w rozmowie, do przeglądu jako dokument (mockupy w `.superpowers/brainstorm/1537-1791538331/content/`: `edycja-skaly.html`, `historia.html`, `mapa-edycja.html`, `nowy-sektor.html`)
Uzupełnia: `docs/superpowers/specs/2026-10-08-topo-design.md` §5, §6, §11 (kamień milowy 6), `docs/superpowers/specs/2026-10-08-frontend-design.md` (system wizualny).

## 1. Cel

Znajomi z wspólnym hasłem poprawiają dane: pola skał, dróg, ścian i obszarów, położenie skał na mapie, usuwają i dodają skały, zakładają sektory. Każda zmiana jest podpisana nickiem, widoczna w historii i da się ją cofnąć — także pojedynczo, z pominięciem późniejszych zmian.

**Kryteria sukcesu**
1. Po zalogowaniu (hasło + nick) można poprawić opis skały i wycenę drogi; zmiana jest widoczna w historii skały z różnicą pól.
2. Usuniętą skałę (ze ścianami, drogami i liniami) da się przywrócić jednym kliknięciem z „Ostatnich zmian”, razem z działającym 2D i 2.5D.
3. Skałę z kilkoma ścianami można zamienić w sektor, rozstawić nowe skały na mapie i cofnąć całą operację.
4. Ponowny import Portalu Górskiego nie nadpisuje ręcznych zmian ani cofnięć.

## 2. Zakres

**W planie 6**
- Logowanie hasłem i nickiem, wylogowanie.
- Edycja pól: obszar (nazwa, opis, rodzic), skała (wszystkie pola opisowe, region/sektor, położenie), droga (wszystkie pola), ściana (nazwa, opis, kolejność).
- Dodawanie: skała (kliknięcie na mapie), droga, sektor (z istniejących skał), region.
- Usuwanie: skała (z całą zawartością), droga, ściana, pusty obszar.
- Zamiana skały w sektor (ściany → osobne skały).
- Historia przy skale, globalne „Ostatnie zmiany” (tylko po zalogowaniu), cofanie z obsługą konfliktów.
- Długi techniczne z planu 2 (§5.1).

**Przeniesione do planu 7** (razem z edytorem topo i kolejką głębi)
- Edytor topo: linie, przesuwanie i usuwanie wpinek.
- Wgranie nowej ściany i **wymiana zdjęcia** istniejącej ściany (przeliczenie głębi i segmentacji; stare linie przestają pasować).
- **Edycja modelu 2.5D**: pędzle (spłaszcz, gumka, maluj podłoże, maluj skałę), wygładzanie, przycinanie krawędzi, kolory skały i podłoża, ręczny włącznik 2.5D — z zapisem.
- Zobowiązanie dla edytorów planu 7 (topo i 2.5D): lokalny stos kroków (zustand + zundo, limit ~100) — **Ctrl+Z cofa ostatni krok** (pociągnięcie pędzla, przesunięcie punktu, zmiana koloru), Ctrl+Shift+Z / Ctrl+Y ponawia, na telefonie przyciski ↶ ↷; szkic na bieżąco w przeglądarce (odświeżenie nie gubi pracy); „Zapisz” można klikać wielokrotnie — każde kliknięcie to checkpoint (wpis w historii serwera), a stos kroków zostaje po zapisie. Pojedyncze kroki nie trafiają do historii serwera.

**Plan 8** zostaje: wyszukiwarka, strony regionu i sektora.

## 3. Zasada zapisu

- Jeden zapis = jedna transakcja w historii (autor = nick, opcjonalny komentarz).
- Formularze: nic nie zapisuje się samo; „Zapisz” wysyła tylko zmienione pola (`PATCH`). W polach działa zwykłe Ctrl+Z przeglądarki.
- Przesunięcie pinezki, usunięcie, zamiana w sektor, nowy sektor — jedna transakcja po potwierdzeniu.
- Dwie osoby zmieniające różne pola sobie nie przeszkadzają; przy tym samym polu wygrywa ostatni zapis (poprzednia wartość zostaje w historii). Kontrola `version` zostaje tylko dla topo ściany (plan 7).

## 4. API

Format błędów bez zmian: `{code, message}`. Wszystkie zapisy wymagają ciasteczka sesji (inaczej 401) i przyjmują opcjonalne `comment` (≤ 500 znaków).

### 4.1 Logowanie (`/api/auth`)
- `POST /login {password, nick}` → ciasteczko `topo_edit`: podpisane (`itsdangerous`, klucz `SECRET_KEY`), HttpOnly, SameSite=Lax, `Secure` gdy `PUBLIC_URL` to https, ważne 1 rok. Zawartość: nick + odcisk hasła (HMAC z `EDIT_PASSWORD`) — zmiana hasła na serwerze wylogowuje wszystkich.
- Złe hasło → 401 „Złe hasło”. Więcej niż 5 prób na minutę z jednego IP → 429 (licznik w pamięci procesu).
- Nick: 2–40 znaków po przycięciu, nie może zaczynać się od `import:`.
- `POST /logout` usuwa ciasteczko. `GET /me` → `{nick}` albo 401.
- Brak `EDIT_PASSWORD` w konfiguracji → logowanie wyłączone (503 „edycja wyłączona”).

### 4.2 Edycja
- `POST /api/areas {kind, parent_id, name, description?, crag_ids?}` — region (rodzic: obszar) albo sektor (rodzic: region). Z `crag_ids`: wszystkie skały muszą należeć do tego regionu (bezpośrednio albo przez jego sektory) — przechodzą do nowego sektora; inaczej 422.
- `PATCH /api/areas/{id}` — `name`, `description`, `parent_id` (przeniesienie sektora do innego regionu). `DELETE` — tylko pusty obszar, inaczej 409 „najpierw przenieś skały”.
- `POST /api/crags {name, area_id, location}`; `PATCH /api/crags/{id}` — pola opisowe, `area_id`, `location` (`[lon, lat]`; zeruje `needs_location`); `DELETE` — skała ze ścianami, drogami, liniami i punktami (pliki zdjęć i głębi zostają na dysku).
- `POST /api/crags/{id}/routes`; `PATCH`/`DELETE /api/routes/{id}`. Zmiana `grade` przelicza `grade_sort`; nieznana wycena → 422 z przykładem formatu. Usunięcie drogi usuwa jej linie.
- `PATCH /api/walls/{id}` — `name`, `description`, `sort_order`. `DELETE /api/walls/{id}` — ściana z liniami (pliki zostają).
- `POST /api/crags/{id}/to-sector` — §6.3.
- Zmiana nazwy nie zmienia `slug`. Nowe obiekty dostają `slug` z nazwy (z przyrostkiem `-2`, `-3` przy kolizji), `source = manual`.
- Po każdej zmianie położenia skały lub przynależności do obszaru — odświeżenie `area_geom`.
- `GET /api/crags/{slug}` dostaje `id` obiektów potrzebne do zapisu (skała, ściany, drogi) i `needs_location`; mapa skał — `needs_location` w właściwościach punktu.

### 4.3 Historia
- `GET /api/changes?crag=&kind=&limit=&before=` — transakcje od najnowszych: `id`, `author`, `comment`, `issued_at`, `is_import`, `reverted_by` (id cofnięcia, jeśli cofnięta), lista zmienionych obiektów: typ, id, nazwa (dla drogi też skała), operacja (`created|updated|deleted`), różnice `{field, before, after}`; oraz skała i ścieżka obszaru do odnośnika. `crag` filtruje do skały, jej ścian, dróg, linii i punktów (także usuniętych); `kind=deleted` — tylko transakcje z usunięciem skały, drogi lub ściany; domyślnie bez transakcji importu (`include_import=true` je dodaje).
- Zmiany linii i punktów są w różnicach streszczane („topo ściany 2: zmieniono 3 linie”) — szczegóły w edytorze w planie 7.
- `POST /api/changes/{id}/revert {mode?: "all" | "safe"}` — §6.2. Bez `mode` przy konflikcie → 409 z listą konfliktów (`object`, `field`, `author`, `issued_at`, `current`, `restored`); `mode = "safe"` cofa tylko pola bez konfliktu, `"all"` — wszystko. Transakcja importu → 403.

## 5. Dane

### 5.1 Migracja i długi z planu 2
- `transaction.issued_at` → `timestamptz`.
- Indeksy na tabelach `*_version`: `(transaction_id)`, `(source, source_id)`.
- `crag.needs_location boolean not null default false`.
- `sqlalchemy-continuum>=1.8,<1.9` + test zamieniający ostrzeżenia SQLAlchemy (`SAWarning`) w błędy.
- `is_manually_edited` / `has_manual_version`: wersje bez wiersza `transaction` (osierocone) liczone jako ręczne.
- Zapisy głębi dalej omijają historię (plan 5, `set_wall_fields`).

### 5.2 Ustawienia
`EDIT_PASSWORD`, `SECRET_KEY` w `Settings` i `.env.example`. Brak `SECRET_KEY` przy ustawionym haśle → błąd przy starcie API.

## 6. Mechanika historii (SQLAlchemy-Continuum)

### 6.1 Co zmieniła transakcja T
Dla każdego obiektu z wierszem wersji w T: poprzednia wersja (najnowsza o `transaction_id < T`) i wersja z T; operacja z `operation_type` (0 utworzenie, 1 zmiana, 2 usunięcie). Różnice pomijają pola techniczne: `version`, `source`, `source_id`, `source_url`, `grade_sort`, pola plików i głębi ściany (`image_*`, `thumb_path`, `depth_*`, `vegetation_ratio`, `route_vegetation_ratio`, `depth_enabled` — wszystkie zapisywane poza historią przez `set_wall_fields`), `needs_location`.

### 6.2 Cofnięcie T
Nowa transakcja: autor = nick, komentarz „cofnięcie #T” (+ komentarz użytkownika). Kolejność: wstawienia rodzic → dziecko (obszar → skała → ściana → droga → linia → punkt), usunięcia odwrotnie.
- **Zmiana:** pole, które dziś ma wartość z T → wraca do wartości sprzed T; pole z inną wartością dziś → konflikt; pole już równe wartości sprzed T → pomijane.
- **Utworzenie:** obiekt usuwany; jeśli później edytowany → konflikt (w `safe` pomijany).
- **Usunięcie:** obiekt wstawiany z ostatniej wersji z tym samym `id`. Brak rodzica (usunięty osobno później) → 409 „najpierw przywróć …” z id tamtej transakcji. Przywrócona ściana: stan głębi i segmentacji odtwarzany z plików na dysku, bo zapisy głębi omijają historię i wersja ma nieaktualne wartości — `depth.png` jest → `depth_status = ready`, `depth_path`; `segments.png` jest → `vegetation_ratio` i `route_vegetation_ratio` przeliczone (`vegetation_stats`); brak plików → `depth_status = pending`. Zapis przez `set_wall_fields` (poza historią). Kolizja `slug` → przyrostek `-2`.
- Cofnięcie cofnięcia działa tym samym mechanizmem. Transakcja, która ma już cofnięcie, pokazuje „cofnięta przez #N” (przycisk dalej dostępny — drugie cofnięcie nic nie zmieni lub zgłosi konflikt).
- Po cofnięciu odświeżany `area_geom`.

### 6.3 Zamiana skały w sektor (`to-sector`)
Jedna transakcja:
1. Nowy sektor: nazwa i opis skały; rodzic = region skały (gdy skała jest w sektorze — region tego sektora, nowy sektor obok).
2. Każda ściana → nowa skała: nazwa ściany albo „{skała} — ściana N”, pola opisowe skopiowane ze starej skały, położenie starej skały, `needs_location = true` (oprócz pierwszej, która zostaje w punkcie starej skały — `needs_location = false`).
3. Drogi: droga trafia do skały pierwszej ściany (wg `sort_order`), na której ma linię; na każdej kolejnej ścianie, na której ma linię, powstaje kopia drogi, a linie tej ściany wskazują kopię. Drogi bez linii → do pierwszej nowej skały.
4. Stara skała usuwana.
- Odpowiedź: id sektora i nowych skał. Przed wykonaniem front pokazuje podsumowanie (`GET /api/crags/{id}/to-sector/preview`: liczba skał, liczba dróg z kopiami).
- Skała z jedną ścianą → 422 „skała ma tylko jedną ścianę”.

### 6.4 Ochrona importu
Ręczne zmiany, cofnięcia, nowe sektory i zamiany mają autora spoza `import:` → import ich nie nadpisuje (dotychczasowe reguły z planu 2). Skały z zamiany mają `source = manual`.

## 7. Front

Wygląd według `2026-10-08-frontend-design.md` (styl „Przewodnik”, jasny i ciemny motyw); układy zatwierdzone na mockupach.

### 7.1 Sesja
- Górny pasek: niezalogowany — przycisk „✎ Edytuj”; zalogowany — kafelek „⟲ Ostatnie zmiany” obok wyszukiwarki i „● nick ▾” (wyloguj, zmień nick = ponowne logowanie).
- Okienko logowania: hasło, nick, „Zapamiętamy na tym urządzeniu przez rok”, „Anuluj / Wejdź”.
- Stan sesji z `GET /api/auth/me` (TanStack Query); 401 w trakcie zapisu → okienko logowania i ponowienie zapisu po zalogowaniu (formularz nie traci danych).

### 7.2 Strona skały
- **Skała — tryb edycji całej skały (B):** „✎ Edytuj skałę” zamienia nagłówek, chipy, opis i dojście w formularz; przyklejony u dołu pasek: komentarz, „Anuluj”, „Zapisz zmiany (n)”. Wyjście z niezapisanymi zmianami → pytanie.
- **Drogi — panel (C):** ✎ przy drodze otwiera panel z prawej (telefon: od dołu) z polami drogi, „Usuń”, „Zapisz”; topo i lista zostają widoczne, wybrana droga podświetlona. „+ Dodaj drogę” pod listą otwiera ten sam panel.
- **Ściany:** ✎ przy miniaturze — nazwa, opis, kolejność, usunięcie.
- **Menu „⋯”** obok „Edytuj skałę”: Historia, Przesuń na mapie, Zamień w sektor, Usuń skałę (potwierdzenie z liczbą ścian i dróg).
- **Historia (panel):** wpisy od najnowszych — kto, kiedy, komentarz, różnice (stara wartość przekreślona, nowa podświetlona), „↶ Cofnij” / „↶ Przywróć”; wpis importu wyszarzony, bez przycisku.
- **Okienko konfliktu:** lista pól zmienionych później (kto, kiedy, obecna → przywracana wartość); „Anuluj”, „Cofnij tylko bez konfliktu”, „Cofnij wszystko”.

### 7.3 Mapa
- **Przesuń na mapie:** mapa przybliżona na skałę, przeciągnięcie pinezki albo kliknięcie w nowe miejsce; widoczne stare miejsce, odległość, współrzędne; „Anuluj / Zapisz położenie”.
- **„+ Dodaj skałę”** (pływający przycisk po zalogowaniu): kliknięcie miejsca → okienko: nazwa, region/sektor (podpowiedź: najbliższy sektor) → „Dodaj i otwórz”.
- **Nowy sektor:** karta regionu → „+ Nowy sektor” → klikanie skał (ponowny klik odznacza), obrys na żywo, „n skał · m dróg” → formularz: nazwa, opis, lista skał (z informacją, z którego sektora przechodzą) → „Utwórz sektor”.
- **Karta sektora/regionu** (po zalogowaniu): „✎” nazwa i opis; usunięcie pustego obszaru.
- **Rozstawianie po zamianie:** skały z `needs_location` mają żółtą pinezkę; karta sektora pokazuje listę „do rozstawienia” z „Ustaw na mapie”.

### 7.4 Ostatnie zmiany (`/zmiany`, tylko po zalogowaniu)
Lista transakcji z doczytywaniem przy przewijaniu; filtry: wszystkie / bez importu (domyślnie) / tylko usunięcia. Wpis: kto, kiedy, skała i ścieżka obszaru, różnice, „↶ Cofnij” / „↶ Przywróć”, „Otwórz skałę/sektor”. Usunięte skały odnajduje się tutaj (zastępuje osobny kosz).

### 7.5 Komunikaty
Po polsku przez Sonner: „Zapisano”, „Cofnięto zmianę #T”, błędy walidacji przy polach, 409 przy usuwaniu obszaru z treścią z API.

## 8. Obsługa błędów
- 401 bez sesji / po zmianie hasła; 403 przy cofaniu importu; 404; 409 (konflikt cofania, brak rodzica przy przywracaniu, niepusty obszar); 422 (walidacja: nieznana wycena, położenie poza zakresem, skały z innego regionu, zamiana skały z jedną ścianą); 429 (logowanie).
- Częściowy błąd przy cofaniu nie zostawia połowicznego stanu — całe cofnięcie w jednej transakcji bazy.

## 9. Testy
**Zasada:** pisane razem z kodem, uruchamiane raz na końcu zadania.
- API (pytest + PostGIS): logowanie (złe hasło, 429, wylogowanie po zmianie hasła, nick `import:`), 401 bez sesji; CRUD obszarów, skał, dróg, ścian z autorem w transakcji; `grade_sort` po zmianie wyceny; cofnięcie zmiany pola, konflikt + `safe` + `all`; cofnięcie usunięcia skały (ściany, drogi, linie, punkty, stan głębi z plików); cofnięcie utworzenia; brak rodzica; kolizja `slug`; zamiana w sektor tam i z powrotem (podział dróg, kopie); nowy sektor z `crag_ids` i jego cofnięcie; filtr `crag` i `kind=deleted`; import po ręcznej zmianie i po cofnięciu nie nadpisuje; osierocone wersje liczone jako ręczne; `SAWarning` jako błąd.
- Front (Vitest): różnice pól i ich formatowanie, budowanie `PATCH` tylko ze zmienionych pól, stan sesji i ponowienie zapisu po 401, okienko konfliktu (trzy przyciski).
- E2E (Playwright): logowanie → edycja wyceny drogi → wpis w historii skały → cofnięcie → stara wycena na liście.
