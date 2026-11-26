# Proiectarea modulului de materii și documente (Segmentul 2)

Acoperă RF3–RF6, C-02, C-03, C-07–C-10, UC-04, tabelul de stări al documentului (Dosar, Tabelul
3.1) și obligația din Segmentul 1 de a șterge fișierele unui cont (Q43). Segmentul 2A (acest
document, testele din `backend/tests/documents/`, trasate în `documents-tests.md`, și
interfețele din `modules/documents/types.ts`) fixează comportarea; Segmentul 2B o implementează fără să o
reinterpreteze. Lista de lucru pentru 2B este în secțiunea 11.

Deciziile autoarei din 23.11.2026 asupra întrebărilor Q12, Q13, Q16, Q17 și Q46–Q52 sunt incluse mai
jos; Q53 (limita de 60 s) rămâne o valoare provizorie.

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
| Numărul maxim de pagini               | 100; PDF la încărcare, DOCX și TXT la analiză | [SRS] RF3, P4; [decis] Q48 | `UPLOAD_MAX_PAGES` |
| O „pagină” pentru DOCX și TXT         | 3000 de caractere de text curățat       | [propus] Q16     | fix                               |
| Încărcări pe zi                       | 10, resetate la 00:00 ora Chișinăului   | [SRS] P6, C-07   | CONFIGURARE `uploads_per_day` (1–50), `APP_TIMEZONE` |
| Lungimea unui pasaj                   | 100–300 de cuvinte                      | [SRS] RF4        | fix                               |
| Text minim                            | 200 de caractere                        | [SRS] RF4, M06   | fix                               |
| Numărarea paginilor unui PDF, la încărcare | 5 s și 256 MB de heap, într-un proces copil; **măsurate** în 2B (Q48) | [propus] Q48 | `PDF_PAGE_COUNT_TIMEOUT_SECONDS`, `PDF_PAGE_COUNT_MEMORY_MB` |
| Limita de timp a analizei             | 60 s, **provizorie**                    | [Dosar] PE, C-10; [SRS] T2 doar pentru ≤ 50 de pagini; Q53 | `DOCUMENT_PROCESSING_TIMEOUT_SECONDS` |
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
  fusul orar al aplicației). Ultimele două citesc tabele ale Segmentelor 3 și 5, deci vin din
  `shared-queries` (ADR-0014, Q50), nu dintr-o interogare a modulului `documents`.
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
| 6   | Numai PDF: numărul de pagini ≤ `UPLOAD_MAX_PAGES`, numărat în limite de timp și memorie (2.5, Q48) | `413 FILE_TOO_LARGE` (M05), pentru prea multe pagini sau pentru un fișier prea complex |
| 7   | Încărcările de azi < `uploads_per_day`                               | `429 DAILY_UPLOAD_LIMIT_REACHED` (M08)    |

Formatul, dimensiunea și, pentru PDF, numărul de pagini se verifică înainte de salvare (RF3, Q48). Tipul `Content-Type` declarat de
browser nu se folosește: îl alege clientul. Un fișier respins nu consumă din limita zilnică și
nu lasă nimic pe disc sau în bază.

`details` spune limita încălcată, ca interfața să o afișeze o singură dată (C-03):

| Eroare                        | `details`                                                        |
| ----------------------------- | ---------------------------------------------------------------- |
| `UNSUPPORTED_FILE_FORMAT`     | `{ "allowed": ["pdf", "docx", "txt"] }`                          |
| `FILE_TOO_LARGE`              | `{ "exceeded": "size", "limit_mb": 20, "limit_pages": 100 }`; sau `{ "exceeded": "pages", "limit_mb", "limit_pages", "pages": <numărul găsit> }`; sau `{ "exceeded": "complexity", "reason": "timeout" \| "memory", "limit_mb", "limit_pages" }` |
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

### 2.5 Numărul de pagini al unui PDF, la încărcare (Q48)

Pentru un PDF, numărul de pagini se află înainte de salvare, **fără extragerea textului**: se
citește numai structura fișierului (arborele de pagini), nu conținutul paginilor. Numărarea este un
port (`PdfPageCounter`, în `types.ts`); implementarea implicită rulează într-un **proces copil**
(nu într-un fir de execuție) cu limită de heap (`--max-old-space-size`) și cu timeout, după care
procesul este ucis. Cererea HTTP așteaptă rezultatul; cel mult 4 numărări rulează simultan,
celelalte așteaptă. De ce proces și nu fir: măsurat pe fișiere ostile (Q48), un fir care depășește
limita de heap se poate încheia cu o eroare fatală V8 care oprește **întregul proces al
aplicației**, nu doar firul; un proces copil poate muri fără să afecteze serverul. Valorile vin din
configurare: `PDF_PAGE_COUNT_TIMEOUT_SECONDS` (propus 5) și `PDF_PAGE_COUNT_MEMORY_MB` (propus 256).

**Cele patru rezultate** (`PageCountOutcome`) și ce face încărcarea cu fiecare:

