# Poprawki odłożone w planach 1–8

Zbiorcza poprawka drobiazgów z sekcji „Wnioski z wykonania” planów 1–8 (gałąź `poprawki-z-planow`). Wykonanie inline, bez spec — każda poprawka jest mała i niezależna.

## Zrobione

- **Wyszukiwarka:** indeksy trigramowe na nazwach (migracja `0009`, funkcja `search_key` = `unaccent(lower(...))` oznaczona jako IMMUTABLE); ściany nazwane tak samo jak skała nie pojawiają się w podpowiedziach.
- **Pasek górny na telefonie:** „Edytuj” jako sama ikona ✎ poniżej `sm` i mniejsze odstępy — pole wyszukiwania szersze.
- **Cofanie:** okno konfliktu pokazuje nazwy obszarów zamiast numerów; równoczesne cofnięcia czekają na siebie (`pg_advisory_xact_lock`) zamiast kończyć się błędem 500.
- **Logowanie:** ukryte pole nazwy użytkownika dla menedżerów haseł; ogranicznik prób zapomina nieaktywne adresy (powyżej 1000 kluczy).
- **Głębia:** błąd segmentacji po udanej głębi oznacza ścianę jako „nieudaną” — pojawia się „Ponów”.
- **Edytor 2.5D:** zapis modelu odrzucany (`409 photo_changed`), gdy zdjęcie podmieniono w trakcie edycji; roślinność przeliczana z poprawionej segmentacji (także przy cofnięciu modelu); pędzle zachowują przybliżanie (kółko, dwa palce — drugi palec kończy pociągnięcie).
- **Nowa ściana:** po wyjściu z edytora strona skały pokazuje tę ścianę, nie pierwszą.
- **Formularze:** same spacje nie liczą się jako zmiana; pusta nazwa skały/obszaru blokowana w przeglądarce; skała bezpośrednio w obszarze ma w liście swój obecny obszar; panel drogi pyta przed porzuceniem zmian (Anuluj, Escape); błąd wyceny tylko przy polu (bez drugiego komunikatu); okno usuwania obszaru zamyka się po błędzie.
- **Strona skały:** „← Mapa” i logo to linki (otwieranie w nowej karcie); świeży stan przy przejściu na inną skałę/obszar (`key` = slug); usunięta droga przestaje być zaznaczona.
- **Mapa:** zaznaczona skała (nowy sektor) to obwódka wokół pinezki; ołówek obok nagłówka karty, nie w nim; osobne `Suspense` dla każdego leniwego okna (pasek sektora nie miga); przesuwanie skały kończy się komunikatem, gdy skała zniknie z danych; ponowiona próba dodania skały z nowym regionem zmienia nazwę utworzonego regionu zamiast tworzyć drugi.
- **Drobne:** skrypt motywu w `<head>`; brak ponawiania zapytań przy błędach 4xx (404 skały od razu); `GradeBar` rysuje tylko znane pasma; `to_french` odrzuca malejące przedziały; `--only-area` dopasowuje cały człon adresu; migracja `0003` w dół zamienia nieznane typy punktów na `przelot`.

## Pominięte (świadomie)

- Wymagające urządzenia lub decyzji: gesty na prawdziwym telefonie, klawiatura ekranowa, strefa najechania na linię w Konvie.
- Plan 9 (wdrożenie): obraz produkcyjny, nginx `client_max_body_size`, `--proxy-headers`, przebudowa obrazu `depth`.
- Pusta zmiana w historii po potwierdzeniu niezmienionego położenia skały (zachowanie zgodne z decyzją z planu 6); `depth_model` po przywróceniu z dysku; luki w testach wymienione w dzienniku planu 6.

## Do zrobienia — edytor 2.5D (od użytkownika, 2026-10-11)

1. **Kolory hologramu na zdjęciu.** Prototyp (`depth_preview_view.html`, plan 5a) umiał nałożyć kolory skały i podłoża na zdjęcie; w edytorze 2.5D tego brakuje — dodać podgląd „zdjęcie + kolory hologramu”.
2. **Pędzel „wygładź”.** „Spłaszcz” zostawia nierówności, a „Wygładź” działa dziś na cały model (przycisk). Potrzebny pędzel wygładzający tylko pod kursorem, jeden krok cofania na pociągnięcie, jak pozostałe pędzle.
