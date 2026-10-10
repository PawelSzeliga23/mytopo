import hashlib
import hmac
import time
from collections import defaultdict, deque

from itsdangerous import BadSignature, URLSafeTimedSerializer

from topo.api.errors import ApiError
from topo.config import Settings

COOKIE = "topo_edit"
MAX_AGE = 365 * 24 * 3600


def password_fingerprint(password: str, secret: str) -> str:
    return hmac.new(secret.encode(), password.encode(), hashlib.sha256).hexdigest()[:16]


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.secret_key, salt="topo-edit")


def make_token(nick: str, settings: Settings) -> str:
    return _serializer(settings).dumps(
        {"nick": nick, "pw": password_fingerprint(settings.edit_password, settings.secret_key)}
    )


def read_token(token: str | None, settings: Settings) -> str | None:
    if not token or not settings.edit_password or not settings.secret_key:
        return None
    try:
        data = _serializer(settings).loads(token, max_age=MAX_AGE)
    except BadSignature:
        return None
    expected = password_fingerprint(settings.edit_password, settings.secret_key)
    if not isinstance(data, dict) or not hmac.compare_digest(str(data.get("pw", "")), expected):
        return None
    return data.get("nick")


def clean_nick(raw: str) -> str:
    nick = raw.strip()
    if not 2 <= len(nick) <= 40:
        raise ApiError(422, "invalid_nick", "Nick musi mieć od 2 do 40 znaków")
    if nick.startswith("import:"):
        raise ApiError(422, "invalid_nick", "Nick nie może zaczynać się od „import:”")
    return nick


class LoginLimiter:
    MAX_KEYS = 1000

    def __init__(self, limit: int = 5, window: float = 60.0):
        self.limit, self.window = limit, window
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def hit(self, key: str, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        hits = self._hits[key]
        while hits and now - hits[0] >= self.window:
            hits.popleft()
        hits.append(now)
        if len(self._hits) > self.MAX_KEYS:  # forget addresses that stopped trying
            for stale in [k for k, v in self._hits.items() if now - v[-1] >= self.window]:
                del self._hits[stale]
        return len(hits) <= self.limit

    def clear(self) -> None:
        self._hits.clear()


login_limiter = LoginLimiter()
