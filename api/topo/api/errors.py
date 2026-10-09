import logging
from typing import NoReturn

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

_HTTP_MESSAGES = {405: "Niedozwolona metoda"}


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def not_found(what: str) -> ApiError:
    return ApiError(404, "not_found", f"Nie znaleziono: {what}")


def raise_not_found(what: str) -> NoReturn:
    raise not_found(what)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse({"code": exc.code, "message": exc.message}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def handle_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            {
                "code": "validation_error",
                "message": "Nieprawidłowe dane w zapytaniu",
                "details": jsonable_encoder(exc.errors()),
            },
            status_code=422,
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 404:
            return JSONResponse({"code": "not_found", "message": "Nie znaleziono"}, status_code=404)
        return JSONResponse(
            {"code": "http_error", "message": _HTTP_MESSAGES.get(exc.status_code, "Błąd żądania")},
            status_code=exc.status_code,
            headers=exc.headers,
        )

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
        return JSONResponse({"code": "internal_error", "message": "Wewnętrzny błąd serwera"}, status_code=500)
