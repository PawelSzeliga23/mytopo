"""HTTP fetching with an on-disk cache, polite delays between requests and retries."""

import hashlib
import time
from collections.abc import Callable, Mapping
from pathlib import Path

import httpx

DEFAULT_USER_AGENT = "topo-importer/0.1 (prywatne, niekomercyjne wiki topo)"


class FetchError(Exception):
    pass


class CacheMiss(FetchError):
    pass


class CachedFetcher:
    def __init__(
        self,
        cache_dir: Path,
        *,
        delay: float = 1.5,
        retries: int = 3,
        offline: bool = False,
        user_agent: str = DEFAULT_USER_AGENT,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.cache_dir = Path(cache_dir)
        self.delay = delay
        self.retries = retries
        self.offline = offline
        self.client = client or httpx.Client(timeout=60, follow_redirects=True)
        self.client.headers["User-Agent"] = user_agent
        self.sleep = sleep
        self._requested = False

    def get(self, url: str) -> bytes:
        return self._fetch("GET", url, None)

    def post(self, url: str, data: Mapping[str, str]) -> bytes:
        return self._fetch("POST", url, data)

    def cache_path(self, method: str, url: str, data: Mapping[str, str] | None = None) -> Path:
        key = f"{method} {url}"
        if data:
            key += "?" + "&".join(f"{name}={value}" for name, value in sorted(data.items()))
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return self.cache_dir / digest[:2] / digest

    def _fetch(self, method: str, url: str, data: Mapping[str, str] | None) -> bytes:
        path = self.cache_path(method, url, data)
        if path.exists():
            return path.read_bytes()
        if self.offline:
            raise CacheMiss(f"Brak w cache: {method} {url}")
        body = self._download(method, url, data)
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_suffix(".part")
        partial.write_bytes(body)
        partial.replace(path)
        return body

    def _download(self, method: str, url: str, data: Mapping[str, str] | None) -> bytes:
        error = FetchError(f"Nie udało się pobrać: {method} {url}")
        for attempt in range(self.retries):
            if self._requested:
                self.sleep(self.delay)
            self._requested = True
            try:
                response = self.client.request(method, url, data=data)
            except httpx.TransportError as exc:
                error = FetchError(f"Błąd sieci: {method} {url}: {exc}")
            else:
                if response.status_code < 400:
                    return response.content
                if response.status_code < 500:
                    raise FetchError(f"HTTP {response.status_code}: {method} {url}")
                error = FetchError(f"HTTP {response.status_code}: {method} {url}")
            if attempt + 1 < self.retries:
                self.sleep(self.delay * 2 ** (attempt + 1))
                self._requested = False
        raise error
