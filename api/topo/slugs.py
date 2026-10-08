from slugify import slugify


def make_slug(text: str) -> str:
    return slugify(text, max_length=200) or "bez-nazwy"
