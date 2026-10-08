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
