# Testele materiilor și documentelor (Segmentele 2A și 2B)

Specificația executabilă a Segmentului 2 este în `backend/tests/documents/`: 14 fișiere, 297 de
teste: 262 scrise în 2A și 35 adăugate în 2B pentru ce specificația atinge doar prin fișiere întregi
(`docx-and-layout`, `pdf-page-counter`, `pdf-reader-process`). Ele descriu comportarea definită în
`docs/design/documents.md`; 2B a implementat-o fără să modifice vreun test din 2A. Tabelele de mai jos leagă fiecare grup de cazuri de cerința
din SRS sau din Dosar.

## Cum se rulează

```sh
make test                                              # toate testele, inclusiv cele din tests/documents/
npm --prefix backend test -- tests/documents/upload.test.ts
```

Din Segmentul 2B (26.11.2026) testele trec și fac parte din `make test` și din jobul `backend` din CI. Jobul
`documents-spec` rulează doar `tests/documents/`, ca verificare de sine stătătoare; nu mai este
neblocant. Până la 2B ele picau contra rutelor `501` și erau ținute separat.

## Cum au fost verificate

În 2A, pe o implementare de probă, scrisă separat și păstrată în afara repo-ului; în 2B, pe
implementarea reală: toate cele 297 trec. Implementarea de probă a descoperit patru greșeli de-ale
testelor în 2A, corectate înainte de commit:

- un student făcea peste 10 încărcări într-un fișier și lovea limita zilnică (acum limita
  implicită de test este 50, iar setările modificate se șterg la sfârșit, nu se „restaurează”);
- o așteptare greșită pentru numărul de pagini al unui fișier TXT/DOCX de 3300 de caractere;
- un text „peste 2 pagini” care avea de fapt 5750 de caractere, deci 2 pagini (Q16): acum are
  peste 7600 de caractere;
- baza de date refuză orice modificare a unui rând șters (trigger), deci „îmbătrânirea” unui
  document șters în test cere oprirea triggerului pe durata unei instrucțiuni
  (`backdateDeletedDocument`).

În 2B, rularea pe implementarea reală a trecut din prima; singurele erori de test găsite au fost în
testele noi de 2B (geometrie în `docx-and-layout`, momentul în care se construiește „bomba” în
`pdf-reader-process`).

## Ajutoare

| Fișier                          | Ce oferă                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `helpers/documents-app.ts`      | aplicația cu director de încărcări temporar și analiză falsă controlabilă (`failWith`, `hang`, `release`); `upload`, `readyDocument`, `processQueue`, `setSetting` |
| `helpers/fixtures.ts`           | fișiere construite în memorie: PDF, DOCX, TXT, ZIP, `multipart`; text determinist |
| `helpers/structure.ts`          | `expectValidStructure`: invariantele din designul 3.2 și 3.5, rulate pe orice structură |

## Trasabilitate

### `subjects.test.ts` (22)

| Caz                                                                                   | Cerință            |
| ------------------------------------------------------------------------------------- | ------------------ |
| Creare, nume 1–100, tăiat la capete, refuz gol/prea lung                              | RF3                |
| Același nume, în orice scriere cu majuscule: 409; alt student poate avea numele       | RF3, Q17           |
| Citire, listare alfabetică fără majuscule, paginare, numărători                       | RF3, UC-04         |
| Redenumire: același nume permis, nume ocupat 409, 404                                 | RF3                |
| Ștergere în cascadă: documente, pasaje, propoziții, concepte, materiale, teste, răspunsuri, progres, recapitulări | RF3 |
| Alt student: 404 la citire, redenumire, ștergere                                       | RNF7               |

### `upload.test.ts` (34) și `upload-quota.test.ts` (13)

| Caz                                                                                   | Cerință            |
| ------------------------------------------------------------------------------------- | ------------------ |
| Încărcare validă PDF, DOCX, TXT: 201, `queued`, octeții păstrați                     | RF3, EV1           |
| Format neacceptat, conținut care nu corespunde extensiei: 415 cu formatele permise    | RF3, M04, C-03     |
| Dimensiune peste limită: 413 cu limitele; exact limita acceptată; limită schimbată se aplică imediat | RF3, M05, RF25 |
| Numele fișierului: doar ultima componentă, tăiat la 255, fără efect pe disc            | design 2.3         |
| Fișier gol, parte lipsă, cerere fără multipart: 400; respingerea nu lasă rând sau fișier | design 2.1      |
| Limita zilnică: 429 cu limita și ora resetării; fișierele respinse nu consumă; ștergerea nu dă înapoi | M08, C-07, P6 |
| Resetarea la 00:00 Chișinău; `resets_at` este miezul nopții local                      | C-07               |
| Încărcări simultane: exact limita reușește                                             | design 2.4         |

### `text-structure.test.ts` (57), `extraction.test.ts` (20), `passages.test.ts` (15)

| Caz                                                                                   | Cerință            |
| ------------------------------------------------------------------------------------- | ------------------ |
| Invariantele textului structurat pe texte de forme diferite                           | RF4, ADR-0013      |
| Curățare: spații, NUL, cratimă, rânduri unite, antete și subsoluri repetate, numere de pagină | RF4          |
| Propoziții: terminatori, abrevieri, inițiale, numere, titluri, propoziții de peste 300 de cuvinte | design 3.4 |
| Pasaje de 100–300 de cuvinte, la granițe de paragraf, coadă unită                      | RF4                |
| Pagini reale (PDF) și aproximative (DOCX, TXT, 3000 de caractere); limita de 100       | RF3, RF4, Q16, Q48 |
| Sub 200 de caractere: `TEXT_NOT_EXTRACTABLE`                                           | RF4, M06           |
| TXT UTF-8, UTF-16, Windows-1250; DOCX; PDF cu pagini; fișiere corupte                  | RF4, design 3.7    |
| Lista pasajelor, filtrul de pagină, `DOCUMENT_NOT_READY`; funcțiile pentru alte module | RF4, RF5, UC-17    |
| Fiecare propoziție este citat valid al pasajului ei                                    | RB1                |

