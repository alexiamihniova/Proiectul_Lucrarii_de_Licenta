# ADR-0008: Ștergere logică și stările documentului impuse în baza de date

Stare: Acceptat · Data: 2026-11-12

## Context

Dosarul definește cinci stări ale documentului (În coadă, În analiză, Gata, Eroare, Șters) și
șase evenimente (PP, PR, PE, RP, RD, ȘT). Din tabelul de stări au rezultat trei situații
neprevăzute: ștergere în timpul analizei (C-08), reprocesare cerută în timpul analizei (C-09) și
rezultat sosit după eroare (C-10). Contorul zilnic de încărcări (C-07) trebuie să numere și
documentele șterse în aceeași zi, altfel limita se ocolește prin ștergere.

## Decizie

- **Ștergere logică**: `status = 'deleted'` și `deleted_at`. Rândul rămâne; pasajele (și, în
  cascadă, legăturile cu conceptele și materialele) și fișierul se șterg fizic de către serviciu.
- **Tranzițiile sunt impuse de un trigger** (`documents_enforce_status_transition`): un document
  nou este obligatoriu `queued`; sunt permise doar tranzițiile din tabel; un rând `deleted` nu
  mai poate fi modificat.
- Aceeași tabelă există ca date în `modules/documents/state-machine.ts`, pentru a alege
  răspunsul corect către utilizator (de exemplu `DOCUMENT_ALREADY_PROCESSING`).
- Testele compară, celulă cu celulă, tabelul din Dosar cu ambele implementări.

## Alternative respinse

- **Ștergere fizică a documentului**. Contorul zilnic ar fi scăzut la ștergere, iar un rezultat
  tardiv ar fi găsit „nimic” în loc de un rând care îl respinge explicit.
- **Tranziții verificate doar în cod**. O interogare greșită dintr-un segment viitor (de exemplu
  `UPDATE … SET status = 'ready'` fără condiție asupra stării curente) ar fi readus la viață un
  document șters. C-08 și C-10 au prioritate „Înaltă”.
- **Doar constrângeri `CHECK`**. Un `CHECK` vede doar rândul nou, nu și starea anterioară.
- **Coloană `deleted_at` fără stare „Șters”**. Ar fi contrazis diagrama de stări, în care „Șters”
  este o stare.

## Consecințe

- Rezultatele tardive sunt inofensive prin construcție.
- Toate interogările de listare trebuie să excludă `status = 'deleted'`; API-ul nu întoarce
  niciodată această stare (enumerarea publică are patru valori).
- Ștergerea materiei și a contului rămân fizice, în cascadă (RF3, RF20), deci elimină și
  rândurile șterse logic (Q12).
- Triggerul este SQL scris de mână, în afara schemei Drizzle; o schimbare a tabelului de stări
  cere o migrare scrisă de mână și actualizarea testelor.
