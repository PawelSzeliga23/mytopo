"""Polish (Kraków) climbing grades: normalisation, sort keys, bands and French equivalents."""

import re
from bisect import bisect_right

_BASES = ["I", "II", "III", "IV", "V", "VI"] + [f"VI.{n}" for n in range(1, 10)]
_INDEX = {base: i for i, base in enumerate(_BASES)}
_SINGLE = re.compile(r"^(VI\.[1-9]|VI|V|IV|III|II|I)([+-]?)$")
_WHITESPACE = re.compile(r"\s+")
_STEP = 20
_MODIFIER = {"": 0, "+": 6, "-": -6}
_DASHES = ("‐", "‑", "‒", "–", "—", "−")

# Upper-exclusive limits of bands 0..2: VI-, VI.2, VI.5
BAND_LIMITS: tuple[int, int, int] = (94, 140, 200)

_FRENCH = {
    "I": "1", "II": "2", "III": "3", "III+": "3+", "IV": "4a", "IV+": "4b",
    "V-": "4c", "V": "5a", "V+": "5b", "VI-": "5c", "VI": "6a", "VI+": "6a+",
    "VI.1": "6b", "VI.1+": "6b+", "VI.2": "6c", "VI.2+": "6c+",
    "VI.3": "7a", "VI.3+": "7a+", "VI.4": "7b", "VI.4+": "7b+",
    "VI.5": "7c", "VI.5+": "7c+", "VI.6": "8a", "VI.6+": "8a+",
    "VI.7": "8b", "VI.7+": "8b+", "VI.8": "8c", "VI.8+": "8c+", "VI.9": "9a",
}


def normalize_grade(raw: str) -> str:
    # \s on str also matches NBSP and tabs, common in scraped pages
    grade = _WHITESPACE.sub("", raw).upper()
    for dash in _DASHES:
        grade = grade.replace(dash, "-")
    return grade.replace(",", ".")


def _split(grade: str) -> tuple[str, str | None]:
    if "/" not in grade:
        return grade, None
    left, right = grade.split("/", 1)
    if right[:1].isdigit():
        right = f"VI.{right}"
    return left, right


def _single_sort(grade: str) -> int | None:
    match = _SINGLE.match(grade)
    if match is None:
        return None
    base, modifier = match.groups()
    return _INDEX[base] * _STEP + _MODIFIER[modifier]


def grade_sort(raw: str | None) -> int | None:
    if not raw:
        return None
    left, right = _split(normalize_grade(raw))
    low = _single_sort(left)
    if low is None:
        return None
    if right is None:
        return low
    high = _single_sort(right)
    if high is None or high <= low:
        return None
    return (low + high) // 2


def grade_band(sort: int | None) -> int | None:
    if sort is None:
        return None
    return bisect_right(BAND_LIMITS, sort)


def to_french(raw: str | None) -> str | None:
    if not raw:
        return None
    left, right = _split(normalize_grade(raw))
    french_left = _FRENCH.get(left)
    if french_left is None:
        return None
    if right is None:
        return french_left
    if grade_sort(raw) is None:  # a range that goes down (VI.2/1) is as unreadable here as in grade_sort
        return None
    french_right = _FRENCH.get(right)
    return f"{french_left}/{french_right}" if french_right else None