### `pdf-page-limit.test.ts` (19)

| Caz                                                                                   | Cerință            |
| ------------------------------------------------------------------------------------- | ------------------ |
| PDF peste limită respins la încărcare: 413, `exceeded = pages`, cu numărul găsit; fără rând, fără fișier, fără consum din limita zilnică | Q48 |
| Pagini fără text numărate; exact limita acceptată; urmărește `UPLOAD_MAX_PAGES`        | Q48                |
| DOCX și TXT nu se numără la încărcare; analiza decide                                  | Q48, Q16           |
| PDF corupt, tăiat sau protejat cu parolă: acceptat; `TEXT_NOT_EXTRACTABLE` la analiză  | Q48, M06           |
| `timeout` și `memory`: refuzat ca „prea complex” (413, `exceeded = complexity`, `reason`), fără urme | Q48        |
| Numărătorul primește octeții și limitele din configurare; este chemat numai pentru PDF, după format și dimensiune, înainte de limita zilnică | design 2.5 |
| Un numărător defect nu blochează încărcarea; eroarea se jurnalizează fără numele fișierului | design 2.5    |

### `processing.test.ts` (32), `documents.test.ts` (25), `worker-tasks.test.ts` (4)

| Caz                                                                                   | Cerință            |
| ------------------------------------------------------------------------------------- | ------------------ |
| `queued → processing → ready`; ordinea; doi workeri nu iau același document            | Dosar T3.1, ADR-0003 |
| Starea nu se pune în cache (interogare periodică)                                      | C-02, Q13          |
| Eșecuri cu motivul: M06, M05 (TXT la analiză; PDF ca plasă de siguranță), M07, `INTERNAL_ERROR`; textul rămâne după eșecul analizei | RF4              |
| Limita de 60 s; `failStuckDocuments`                                                   | T2, PE             |
| Ștergere în timpul analizei: rezultatul tardiv este ignorat                            | C-08               |
| Reprocesare din `ready`/`error`; din `queued`/`processing`: 409; fără reextragere      | RF6, C-09, Q47     |
| Rezultat dinaintea reprocesării nu închide analiza nouă                                | C-10               |
| Listare, filtre, paginare; redenumire în orice stare; ștergere în orice stare           | RF6                |
| Fișierul original: tip, octeți, antete de siguranță, nume                              | RF5                |
| Cele patru sarcini ale workerului                                                      | design 9           |

### `docx-and-layout.test.ts` (17), `pdf-page-counter.test.ts` (9), `pdf-reader-process.test.ts` (9)

| Caz                                                                                   | Cerință            |
| ------------------------------------------------------------------------------------- | ------------------ |
| DOCX împachetat cum îl scrie Word (intrări comprimate), tabele, tab-uri, entități      | RF4, design 3.7    |
| Limita de despachetare a DOCX; arhive cu directorul central stricat                    | design 3.7         |
| Așezarea textului unui PDF: rânduri, paragrafe, două coloane, titlu peste coloane       | RF4, design 3.7    |
| Numărătorul real: pagini, `unreadable`, `timeout`, `memory` fără oprirea aplicației, cel mult 4 simultan | Q48 |
| Citirea PDF într-un proces copil: oprire prin semnal, bombă de conținut care nu blochează bucla de evenimente, depășire de heap | Q48, design 3.7 |

### `file-store.test.ts` (21)

| Caz                                                                                   | Cerință            |
| ------------------------------------------------------------------------------------- | ------------------ |
| Cale din identificatori; numele utilizatorului nu ajunge pe disc                       | design 8           |
| Ștergerea documentului și a materiei șterge fișierele; fișier lipsă nu strică ștergerea | RF3, RF6        |
| **Ștergerea contului șterge fișierele studentului și ale nimănui altcuiva**            | **RF20, Q43**      |
| Ștergerea de către administrator; `deleteAllForUser` idempotent, refuză id invalid     | RF21, Q43          |
| Fișiere orfane și directoare ale utilizatorilor dispăruți                              | design 8           |
| Rândurile șterse logic se elimină după 48 de ore, configurabil                         | Q12                |

## Ce testele nu acoperă

- **Citirea reală a unui PDF cu fonturi neobișnuite, scanat sau cu coloane.** Fixture-urile sunt
  PDF-uri minimale, cu text ASCII; ordinea de citire pe pagini cu mai multe coloane nu e verificată.
- **Calitatea împărțirii în propoziții pe text real.** Regulile din 3.4 sunt verificate pe cazuri
  alese; precizia pe un curs real se judecă la 2B, pe documente reale ale autoarei.
- **Măsurătorile din Q48** (timpi și memorie pe PDF-uri reale) nu sunt teste: variază cu mașina.
  Testele verifică mecanismul (timeout, memorie, oprire), nu valorile.
- **Memoria din afara heap-ului** a procesului copil nu este limitată și nu este testată (Q48).
- **Oprirea efectivă a unei extrageri în curs** la depășirea timpului: se verifică semnalul și
  starea finală, nu că firul de execuție s-a oprit.
- **Eșecul scrierii pe disc** (disc plin, permisiuni) nu este simulat.
- **Ora de vară**: `resets_at` este verificat doar ca miez de noapte local, nu la ziua schimbării orei.
