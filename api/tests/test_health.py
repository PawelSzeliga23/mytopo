from fastapi.testclient import TestClient

from topo.api.app import create_app


def test_health_returns_ok():
    client = TestClient(create_app())
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_method_not_allowed_uses_error_format():
    client = TestClient(create_app())
    response = client.post("/api/health")
    assert response.status_code == 405
    assert response.json() == {"code": "http_error", "message": "Niedozwolona metoda"}
    assert response.headers["allow"] == "GET"


def test_unhandled_exception_returns_internal_error():
    app = create_app()

    @app.get("/api/boom")
    def boom() -> None:
        raise RuntimeError("boom")

    client = TestClient(app, raise_server_exceptions=False)
    response = client.get("/api/boom")
    assert response.status_code == 500
    assert response.json() == {"code": "internal_error", "message": "Wewnętrzny błąd serwera"}
