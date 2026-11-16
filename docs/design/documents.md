# Proiectarea modulului de materii și documente (Segmentul 2)

Acoperă RF3–RF6, C-02, C-03, C-07–C-10, UC-04, tabelul de stări al documentului (Dosar, Tabelul
3.1) și obligația din Segmentul 1 de a șterge fișierele unui cont (Q43). Segmentul 2A (acest
document, testele din `backend/tests/documents/` și interfețele din
`modules/documents/types.ts`) fixează comportarea; Segmentul 2B o implementează fără să o
reinterpreteze. Lista de lucru pentru 2B este în secțiunea 11.

Marcaje: **[SRS]** = valoare luată din specificații; **[propus]** = valoare propusă aici, cu
întrebarea din `docs/OPEN_QUESTIONS.md` unde se poate schimba.

## 0. Valori

| Valoare                               | Mărime                                  | Sursă            | Configurare                       |
| ------------------------------------- | --------------------------------------- | ---------------- | --------------------------------- |
| Numele materiei                       | 1–100 de caractere, unic pentru student | [SRS] RF3        | fix                               |
| Unicitatea numelui                    | fără majuscule, fără spații la capete   | [propus] Q17     | fix                               |
| Formate acceptate                     | PDF, DOCX, TXT                          | [SRS] RF3        | fix                               |
| Dimensiunea maximă a fișierului       | 20 MB                                   | [SRS] RF3, P3    | CONFIGURARE `max_file_size_mb` (1–50) |
| Limita tehnică a încărcării           | 50 MB                                   | [SRS] P3         | `UPLOAD_HARD_LIMIT_MB`            |
| Numărul maxim de pagini               | 100                                     | [SRS] RF3, P4    | `UPLOAD_MAX_PAGES`                |
| O „pagină” pentru DOCX și TXT         | 3000 de caractere de text curățat       | [propus] Q16     | fix                               |
| Încărcări pe zi                       | 10, resetate la 00:00 ora Chișinăului   | [SRS] P6, C-07   | CONFIGURARE `uploads_per_day` (1–50), `APP_TIMEZONE` |
| Lungimea unui pasaj                   | 100–300 de cuvinte                      | [SRS] RF4        | fix                               |
| Text minim                            | 200 de caractere                        | [SRS] RF4, M06   | fix                               |
| Limita de timp a analizei             | 60 s                                    | [SRS] T2, PE     | `DOCUMENT_PROCESSING_TIMEOUT_SECONDS` |
| Numele documentului                   | 1–255 de caractere                      | [propus]         | fix                               |
| Păstrarea rândurilor șterse logic     | 48 de ore                               | [propus] Q12     | `DELETED_DOCUMENT_RETENTION_HOURS` |
| Actualizarea stării în interfață      | interogare la cel mult 3 s              | [propus] Q13, C-02 | frontend                        |

## 1. Materii (RF3)

- Rutele `/subjects` sunt doar pentru rolul `student`. Fiecare interogare filtrează după
  `actor.userId`; materia altcuiva răspunde `404 NOT_FOUND`.
- Numele se curăță de spații la capete. Două nume care diferă doar prin majuscule sunt același
  nume (Q17): `409 SUBJECT_NAME_TAKEN` la creare și la redenumire. Redenumirea cu propriul nume,
  eventual cu alte majuscule, reușește. Alt student poate avea același nume.
- Lista este ordonată alfabetic, fără majuscule, apoi după `id`; este paginată.
- `Subject` conține trei numărători: `document_count` (fără documentele șterse),
  `concept_count` și `due_concept_count` (concepte cu `reviews.due_date` azi sau în trecut, în
  fusul orar al aplicației). Ultimele două citesc tabele ale Segmentelor 3 și 5 (Q50).
- Ștergerea (`DELETE /subjects/{id}`, după confirmarea M10 din interfață) elimină fizic materia
  și, în cascadă, documentele, pasajele, propozițiile, conceptele, materialele, testele,
  răspunsurile, progresul și recapitulările ei. Fișierele documentelor se șterg de pe disc după
  `COMMIT` (secțiunea 8). O analiză în curs pentru un document al materiei nu mai poate scrie
  nimic: rândul nu mai există (C-08).

