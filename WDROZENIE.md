# Wdrożenie na serwer

Serwer: Debian z Dockerem (VM na Proxmoxie), z działającym już nginx i Cloudflare Tunnel. Topo działa jako osobny stos (`docker-compose.prod.yml`): baza PostGIS, API i `web` (nginx ze stroną, `/media` i przekazywaniem `/api`). Na zewnątrz wystawia **jeden port: 8090**, który podpinasz w swoim nginx. Bez workera głębi (patrz koniec).

W przykładach: serwer `user@serwer`, katalog `/opt/topo`, adres `https://topo.twojadomena.pl`. Polecenia „u siebie” uruchamiaj w Git Bash w katalogu repo.

## 1. Kod i ustawienia na serwerze

Na serwerze przygotuj katalog:

```bash
ssh -t user@serwer 'sudo mkdir -p /opt/topo && sudo chown $USER /opt/topo'
```

U siebie wyślij kod (aktualny commit z gałęzi, bez `media`, `.env` i `node_modules`):

```bash
git archive HEAD | ssh user@serwer "tar -xf - -C /opt/topo"
```

Na serwerze:

```bash
ssh user@serwer
cd /opt/topo
cp .env.prod.example .env
nano .env                              # uzupełnij wszystkie pola
```

W `.env`:

- `PUBLIC_URL` — adres strony z `https://`.
- `EDIT_PASSWORD` — **nowe, długie** hasło edycji (np. 4–5 losowych słów); nie lokalne `e2e-haslo`.
- `SECRET_KEY` — wynik `openssl rand -hex 32`.
- `DB_PASSWORD` — wynik `openssl rand -hex 16`.
- `TOPO_PORT` — zostaw `127.0.0.1:8090`, jeśli nginx działa bezpośrednio na VM. Jeśli Twój nginx jest w kontenerze, ustaw `8090` (port na wszystkich interfejsach) i w `proxy_pass` użyj adresu VM.

## 2. Baza: kopia u siebie → serwer

U siebie (lokalny stos musi działać: `docker compose up -d db`):

```bash
docker compose exec -T db pg_dump -U topo -Fc topo > topo.dump
scp topo.dump user@serwer:/opt/topo/
```

Na serwerze — najpierw sama baza, odtworzenie, potem reszta:

```bash
cd /opt/topo
docker compose -f docker-compose.prod.yml up -d --wait db
docker compose -f docker-compose.prod.yml exec -T db pg_restore -U topo -d topo --clean --if-exists --no-owner < topo.dump
rm topo.dump
```

## 3. Zdjęcia (folder `media`, ok. 4,3 GB) po SSH

U siebie, w katalogu repo — jedno polecenie pakuje folder w locie, przesyła i rozpakowuje na serwerze (nic nie zapisuje się po drodze):

```bash
tar -cf - media | ssh user@serwer "tar -xf - -C /opt/topo"
```

Trwa kilka–kilkanaście minut w sieci domowej. Jeśli przerwie się w połowie — po prostu uruchom jeszcze raz (nadpisze pliki).

Sprawdzenie na serwerze: `du -sh /opt/topo/media` powinno pokazać ok. 4,3 G.

## 4. Start

```bash
cd /opt/topo
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps      # trzy usługi „running”
curl -s http://127.0.0.1:8090/api/health          # {"status":"ok"}
```

API przy starcie samo uruchamia migracje bazy.

## 5. Twój nginx i tunel

Nowy blok w nginx na serwerze (np. `/etc/nginx/sites-available/topo`, potem link do `sites-enabled`):

```nginx
server {
    listen 80;
    server_name topo.twojadomena.pl;
    # zdjęcia do 30 MB, zapis modelu 2.5D do ok. 60 MB
    client_max_body_size 64m;

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 120s;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

W `cloudflared` dopisz regułę dla subdomeny, kierującą na Twój nginx (tak jak dla pozostałych stron), np. w `config.yml`:

```yaml
  - hostname: topo.twojadomena.pl
    service: http://localhost:80
```

i `sudo systemctl restart cloudflared` (albo dodaj hostname w panelu Zero Trust, jeśli tak masz skonfigurowany tunel). Nagłówek `CF-Connecting-IP` z Cloudflare przechodzi przez Twój nginx bez zmian — z niego topo bierze prawdziwy adres odwiedzającego (limit prób logowania).

## 6. Sprawdzenie

- `https://topo.twojadomena.pl` — mapa, skała, zdjęcia, widok 2.5D.
- Zaloguj się nowym hasłem, zmień coś drobnego i cofnij w historii.
- `https://topo.twojadomena.pl/media/walls/1/original.jpg` → 404 (oryginały z danymi EXIF są ukryte).

## Aktualizacja aplikacji

U siebie (po scaleniu zmian):

```bash
git archive HEAD | ssh user@serwer "tar -xf - -C /opt/topo"
ssh user@serwer "cd /opt/topo && docker compose -f docker-compose.prod.yml up -d --build"
```

Nadpisuje tylko pliki kodu — `.env`, `media` i baza zostają.

## Kopia zapasowa

```bash
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U topo -Fc topo > ~/topo-$(date +%F).dump
```

plus folder `/opt/topo/media` (np. kopią VM w Proxmoxie).

## Głębia (2.5D) dla nowych zdjęć

Na serwerze nie ma workera głębi (mało RAM-u). Zdjęcia wgrane na serwerze mają widok 2D i status „czeka na głębię”. Gdy uzbiera się ich trochę, można je policzyć u siebie na GPU:

1. Ściągnij bazę i nowe zdjęcia z serwera (kopia bazy jak w kroku 2, tylko w drugą stronę; folder: `ssh user@serwer "tar -cf - -C /opt/topo media" | tar -xf -`).
2. U siebie: `docker compose run --rm depth topo depth --all`.
3. Wyślij z powrotem bazę i `media` jak w krokach 2–3.

Uwaga: w czasie tej operacji nikt nie powinien edytować na serwerze (zmiany zrobione w międzyczasie zostałyby nadpisane kopią).
