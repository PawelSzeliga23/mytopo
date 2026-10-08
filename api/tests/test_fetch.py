import httpx
import pytest

from topo.importer.fetch import CacheMiss, CachedFetcher, FetchError


def make_fetcher(tmp_path, handler, **kw):
    sleeps = []
    client = httpx.Client(transport=httpx.MockTransport(handler))
    fetcher = CachedFetcher(tmp_path, client=client, sleep=sleeps.append, **kw)
    return fetcher, sleeps


def test_get_downloads_once_then_uses_cache(tmp_path):
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(200, content=b"tresc")

    fetcher, _ = make_fetcher(tmp_path, handler)
    assert fetcher.get("https://example.org/a") == b"tresc"
    assert fetcher.get("https://example.org/a") == b"tresc"
    assert len(calls) == 1
    assert fetcher.cache_path("GET", "https://example.org/a").read_bytes() == b"tresc"


def test_post_cache_key_includes_form_data(tmp_path):
    def handler(request):
        return httpx.Response(200, content=request.content)

    fetcher, _ = make_fetcher(tmp_path, handler)
    first = fetcher.post("https://example.org/p", {"imageId": "1", "pathId": "0"})
    second = fetcher.post("https://example.org/p", {"imageId": "2", "pathId": "0"})
    assert first != second
    assert b"imageId=1" in first


def test_delay_between_network_requests_only(tmp_path):
    fetcher, sleeps = make_fetcher(tmp_path, lambda r: httpx.Response(200, content=b"x"), delay=1.5)
    fetcher.get("https://example.org/1")
    fetcher.get("https://example.org/2")
    fetcher.get("https://example.org/1")  # z cache, bez czekania
    assert sleeps == [1.5]


def test_retries_server_errors_then_succeeds(tmp_path):
    responses = iter([httpx.Response(503), httpx.Response(200, content=b"ok")])
    fetcher, sleeps = make_fetcher(tmp_path, lambda r: next(responses), delay=1.0)
    assert fetcher.get("https://example.org/a") == b"ok"
    assert sleeps == [2.0]


def test_gives_up_after_retries(tmp_path):
    def handler(request):
        raise httpx.ConnectError("brak sieci")

    fetcher, _ = make_fetcher(tmp_path, handler, retries=3, delay=0)
    with pytest.raises(FetchError):
        fetcher.get("https://example.org/a")
    assert not fetcher.cache_path("GET", "https://example.org/a").exists()


def test_client_error_is_not_retried_or_cached(tmp_path):
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(404)

    fetcher, _ = make_fetcher(tmp_path, handler)
    with pytest.raises(FetchError, match="404"):
        fetcher.get("https://example.org/brak")
    assert len(calls) == 1


def test_offline_mode_raises_cache_miss(tmp_path):
    fetcher, _ = make_fetcher(tmp_path, lambda r: httpx.Response(200), offline=True)
    with pytest.raises(CacheMiss):
        fetcher.get("https://example.org/a")


def test_retries_too_many_requests_then_succeeds(tmp_path):
    responses = iter([httpx.Response(429), httpx.Response(408), httpx.Response(200, content=b"ok")])
    fetcher, sleeps = make_fetcher(tmp_path, lambda r: next(responses), delay=1.0)
    assert fetcher.get("https://example.org/a") == b"ok"
    assert sleeps == [2.0, 4.0]


def test_retry_after_header_is_respected(tmp_path):
    responses = iter([httpx.Response(429, headers={"Retry-After": "7"}), httpx.Response(200, content=b"ok")])
    fetcher, sleeps = make_fetcher(tmp_path, lambda r: next(responses), delay=1.0)
    assert fetcher.get("https://example.org/a") == b"ok"
    assert 7 in sleeps


def test_retry_after_shorter_than_backoff_uses_backoff(tmp_path):
    responses = iter([httpx.Response(503, headers={"Retry-After": "1"}), httpx.Response(200, content=b"ok")])
    fetcher, sleeps = make_fetcher(tmp_path, lambda r: next(responses), delay=1.5)
    assert fetcher.get("https://example.org/a") == b"ok"
    assert sleeps == [3.0]


def test_forget_drops_cached_response(tmp_path):
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(200, content=b"x")

    fetcher, _ = make_fetcher(tmp_path, handler)
    data = {"imageId": "46", "pathId": "0"}
    fetcher.post("https://example.org/p", data)
    fetcher.forget("POST", "https://example.org/p", data)
    assert not fetcher.cache_path("POST", "https://example.org/p", data).exists()
    fetcher.forget("POST", "https://example.org/p", data)  # brak pliku to nie błąd
    fetcher.post("https://example.org/p", data)
    assert len(calls) == 2


def test_cache_write_leaves_no_partial_files(tmp_path):
    fetcher, _ = make_fetcher(tmp_path, lambda r: httpx.Response(200, content=b"x"))
    fetcher.get("https://example.org/a")
    assert [p for p in tmp_path.rglob("*") if p.is_file()] == [fetcher.cache_path("GET", "https://example.org/a")]