## 2. Încărcarea (RF3, EV1, C-03, C-07)

`POST /subjects/{subject_id}/documents`, `multipart/form-data`, o singură parte, numită `file`.

### 2.1 Verificări, în ordine

| Nr. | Verificare                                                           | La eșec                                   |
| --- | -------------------------------------------------------------------- | ----------------------------------------- |
| 1   | Materia există și este a studentului                                 | `404 NOT_FOUND`                           |
| 2   | Cererea are partea `file`, cu nume de fișier și cel puțin un octet   | `400 VALIDATION_ERROR`, `path: body/file` |
| 3   | Extensia este `.pdf`, `.docx` sau `.txt` (fără majuscule)            | `415 UNSUPPORTED_FILE_FORMAT` (M04)       |
| 4   | Conținutul corespunde extensiei (2.2)                                | `415 UNSUPPORTED_FILE_FORMAT` (M04)       |
| 5   | Dimensiunea ≤ `max_file_size_mb`                                     | `413 FILE_TOO_LARGE` (M05)                |
| 6   | Încărcările de azi < `uploads_per_day`                               | `429 DAILY_UPLOAD_LIMIT_REACHED` (M08)    |

Formatul și dimensiunea se verifică înainte de salvare (RF3). Tipul `Content-Type` declarat de
browser nu se folosește: îl alege clientul. Un fișier respins nu consumă din limita zilnică și
nu lasă nimic pe disc sau în bază.

`details` spune limita încălcată, ca interfața să o afișeze o singură dată (C-03):

| Eroare                        | `details`                                                        |
| ----------------------------- | ---------------------------------------------------------------- |
| `UNSUPPORTED_FILE_FORMAT`     | `{ "allowed": ["pdf", "docx", "txt"] }`                          |
| `FILE_TOO_LARGE`              | `{ "exceeded": "size", "limit_mb": 20, "limit_pages": 100 }`     |
| `DAILY_UPLOAD_LIMIT_REACHED`  | `{ "limit": 10, "resets_at": "<ISO 8601>" }`                     |

Un fișier peste limita tehnică (`UPLOAD_HARD_LIMIT_MB`) primește tot `413 FILE_TOO_LARGE`.

### 2.2 Conținutul corespunde extensiei

| Format | Regulă                                                                                     |
| ------ | ------------------------------------------------------------------------------------------ |
| PDF    | secvența `%PDF-` apare în primii 1024 de octeți                                            |
| DOCX   | începe cu `PK\x03\x04` și arhiva conține intrarea `word/document.xml`                       |
| TXT    | nu conține octetul 0, cu excepția fișierelor care încep cu marcajul UTF-16 (`FF FE`, `FE FF`) |

Un `.doc` vechi, un `.pptx` sau un executabil redenumit primesc M04. Verificarea nu garantează
că fișierul se poate citi; asta se află la analiză (M06).

### 2.3 Reușita

`201`, cu `Document`: `status = "queued"`, `page_count = null`, `error = null`. `file_name` este
numele trimis, redus la ultima componentă a căii, fără caractere de control, tăiat la 255 de
caractere; nu se folosește niciodată ca nume de fișier pe disc (secțiunea 8). Două documente pot
avea același nume. Analiza pornește în fundal (secțiunea 4).

### 2.4 Limita zilnică (C-07)

- Se numără documentele studentului cu `uploaded_at` în ziua curentă din `APP_TIMEZONE`
  (Europe/Chisinau), **inclusiv cele șterse logic**: ștergerea unui document nu dă înapoi o
  încărcare. De aceea ștergerea documentului este logică (ADR-0008).
- Ștergerea unei materii șterge fizic documentele ei, deci și din numărătoare; ocolirea este
  acceptată (Q12). Reprocesarea nu se numără.
- Verificarea și inserarea sunt atomice per student (blocare consultativă pe tranzacție, cu
  cheia utilizatorului): din N + 1 încărcări simultane la limita N reușesc exact N.