| Rezultat                                   | Încărcarea                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `pages`, cel mult `UPLOAD_MAX_PAGES`        | continuă                                                                                        |
| `pages`, mai mult decât limita              | `413 FILE_TOO_LARGE`, `details.exceeded = "pages"`, cu `pages` = numărul găsit                  |
| `unreadable`: fișier corupt, protejat cu parolă sau care nu este un PDF real | **continuă**; analiza decide (`TEXT_NOT_EXTRACTABLE`, M06) |
| `timeout` sau `memory`: numărarea a atins o limită | `413 FILE_TOO_LARGE`, `details.exceeded = "complexity"`, `details.reason = "timeout"` sau `"memory"`, cu mesajul propriu „Fișierul este prea complex pentru a fi verificat. Încarcă o variantă mai simplă sau mai mică.” |

Diferența are un motiv: un fișier corupt sau protejat nu este „prea mare”, iar mesajul corect îl dă
analiza (M06). Un fișier la care numărarea nu se termină în limite este însă un risc pentru server
și nu are rost să ajungă la analiză: se refuză la încărcare, ca să nu consume timp sau memorie
nici acolo.

- **Codul de eroare.** Se reutilizează `FILE_TOO_LARGE` (M05, „Încarcă o variantă mai mică”), cu
  `details.exceeded = "complexity"` și un mesaj propriu. Nu se adaugă un cod nou în catalog; dacă
  interfața are nevoie de unul distinct (de exemplu `FILE_TOO_COMPLEX`), se decide la Segmentul 6
  (Q48).
- **Ca orice fișier refuzat:** niciun rând, niciun fișier pe disc, nicio folosire din limita zilnică.
- **Ordinea.** Numărarea se face doar pentru PDF, după verificările de format și dimensiune, și
  **înainte** de limita zilnică: un PDF prea lung primește 413 chiar dacă limita zilnică s-a
  epuizat.
- **Un defect al numărătorului** (o excepție în loc de un rezultat) nu blochează încărcarea: se
  jurnalizează ca eroare, fără numele fișierului, iar încărcarea continuă; analiza rămâne plasa de
  siguranță.
- **Plasa de siguranță.** Verificarea de la analiză (3.6) rămâne pentru toate formatele, fiindcă
  numărul de la încărcare poate lipsi (`unreadable`, defect) sau poate diferi de cel din
  extragere: un PDF peste limită, care a trecut, ajunge în „Eroare” cu `FILE_TOO_LARGE`.
- **Valorile 5 s și 256 MB au fost măsurate în 2B (23.11.2026)**; rezultatele sunt în Q48. Numărarea
  costă 0,3–0,6 s pe un fișier real; un fișier care nu poate fi deschis din cauza unei limite este
  refuzat. Valoarea implicită de 256 MB este generoasă (un fișier legitim cere cel mult 16 MB);
  `PDF_PAGE_COUNT_MEMORY_MB` o poate coborî fără modificări de cod.
- DOCX și TXT nu se numără la încărcare: nu au pagini fixe (Q16), iar numărul se află abia din
  textul extras.

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
   **Titlurile și elementele de listă nu se lipesc de text.** Într-un bloc de rânduri fără rând
   gol între ele, o unitate nouă (propriul paragraf) începe: (a) la un element de listă (`- `, `• `,
   `1. `, `2) `, `a) `); (b) la rândul de după un titlu, dacă începe cu literă mare, cifră sau
   marcaj; (c) la un titlu care stă între rânduri încheiate, când rândul de după începe o unitate.
   Un **titlu** este un rând cu cel mult 12 cuvinte, fără semn de încheiere (`. ! ? … : ; ,`) și
   mai scurt de 60 % din rândurile lungi ale paginii (cuantila de 90 %): un rând rupt de pagină
   ajunge la margine, deci nu este titlu, chiar dacă următorul începe cu un nume propriu. Un rând
   scurt urmat de unul cu literă mică este un rând rupt, nu un titlu. Constante: 12 cuvinte, 60 %,
   cuantila de 90 % (propuse; verificate pe 5 documente reale, fără a fi validate pe altele).
   **Limită cunoscută:** codul sursă din documente (liste de cod în rapoarte de laborator) nu are
   propoziții; rămân „propoziții” lungi, tăiate la 300 de cuvinte (3.4).
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
- Limita de 100 de pagini (`UPLOAD_MAX_PAGES`) se verifică în două locuri (Q48): la încărcare,
  numai pentru PDF (2.5); și la analiză, pentru toate formatele, ca plasă de siguranță. La
  analiză, pentru DOCX și TXT numărul de pagini se află abia după extragerea textului: documentul
  trece în „Eroare” cu `FILE_TOO_LARGE` (M05) și nu se salvează niciun text.

### 3.7 Extragerea

`TextExtractor.extract({ format, content }, signal)` întoarce paginile brute și dacă paginile
sunt reale. Este un port: implementarea implicită citește PDF, DOCX și TXT; testele pot injecta
alta. Reguli:

