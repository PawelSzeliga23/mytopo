# Pomysły na kolejne plany

## Globalny filtr: drogi sportowe / tradowe (od użytkownika, 2026-10-11)

Filtr działający w całej aplikacji, który odróżnia drogi tradowe od sportowych.

- **Definicja (od użytkownika):** droga tradowa = bez punktów asekuracyjnych. Do ustalenia, które typy punktów `line_point.kind` są asekuracyjne (`ring`, `hak`, a `ucho`?; `stanowisko`, `ogranicznik`, `przelot`, `start` raczej nie) i co z drogami bez linii na topo (trzecia grupa „nieznane”?). Pole `route.protection` (tekst z importu) może pomóc albo nadpisywać wynik.
- **Do ustalenia, gdzie żyje przełącznik:** pasek mapy obok wyszukiwarki, zapamiętany w przeglądarce, ważny na wszystkich stronach.
- **Zakres (dlatego osobny plan):**
  - API: rodzaj drogi liczony z punktów (kolumna wyliczana/odświeżana przy zapisie topo i imporcie albo widok), filtr w `/api/search`, liczby dróg i pasma wycen per skała/sektor/region w `/api/map/*` liczone osobno dla każdego rodzaju.
  - Mapa: liczba dróg, `GradeBar`, zakres wycen, ukrywanie skał bez dróg danego rodzaju.
  - Strona skały i obszaru: lista dróg, wygaszanie linii na topo 2D/2.5D.
  - Wyszukiwarka: filtr rodzaju obok wyceny.