- `GET /documents/upload-quota` → `{ limit, used, remaining, resets_at, max_file_size_mb,
  max_pages }`. `resets_at` este următoarea oră 00:00 din `APP_TIMEZONE`, în UTC; ține cont de
  ora de vară. `remaining = max(0, limit − used)`.
- Limitele se citesc din CONFIGURARE la fiecare cerere (RF25: o schimbare se aplică de la
  operația următoare). Citirea se face prin `getSettings` din modulul `admin` (Q49).

## 3. Textul structurat

Cerință de proiectare a autoarei: textul extras se păstrează **structurat** — pagini,
paragrafe, propoziții, cu pozițiile lor — nu ca un singur șir. De el depind citatele cu
identificator de pasaj din SRS 3.1.3 și orice metodă de generare (ADR-0012 nu presupune una
singură). Modelul este în ADR-0013.

### 3.1 Unitățile

| Unitate    | Ce este                                                      | Unde se păstrează                         |
| ---------- | ------------------------------------------------------------ | ----------------------------------------- |
| Propoziție | cea mai mică unitate; are text și poziție                    | tabel nou `sentences` (Q46)               |
| Paragraf   | șir de propoziții consecutive                                | `sentences.paragraph` (număr de ordine)   |
| Pagină     | pagina pe care începe propoziția                             | `sentences.page`, `passages.page`         |
| Pasaj      | PASAJ din SRS: 100–300 de cuvinte, șir de propoziții întregi | `passages` (existent)                     |
| Document   | `page_count`                                                 | `documents.page_count`                    |

Tabelul `sentences` (PROPOZIȚIE), creat de Segmentul 2B:

| Coloană        | Tip                              | Regulă                                               |
| -------------- | -------------------------------- | ---------------------------------------------------- |
| `id`           | BIGINT identity                  |                                                      |
| `document_id`  | → `documents`, `ON DELETE CASCADE` |                                                    |
| `passage_id`   | → `passages`, `ON DELETE CASCADE`  | pasajul care o conține                             |
| `position`     | INT ≥ 0                          | ordinea în document; unic cu `document_id`           |
| `paragraph`    | INT ≥ 0                          | numărul paragrafului în document                     |
| `page`         | INT ≥ 1                          | pagina pe care începe                                |
| `start_offset` | INT ≥ 0                          | în textul canonic                                    |
| `end_offset`   | INT > `start_offset`             |                                                      |
| `text`         | TEXT, nevid                      |                                                      |

### 3.2 Textul canonic și pozițiile

Textul canonic al unui document este: propozițiile unui paragraf unite printr-un spațiu,
paragrafele unite prin `"\n\n"`. Nu se stochează separat: se reconstituie exact din propoziții
(`getDocumentStructure` îl întoarce). Toate pozițiile (`start_offset`, `end_offset`, ale
propozițiilor și ale pasajelor) sunt indici în acest text, în unități UTF-16 (indicii unui șir
JavaScript), cu sfârșitul exclusiv.

Invariante, verificate de teste pe orice document procesat:

1. `text_canonic.slice(start, end) = text`, pentru fiecare propoziție și fiecare pasaj.
2. Propozițiile sunt în ordine, nu se suprapun, iar între două consecutive se află exact `" "`
   (același paragraf) sau `"\n\n"` (paragraf nou). Prima începe la 0, ultima se termină la
   lungimea textului.
3. Fiecare propoziție aparține exact unui pasaj; un pasaj este un șir de propoziții consecutive
   și începe și se termină pe granițe de propoziție. Pasajele acoperă toate propozițiile.
4. `position` începe de la 0 și nu are goluri, la propoziții și la pasaje. `paragraph` și `page`
   nu scad odată cu `position`.
5. `passages.page` este pagina primei propoziții a pasajului. `1 ≤ page ≤ page_count`.
6. Niciun text nu începe sau nu se termină cu spațiu și nu conține două spații la rând.

