# Przegląd bezpieczeństwa przed wdrożeniem (2026-10-11)

Zakres: cała aplikacja na `master` (6bff4dc): logowanie i sesja, zapisy, wgrywanie plików, serwowanie mediów, SQL, front, konfiguracja, zależności. Testy na żywym API (lokalnie) + przegląd kodu.

## Sprawdzone, w porządku

- **Zapisy wymagają zalogowania:** każdy POST/PATCH/PUT/DELETE poza `/api/auth/login` ma `Depends(current_editor)`; na żywo PATCH/DELETE/cofanie bez ciasteczka → 401, sfałszowane ciasteczko → 401.
- **Sesja:** ciasteczko podpisane (`itsdangerous`), `HttpOnly`, `SameSite=Lax`, `Secure` przy `https://` w `PUBLIC_URL`; zmiana hasła unieważnia wszystkie sesje (odcisk hasła w tokenie); porównania w stałym czasie. Brak zmieniających stan żądań GET, więc `Lax` chroni przed CSRF.
- **Ogranicznik logowania:** 5 prób na minutę na adres (6. → 429); nagłówek `X-Forwarded-For` nie jest ufany (nie da się go obejść podmianą).
- **SQL:** zapytania sparametryzowane; w `text(f"...")` wstawiane są tylko stałe z kodu (warianty, `Literal`), wzorce LIKE escapowane. Próby wstrzyknięcia w wyszukiwarce → zwykły pusty wynik.
- **Wgrywanie:** limit 30 MB czytany przed dekodowaniem, tylko JPEG/PNG/WebP (sprawdzane przez Pillow, nie po nazwie), ochrona przed bombą dekompresyjną, pliki zapisywane pod własnymi nazwami (`walls/{id}/{n}/…`).
- **Media:** `StaticFiles` blokuje wyjście poza katalog (`/media/../.env` → 404).
- **Front:** brak `dangerouslySetInnerHTML`/`eval`; jedyny link z danych (`source_url`) pochodzi z importu i nie jest edytowalny.
- **Błędy:** 500 zwraca ogólny komunikat, szczegóły tylko w logu.
- **Sekrety:** `.env` w `.gitignore`, nigdy nie trafił do historii; w repo tylko `.env.example` bez wartości.
- **Zależności:** Python (`pip-audit`, bez dev) — brak znanych podatności. npm (`--omit=dev`) — 7 „high”, wszystkie w łańcuchu CLI `shadcn` (ReDoS w `braces`/`micromatch` przy globowaniu); CLI nie trafia do zbudowanej strony.
- **Porty:** baza i API w compose wystawione tylko na `127.0.0.1`.

## Do poprawienia przy wdrożeniu

| # | Waga | Problem | Poprawka |
|---|------|---------|----------|
| 1 | średnia | **Oryginały zdjęć z EXIF są publiczne** pod przewidywalnym adresem `/media/walls/{id}/{n}/original.jpg` — GPS, model telefonu, data. Aplikacja ich nie wyświetla (widok i głębia używają `display.webp`). | nginx: `location ~ /original\.` → 404; dodatkowo zapisywać oryginał bez EXIF (Pillow) albo poza katalogiem serwowanym. |
| 2 | średnia | **Za tunelem/nginx wszyscy mają ten sam adres** (`request.client.host` = proxy): 5 złych prób kogokolwiek blokuje logowanie wszystkim na minutę. | uvicorn `--proxy-headers --forwarded-allow-ips=<nginx>`, nginx ustawia `X-Forwarded-For` z `CF-Connecting-IP` (`real_ip_header`), tylko z sieci tunelu. |
| 3 | średnia | **Jedno wspólne hasło** — przy 5 próbach/min to ok. 7 tys. prób na dobę z jednego adresu. Lokalne `e2e-haslo` jest za słabe. | Na serwerze długie losowe hasło (np. 4–5 losowych słów) i losowy `SECRET_KEY` (`openssl rand -hex 32`); nie kopiować lokalnego `.env`. |
| 4 | niska | **Brak nagłówków bezpieczeństwa** (klikanie w ukrytej ramce na stronie edycji, sniffing typów). | nginx: `X-Frame-Options: DENY` (albo CSP `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, CSP dla SPA; HSTS po stronie Cloudflare. |
| 5 | niska | **`/docs` i `/openapi.json` publiczne.** | W produkcji `docs_url=None, openapi_url=None` (zmienna środowiskowa). |
| 6 | niska | **`uvicorn --reload`, kod montowany z hosta, hasło bazy `topo/topo`** w dev compose. | Osobny `docker-compose.prod.yml`: obraz bez `--reload` i bez zależności dev, użytkownik nie-root, losowe hasło bazy, baza bez wystawionego portu. |
| 7 | niska | Sesja ważna rok, wylogowanie nie unieważnia skradzionego ciasteczka (token bezstanowy). | Akceptowalne dla „hasła dla znajomych”; awaryjnie zmiana hasła unieważnia wszystkie sesje. Ewentualnie skrócić do 90 dni. |
| 8 | info | `shadcn` (CLI) w `dependencies`. | Przenieść do `devDependencies` — audyt produkcyjny będzie czysty. |
| 9 | info | Ogranicznik logowania w pamięci procesu. | Działa przy jednym procesie uvicorna — tak zostawić (bez `--workers`). |
| 10 | info | `client_max_body_size` w nginx domyślnie 1 MB. | Ustawić 31m dla `/api/` (zdjęcia do 30 MB). |
