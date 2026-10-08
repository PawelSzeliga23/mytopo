# Topo

Wiki topo dróg wspinaczkowych. Spec: `docs/superpowers/specs/2026-10-08-topo-design.md`.

## Uruchomienie (dev)

```powershell
docker compose up -d db
docker compose up api          # API na http://localhost:8000, dokumentacja: /docs
```

## Testy

```powershell
docker compose run --rm api pytest
```

## Zależności Pythona

Po zmianie `api/pyproject.toml`:

```powershell
docker run --rm -v "${PWD}/api:/app" -w /app ghcr.io/astral-sh/uv:python3.12-bookworm-slim uv lock
docker compose build api
```

## Import z Portalu Górskiego

```powershell
docker compose run --rm api topo import portalgorski --only-area "Dolina Kobylańska"   # próbnie
docker compose run --rm api topo import portalgorski                                   # całość, ok. 2–3 h
docker compose run --rm api topo draw-wall 1 /data/cache/podglad-1.png                  # podgląd linii → ./cache/
```

Surowe odpowiedzi trafiają do `./cache/`, zdjęcia do `./media/`. Ponowne uruchomienie korzysta z cache i nie nadpisuje ręcznych poprawek.

## Mapy głębi

Liczone modelem Depth Anything V2 w osobnej usłudze z GPU (obraz z PyTorch, ok. 6–8 GB):

```powershell
docker compose --profile depth build depth
docker compose run --rm depth topo depth --crags 100        # próbnie: ściany pierwszych 100 skał
docker compose run --rm depth topo depth --all              # wszystkie bez gotowej głębi (Large, GPU)
docker compose run --rm depth topo depth --only-model small # przelicz ściany zrobione modelem Small
docker compose run --rm depth topo depth --wall 12 --force  # jedna ściana od nowa
docker compose run --rm depth topo wall-3d 12 on           # 2.5D ręcznie (off = tylko 2D, auto = według roślinności)
docker compose run --rm depth pytest -m slow                # test prawdziwego modelu (Small, CPU)
```

Wynik: `media/walls/{id}/depth.png` (PNG 16-bit, dłuższy bok 768 px, jasne = bliżej) i `segments.png` (skała, podłoże, roślinność, niebo). Ściany, na których roślinność zasłania > 10% skały, nie mają 2.5D. W Git Bash argumenty `/data/…` poprzedź `MSYS_NO_PATHCONV=1`. Modele pobierają się do `./cache/huggingface/`.

Galeria do oceny wyników (zdjęcie z liniami, głębia, cieniowanie, podgląd 2.5D):

```powershell
docker compose run --rm depth topo depth-preview /data/cache/glebia --crags 100
npx --yes serve cache/glebia     # potem http://localhost:3000
```

## Front

```powershell
docker compose up -d api        # API na :8000
cd web
npm install
npm run dev                     # http://localhost:5173
npm test                        # testy
```