Consecință pentru RB1: orice propoziție este un citat valid al pasajului ei, fiindcă este un
subșir exact al textului pasajului.

### 3.3 Curățarea (RF4)

Extragerea produce pagini brute: text cu rânduri separate prin `\n` și paragrafe separate prin
rânduri goale. Curățarea, în ordine:

1. Se elimină caracterul NUL și cratima opțională (U+00AD); `\r\n` și `\r` devin `\n`; orice
   șir de spații (inclusiv tab și spațiu nedespărțitor) devine un spațiu; rândurile se curăță la
   capete.
2. **Antete și subsoluri repetate**, numai la documente cu pagini reale și cel puțin 3 pagini:
   dintre primele 2 și ultimele 2 rânduri nevide ale fiecărei pagini se elimină rândurile care
   sunt numere de pagină („12”, „Pagina 12”, „12 / 40”, „– 12 –”) și rândurile a căror cheie
   (text cu litere mici și cifrele înlocuite cu `#`) apare pe cel puțin `max(3, ⌈pagini / 2⌉)`
   pagini. Pe paginile scurte, marginile examinate nu depășesc o treime din rânduri.
3. Rândurile unui paragraf se unesc cu un spațiu. Dacă un rând se termină cu literă urmată de
   cratimă și următorul începe cu literă mică, se unesc fără spațiu, păstrând cratima
   („într-” + „o” → „într-o”). Nu se încearcă refacerea cuvintelor despărțite la capăt de rând.
4. Un paragraf continuă pe pagina următoare dacă ultimul paragraf al paginii nu se termină cu
   `. ! ? … : ;` (eventual urmate de ghilimele sau paranteze) și primul paragraf al paginii
   următoare începe cu literă mică.
5. Paragrafele fără nicio literă sau cifră se elimină.

Dacă textul canonic are sub 200 de caractere, documentul trece în „Eroare” cu
`TEXT_NOT_EXTRACTABLE` (M06: documente scanate).

### 3.4 Propozițiile

O propoziție se termină la sfârșitul paragrafului sau după `.`, `!`, `?` ori `…` (unul sau mai
multe, eventual urmate de `"`, `”`, `»`, `)`, `]`), dacă urmează spațiu și apoi o literă mare,
o cifră sau un semn de deschidere (`„`, `"`, `«`, `(`, `[`, `–`, `—`). Punctul **nu** încheie
propoziția:

- după o abreviere din listă (fără majuscule): `prof`, `dr`, `ing`, `conf`, `lect`, `acad`,
  `dl`, `dna`, `d-na`, `d-l`, `nr`, `art`, `alin`, `lit`, `pag`, `p`, `fig`, `tab`, `cap`,
  `vol`, `ed`, `ex`, `etc`, `cf`, `vs`, `aprox`, `str`, `tel`, `sec`, `min`, `max`, `ș.a`,
  `ș.a.m.d`, `a.m.d`, `d.e`, `î.e.n`, `e.n`, `i.e`, `e.g` — cu excepția lui `etc`, `ș.a`,
  `ș.a.m.d` și `a.m.d`, după care propoziția se încheie dacă urmează literă mare;
- după o singură literă mare (inițială: „I. L. Caragiale”);
- între două cifre („3.14”, „12.05.2026”).

Un titlu sau un element de listă fără punct final este o propoziție: se încheie la sfârșitul
paragrafului. O propoziție cu peste 300 de cuvinte se taie, la granițe de cuvânt, în bucăți de
cel mult 300 de cuvinte; fiecare bucată este o propoziție.

Un **cuvânt** este un șir fără spații care conține cel puțin o literă sau o cifră.

### 3.5 Pasajele (RF4)

Se parcurg propozițiile în ordine și se adună în pasajul curent:

1. Dacă propoziția următoare ar duce pasajul peste 300 de cuvinte, pasajul se încheie înaintea ei.
2. Dacă pasajul are cel puțin 100 de cuvinte și propoziția curentă încheie un paragraf, pasajul
   se încheie acolo.
