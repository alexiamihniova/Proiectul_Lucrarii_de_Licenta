# ADR-0013: Textul documentului se păstrează structurat, cu propoziția ca unitate

Stare: Acceptat (confirmat la 23.11.2026, Q46) · Data: 2026-11-16 · Se implementează în Segmentul 2B

## Context

RF4 cere pasaje de 100–300 de cuvinte, cu identificator, pagină și poziție. SRS 3.1.3 și RF9
leagă orice concept și material de un pasaj și, opțional, de un citat din el. Autoarea cere în
plus ca textul extras să fie păstrat structurat — pagini, paragrafe, propoziții, cu pozițiile
lor — fiindcă de el depind citatele și orice metodă de generare, iar ADR-0012 nu presupune una
singură. Schema Segmentului 0 are doar `passages`, cu text și două poziții într-un „text
curățat” care nu este stocat nicăieri.

## Decizie

- Un tabel nou, `sentences` (PROPOZIȚIE): câte un rând pe propoziție, cu ordinea în document,
  numărul paragrafului, pagina, pozițiile în textul canonic, textul și pasajul din care face
  parte. Este al 17-lea tabel.
- Paragraful și pagina sunt coloane ale propoziției, nu tabele: nu au atribute proprii.
- Un pasaj este un șir de propoziții întregi. PASAJ rămâne unitatea din SRS: cu el lucrează
  modelul, verificarea surselor și interfața.
- Textul canonic (propozițiile unui paragraf unite cu un spațiu, paragrafele cu `"\n\n"`) nu se
  stochează; se reconstituie exact din propoziții. Toate pozițiile sunt indici în el.
- Invariantele sunt în `docs/design/documents.md`, 3.2, și sunt verificate de teste pe fiecare
  document procesat.

## Alternative respinse

- **Un singur șir de text pe document.** Este exact ce cerința exclude: paragrafele și
  propozițiile s-ar recalcula la fiecare folosire, eventual diferit.
- **O coloană JSONB pe `passages`** cu propozițiile pasajului. Păstrează cele 16 tabele, dar
  propozițiile nu pot fi interogate, numărate sau referite individual, iar invariantele nu pot
  fi impuse de baza de date.
- **Tabele separate pentru pagini și paragrafe.** Trei tabele în plus pentru două numere de
  ordine.
- **Stocarea și a textului canonic.** Ar exista două surse pentru același text.

## Consecințe

- Orice propoziție este un citat valid al pasajului ei (subșir exact), deci o metodă de
  generare care alege propoziții trece verificarea surselor prin construcție.
- Un document de 100 de pagini are câteva mii de rânduri în `sentences`; se inserează într-o
  singură tranzacție, o singură dată (reprocesarea nu reextrage textul, Q47).
- `docs/DATA_MODEL.md` și testul care numără tabelele se actualizează în Segmentul 2B.
- Textul apare de două ori: în `passages.text` și în `sentences.text`. Este acceptat: pasajul
  este citit mult mai des decât propozițiile, iar invarianta 1 le ține egale.
