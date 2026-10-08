from topo.slugs import make_slug


def test_make_slug_transliterates_polish():
    assert make_slug("Żabi Koń") == "zabi-kon"
    assert make_slug("Łysa Skała – Ściana Północna") == "lysa-skala-sciana-polnocna"


def test_make_slug_never_empty():
    assert make_slug("!!!") == "bez-nazwy"