3. La sfârșit, dacă ultimul pasaj are sub 100 de cuvinte și încape în cel dinainte fără a
   depăși 300, se unește cu acesta.

Garanții: niciun pasaj nu depășește 300 de cuvinte. Toate pasajele, în afară de ultimul, au cel
puțin 100 de cuvinte, dacă nicio propoziție nu are peste 200 de cuvinte. Un document cu sub 100
de cuvinte are un singur pasaj. Un pasaj poate trece pe pagina următoare; pagina lui este cea
pe care începe. Împărțirea este deterministă: același text dă aceleași pasaje.

### 3.6 Paginile (Q16)

- PDF: paginile reale. `page_count` este numărul de pagini al fișierului, inclusiv cele fără text.
- DOCX și TXT: nu au pagini fixe. `page = ⌊start_offset / 3000⌋ + 1`, iar
  `page_count = max(1, ⌈lungimea textului canonic / 3000⌉)`. Interfața le arată ca aproximative.
- Limita de 100 de pagini (`UPLOAD_MAX_PAGES`) se verifică la analiză, pentru toate formatele,
  fiindcă numărul de pagini se află abia după citirea fișierului: documentul trece în „Eroare”
  cu `FILE_TOO_LARGE` (M05) și nu se salvează niciun text (Q48).

### 3.7 Extragerea

`TextExtractor.extract({ format, content }, signal)` întoarce paginile brute și dacă paginile
sunt reale. Este un port: implementarea implicită citește PDF, DOCX și TXT; testele pot injecta
alta. Reguli:

- TXT: UTF-8 (cu sau fără BOM); UTF-16 cu BOM; altfel Windows-1250 (fișiere românești vechi).
- DOCX: paragrafele din `word/document.xml`, în ordine, inclusiv cele din tabele. Fără antete,
  subsoluri, note și comentarii.
- PDF: textul fiecărei pagini, cu rânduri și paragrafe refăcute din pozițiile fragmentelor.
- Fișier corupt, protejat cu parolă sau fără text → `TEXT_NOT_EXTRACTABLE` (M06).
- Arhiva DOCX se citește cu limită: `word/document.xml` despachetat nu depășește 100 MB.
- Extragerea respectă `signal` și se oprește la anulare.

Bibliotecile le alege Segmentul 2B, cu justificare (secțiunea 11).

## 4. Analiza în fundal și stările (RF4, Tabelul 3.1)

### 4.1 Fluxul unui document

`processNextDocument()` este pasul workerului (ADR-0003):

1. **PP** — revendică cel mai vechi document `queued` (`FOR UPDATE SKIP LOCKED`): `status =
   'processing'`, `processing_started_at = acum`. Dacă nu există, întoarce `false`.
2. Citește fișierul. Dacă documentul are deja text structurat (reprocesare, 4.4), sare la 6.
3. Extrage (3.7), curăță, împarte în propoziții și pasaje (3.3–3.5).
4. Verifică limita de pagini (3.6) și textul minim (3.3).
5. Salvează `page_count`, pasajele și propozițiile, într-o singură tranzacție.
6. Apelează portul de analiză `analyseDocument({ documentId }, signal)` (4.2).
7. **PR** — `status = 'ready'`.

Orice eșec la pașii 2–6 este **PE**: `status = 'error'`, `error_reason` = codul erorii
(`TEXT_NOT_EXTRACTABLE`, `FILE_TOO_LARGE`, `LLM_UNAVAILABLE`, `DOCUMENT_PROCESSING_TIMEOUT`;
orice altă excepție devine `INTERNAL_ERROR` și se jurnalizează). API-ul întoarce
`error: { code, message }`, cu mesajul din catalog.

**Fiecare scriere de la pașii 5 și 7 și de la PE este condiționată** de
`status = 'processing' AND processing_started_at = <momentul revendicării>`. Dacă între timp
documentul a fost șters (C-08), a trecut în „Eroare” prin limita de timp (C-10) sau a fost
reprocesat și revendicat din nou, scrierea nu atinge niciun rând și rezultatul se aruncă, fără
eroare. Aceasta este regula care acoperă cele trei celule „neprevăzute” din Tabelul 3.2; nu se
bazează pe anularea în memorie, fiindcă API-ul și workerul sunt procese diferite.

