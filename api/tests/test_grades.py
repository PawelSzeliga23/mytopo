import pytest

from topo.grades import BAND_LIMITS, grade_band, grade_sort, normalize_grade, to_french

ORDERED = [
    "I", "II", "III", "III+", "IV-", "IV", "IV+", "V-", "V", "V+",
    "VI-", "VI", "VI+", "VI+/1", "VI.1-", "VI.1", "VI.1/1+", "VI.1+", "VI.1+/2",
    "VI.2", "VI.2+", "VI.3", "VI.4+/5", "VI.5", "VI.5+/6", "VI.6", "VI.8", "VI.9",
]


def test_grade_sort_is_strictly_increasing():
    values = [grade_sort(g) for g in ORDERED]
    assert None not in values
    assert values == sorted(values)
    assert len(set(values)) == len(values)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (" vi.1+ ", "VI.1+"),
        ("VI,2", "VI.2"),
        ("VI.1 + / 2", "VI.1+/2"),
        ("V–", "V-"),
    ],
)
def test_normalize_grade(raw, expected):
    assert normalize_grade(raw) == expected


def test_messy_input_sorts_like_clean_input():
    assert grade_sort(" vi.1 + / 2 ") == grade_sort("VI.1+/2")


@pytest.mark.parametrize("raw", [None, "", "6a", "A0", "VI.10", "VII", "VI/V", "abc"])
def test_unknown_grades_return_none(raw):
    assert grade_sort(raw) is None


def test_band_limits_match_grades():
    assert BAND_LIMITS == (grade_sort("VI-"), grade_sort("VI.2"), grade_sort("VI.5"))


@pytest.mark.parametrize(
    ("grade", "band"),
    [("V+", 0), ("VI-", 1), ("VI.1+/2", 1), ("VI.2", 2), ("VI.4+/5", 2), ("VI.5", 3), ("6a", None)],
)
def test_grade_band(grade, band):
    assert grade_band(grade_sort(grade)) == band


@pytest.mark.parametrize(
    ("grade", "french"),
    [("III", "3"), ("V", "5a"), ("VI.1+", "6b+"), ("VI.3", "7a"), ("VI.1+/2", "6b+/6c"), ("VI.2/1", None), ("6a", None), (None, None)],
)
def test_to_french(grade, french):
    assert to_french(grade) == french


def test_normalize_grade_strips_scraped_whitespace():
    assert normalize_grade("\tV+ ") == "V+"
    assert grade_sort("VI.1\xa0+") == grade_sort("VI.1+")