- TXT: UTF-8 (cu sau fără BOM); UTF-16 cu BOM; altfel Windows-1250 (fișiere românești vechi).
- DOCX: paragrafele din `word/document.xml`, în ordine, inclusiv cele din tabele. Fără antete,
  subsoluri, note și comentarii.
- PDF: textul fiecărei pagini, cu rânduri și paragrafe refăcute din pozițiile fragmentelor. **Fișierul se citește într-un proces copil** (ca la numărarea paginilor, 2.5), cu limită de heap (`PDF_EXTRACT_MEMORY_MB`, 512) și oprit prin semnalul analizei: un cronometru nu poate întrerupe cod sincron, iar un conținut de pagină care se despachetează în gigaocteți ar bloca sau epuiza procesul care servește pe toată lumea. Procesul copil trimite fragmentele de text cu poziții; așezarea în pagină se face în procesul părinte. Un PDF cu mai multe pagini decât limita este refuzat înainte să se citească vreun text.
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
- **60 s este o valoare provizorie (Q53).** Vine din Dosar (pragul PE, C-10) și din SRS (T2/RNF2),
  dar SRS garantează 60 s numai pentru documente de până la 50 de pagini, iar limita de încărcare
  este 100. Analiza include apelurile către model (Segmentul 3), limitate de cota din ADR-0012. Se
  validează în Segmentul 3, pe un document real de 100 de pagini, cu apelurile reale; valoarea
  rămâne configurabilă (1–600 s).

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
  Răspuns `204`; a doua ștergere răspunde `404`. **Un concept rămas fără niciun pasaj nu
  respectă RB1** (nu are sursă verificabilă) și nici RF8: Segmentul 3 trebuie să decidă între
  ștergerea lui și marcarea lui ca inactiv (Q51). Segmentul 2 nu atinge `concepts` și nu decide;
  până la Segmentul 3 nu există concepte.
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

**Stare (26.11.2026): făcut.** Lista rămâne ca evidență; bifele cu fișierul și testul sunt în
`documents-checklist.md`. Abateri de la listă: numărarea paginilor și citirea PDF rulează în procese
copil, nu în fire (Q48); starea documentului este în `state-machine.ts`, nu în `state.ts`;
`documentsWorkerTasks` este scrisă și testată, dar **nu este înregistrată în `worker.ts`**
(Segmentul 2C); jobul `documents-spec` din CI a rămas, fără `continue-on-error`.

0. **Corecția din 2A (făcută 23.11.2026).** Decizia Q48 a cerut corectarea unui test și teste noi:
   `processing.test.ts` verifică acum pagina-limită pentru un TXT, la analiză, și plasa de
   siguranță pentru un PDF care nu a putut fi numărat; `pdf-page-limit.test.ts` (19 teste)
   acoperă respingerea la încărcare, PDF-ul corupt sau protejat acceptat, `timeout` și `memory`
   respinse ca fișier prea complex, limitele date numărătorului, ordinea verificărilor și un
   numărător defect. Numărătorul este un port (`PdfPageCounter`); testele de timeout și memorie îl
   înlocuiesc, deci **măsurarea reală a limitelor este a lui 2B**.
1. **Migrare**: tabelul `sentences` (3.1), cu inversa scrisă de mână; indexul unic al materiilor
   devine `(user_id, lower(name))` (Q17). `docs/DATA_MODEL.md` și testul „exact 16 tabele”
   trec la 17. Fabrica de rânduri din `tests/helpers/db.ts` primește `sentence`.
2. **Dependențe**, cu justificare în commit sau într-un ADR: o bibliotecă pentru PDF care dă
   fragmentele de text cu poziții pe pagină și numărul de pagini fără extragerea textului (de
   exemplu `pdfjs-dist`) și una pentru DOCX (de exemplu `mammoth`), sau citirea directă a
   `word/document.xml` cu `node:zlib`. TXT nu cere
   nimic. Prototipul din `legacy/express/` este doar referință.
3. `modules/documents/`: `repository.ts`, `service.ts` (implementează `DocumentsService` fără
   să-i schimbe forma), funcția pură `structureText`, extractorul implicit, depozitul de fișiere.
4. `modules/admin/service.ts`: `getSettings(db)`, numai citire, cu valorile implicite pentru
   cheile lipsă, **fără rute noi** (Q49). Restul modulului rămâne al Segmentului 7.
4b. **`modules/shared-queries/`** (ADR-0014, Q50): `service.ts` cu interogările de citire
   transversale; excepția ESLint numai pentru acest folder; `readStudyData` se mută din
   `modules/auth/repository.ts`, iar `exportAccount` îl apelează prin serviciu; numărătorile
   `concept_count` și `due_concept_count` vin de acolo. Un test cu doi studenți pentru fiecare
   funcție. **Mutarea se face cu testele din `tests/auth/` neschimbate: se rulează înainte de
   mutare (trec) și după (trebuie să treacă), în special `account-export.test.ts`.**
4c. `createPdfPageCounter` (2.5): numărarea paginilor unui PDF într-un proces copil, cu timeout și
   limită de heap din configurare; valorile au fost măsurate (Q48).
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