### 4.2 Portul de analiză

Extragerea conceptelor (RF7) aparține Segmentului 3 și nu se presupune aici nicio metodă.
`documents` primește funcția prin `AppDependencies.analyseDocument`, la fel cum `auth` primește
expeditorul de e-mail:

```ts
type AnalyseDocument = (input: { documentId: number }, signal: AbortSignal) => Promise<void>;
```

- Reușește → documentul devine „Gata”. Aruncă `AppError` → „Eroare” cu acel cod (M07 pentru
  `LLM_UNAVAILABLE`).
- Primește doar identificatorul documentului; își citește pasajele prin serviciul `documents`.
- Până la Segmentul 3, implementarea implicită nu face nimic: documentul devine „Gata” cu text
  și pasaje, fără concepte (Q52).

### 4.3 Limita de timp (T2, PE, C-10)

- În procesul care analizează: `signal` este anulat după `DOCUMENT_PROCESSING_TIMEOUT_SECONDS`
  (60); documentul trece în „Eroare” cu `DOCUMENT_PROCESSING_TIMEOUT`.
- `failStuckDocuments()`: orice document `processing` cu `processing_started_at` mai vechi decât
  limita trece în „Eroare” cu același cod. Acoperă procesele căzute. Rulează în worker la 10 s.
- Un rezultat sosit după aceea este aruncat (4.1).

### 4.4 Reprocesarea (RP, C-09, Q47)

`POST /documents/{id}/reprocess`:

- din `ready` sau `error` → `queued`, `error_reason = NULL`, răspuns `202` cu documentul;
- din `queued` sau `processing` → `409 DOCUMENT_ALREADY_PROCESSING`; nu se creează o a doua
  procesare (C-09).

Fișierul nu se schimbă, iar extragerea este deterministă, deci **textul structurat se extrage o
singură dată**. Reprocesarea unui document care are deja pasaje reia doar analiza (pasul 6);
pasajele își păstrează identificatorii, deci conceptele, materialele și progresul legate de ele
rămân valabile. Un document ajuns în „Eroare” înainte de salvarea textului se extrage din nou.

### 4.5 Starea în interfață (C-02, Q13)

Cât timp un document este `queued` sau `processing`, interfața cere `GET /documents/{id}` la cel
mult 3 s. Răspunsul nu se pune în cache (`Cache-Control: no-store`).

## 5. Documentele (RF6)

- `GET /documents`: documentele studentului, fără cele șterse, ordonate după `uploaded_at`
  descrescător, apoi `id` descrescător; filtre `subject_id` (materia altcuiva → `404`) și
  `status`.
- `GET /documents/{id}`: documentul șters răspunde `404`, ca unul inexistent.
- `PATCH /documents/{id}` (RD): schimbă `file_name` (1–255 de caractere, curățat la capete), în
  orice stare; starea nu se schimbă. Formatul nu se schimbă, oricare ar fi extensia din nume.
- `DELETE /documents/{id}` (ȘT), în orice stare: într-o tranzacție, `status = 'deleted'`,
  `deleted_at = acum`, iar pasajele documentului se șterg (cu ele, în cascadă, propozițiile,
  legăturile cu conceptele și materialele). Fișierul se șterge de pe disc după `COMMIT`.
  Răspuns `204`; a doua ștergere răspunde `404`. Conceptele rămase fără niciun pasaj sunt
  regula Segmentului 3 (Q51).
- Rândurile șterse logic se elimină fizic după `DELETED_DOCUMENT_RETENTION_HOURS` (48):
  `purgeDeletedDocuments()`, în worker, o dată pe oră (Q12).

## 6. Fișierul original și pasajele (RF5)

- `GET /documents/{id}/file`: octeții originali, în orice stare în afară de „Șters”.
  `Content-Type` după format (`application/pdf`,
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `text/plain`);
  `Content-Disposition: inline`, cu numele documentului codificat (`filename*=UTF-8''…`);
  `X-Content-Type-Options: nosniff`; `Content-Security-Policy: sandbox`;
  `Cache-Control: private, no-store`. Fișier lipsă pe disc → `404` și o linie de eroare în jurnal.
- `GET /documents/{id}/passages`: pasajele în ordinea `position`, paginate; filtrul
  `page_number` întoarce pasajele care încep pe acea pagină. Document care nu este `ready` →
  `409 DOCUMENT_NOT_READY`.
- Deschiderea pasajului sursă al unui concept sau material (RF5) folosește `Source` din
  contract: document, pasaj, citat. Evidențierea citatului în pasaj este a Segmentului 6.

## 7. Ce oferă modulul celorlalte

Prin `app.documents` (`DocumentsService`, în `modules/documents/types.ts`); fiecare funcție ia
un `UserActor` și răspunde `NOT_FOUND` pentru resursa altcuiva.

| Funcție                                   | Pentru                                                     |
| ----------------------------------------- | ---------------------------------------------------------- |
| `getOwnedDocument(actor, id)`             | analiză, conținut: verifică proprietatea și starea          |
| `listPassages`, `getPassagesByIds`        | SRS 3.1.3: pasajele trimise modelului, cu identificatori    |
| `getDocumentStructure(actor, id)`         | textul canonic, paragrafele și propozițiile, cu poziții     |
| `getStructureForAnalysis(documentId)`     | același lucru, pentru portul de analiză, care rulează în worker fără utilizator |
| `userFiles`                               | `auth`: ștergerea fișierelor unui cont (Q43)                |
| `documentsWorkerTasks(service)`           | `src/worker.ts`                                             |

`markDocumentReady` și `markDocumentFailed`, anunțate în Segmentul 0, nu mai sunt necesare:
tranzițiile PR și PE le face `processNextDocument`, după rezultatul portului de analiză.

## 8. Fișierele pe disc și Q43

- Cale: `<UPLOAD_DIR>/<user_id>/<document_id>.<format>`. Numele vine numai din identificatori
  și din format; numele dat de utilizator nu ajunge niciodată într-o cale.
- La încărcare: rândul se inserează și fișierul se scrie în aceeași tranzacție; dacă scrierea
  eșuează, tranzacția se anulează, iar dacă `COMMIT` eșuează, fișierul se șterge.
- La ștergerea unui document sau a unei materii: întâi baza de date, apoi fișierele. Un eșec la
  ștergerea fișierului se jurnalizează; operația rămâne reușită.
- **Q43, obligația din Segmentul 1.** `DocumentsService.userFiles` implementează
  `UserFileStore`: `deleteAllForUser(userId)` șterge directorul utilizatorului cu tot ce conține.
  Este idempotent (director lipsă = reușită) și refuză un identificator care nu este întreg
  pozitiv. `app.ts` îl dă serviciului `auth` în locul implementării care doar avertiza;
  `createPendingUserFileStore` dispare.
- **Fișiere orfane.** `removeOrphanFiles()`, în worker, o dată pe zi: șterge fișierele mai vechi
  de o oră care nu corespund unui document existent și neșters, și directoarele utilizatorilor
  care nu mai există. Acoperă căderile dintre `COMMIT` și ștergerea fișierului.
- Directorul de încărcări nu este servit static; fișierele se citesc numai prin ruta din
  secțiunea 6, după verificarea proprietății.

## 9. Sarcinile workerului

| Nume                            | Interval | Ce face                                              |
| ------------------------------- | -------- | ---------------------------------------------------- |
| `documents:process-queue`       | 1 s      | `processNextDocument` până când coada este goală      |
| `documents:fail-stuck`          | 10 s     | `failStuckDocuments` (4.3)                            |
| `documents:purge-deleted`       | 1 h      | `purgeDeletedDocuments` (secțiunea 5)                 |
| `documents:remove-orphan-files` | 24 h     | `removeOrphanFiles` (secțiunea 8)                     |

## 10. Securitate și jurnalizare

| Risc                                         | Cum este acoperit                                                        | Verificat de            |
| -------------------------------------------- | ------------------------------------------------------------------------ | ----------------------- |
| Acces la materiile sau documentele altcuiva  | `UserActor` în fiecare interogare; `404`; suita de proprietate            | `ownership` (există)    |
| Nume de fișier cu `../` sau caractere speciale | calea se construiește doar din identificatori (8)                       | `file-store.test.ts`    |
| Fișier executabil redenumit                  | extensie + semnătură (2.2); fișierul nu se execută niciodată              | `upload.test.ts`        |
| Document servit ca pagină activă             | `nosniff`, `Content-Security-Policy: sandbox`, `Content-Disposition`      | `documents.test.ts`     |
| Arhivă DOCX care se despachetează la GB      | limită la despachetare (3.7)                                              | `extraction.test.ts`    |
| Fișier care blochează analiza                | limită de timp, `signal`, proces separat de API (4.3)                     | `processing.test.ts`    |
| Umplerea discului                            | dimensiune maximă, limită zilnică atomică (2.4)                           | `upload-quota.test.ts`  |
| Date rămase după ștergere                    | fișiere șterse după `COMMIT`, curățare de orfani, Q43 (8)                 | `file-store.test.ts`    |

În jurnal apar identificatorii (`document_id`, `subject_id`, `user_id`), starea și codul erorii.
Nu apar textul documentului, pasajele și numele fișierului (poate conține date personale).
Nimic din Segmentul 2 nu apelează modelul de limbaj; ADR-0012 se aplică de la Segmentul 3.

## 11. Ce are de făcut Segmentul 2B

1. **Migrare**: tabelul `sentences` (3.1), cu inversa scrisă de mână; indexul unic al materiilor
   devine `(user_id, lower(name))` (Q17). `docs/DATA_MODEL.md` și testul „exact 16 tabele”
   trec la 17. Fabrica de rânduri din `tests/helpers/db.ts` primește `sentence`.
2. **Dependențe**, cu justificare în commit sau într-un ADR: o bibliotecă pentru PDF care dă
   fragmentele de text cu poziții pe pagină (de exemplu `pdfjs-dist`) și una pentru DOCX (de
   exemplu `mammoth`), sau citirea directă a `word/document.xml` cu `node:zlib`. TXT nu cere
   nimic. Prototipul din `legacy/express/` este doar referință.
3. `modules/documents/`: `repository.ts`, `service.ts` (implementează `DocumentsService` fără
   să-i schimbe forma), funcția pură `structureText`, extractorul implicit, depozitul de fișiere.
4. `modules/admin/service.ts`: `getSettings(db)`, numai citire, cu valorile implicite pentru
   cheile lipsă (Q49). Restul modulului rămâne al Segmentului 7.
5. `app.ts`: `app.decorate('documents', createDocumentsService(...))`; `userFiles` al serviciului
   `auth` devine `app.documents.userFiles`; se șterge `createPendingUserFileStore`.
   `worker.ts`: `documentsWorkerTasks`.
6. Înlocuiește `notImplemented` în `modules/documents/router.ts`.
7. Variabilele noi (`DOCUMENT_PROCESSING_TIMEOUT_SECONDS`, `DELETED_DOCUMENT_RETENTION_HOURS`)
   există deja în `core/config.ts` și `.env.example`.
8. **Elimină excluderea testelor** — obligatoriu: șterge `backend/vitest.documents.config.ts`,
   scriptul `test:documents`, ținta `test-documents` din Makefile, linia `exclude` din
   `backend/vitest.config.ts` și jobul `documents-spec` din CI. Adaugă `'documents'` în
   `IMPLEMENTED_TAGS`. La final `make test` include testele din `tests/documents/` și trece.
9. Nu modifică testele din `tests/documents/` ca să treacă; un test care pare greșit se
   semnalează.
10. Parcurge `docs/design/documents-checklist.md`, secțiunea A, și bifează în
    `docs/design/auth-checklist.md`, secțiunea G, obligația Q43.
