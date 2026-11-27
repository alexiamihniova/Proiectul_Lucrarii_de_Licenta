# Lista de verificare: materii și documente

Pentru sfârșitul Segmentului 2B și pentru recenzia finală (Segmentul 10). Fiecare punct se
verifică în cod sau prin rulare; „testat” înseamnă că există un test care pică dacă punctul este
încălcat. Bifat = verificat la sfârșitul Segmentului 2B (26.11.2026), cu fișierul și testul care îl
acoperă; secțiunea C (verificarea manuală pe documente reale) o face autoarea.

Referințe: `docs/design/documents.md` (secțiunile din paranteze), ADR-0003, ADR-0008, ADR-0013, ADR-0014.

## A. Predarea Segmentului 2B

- [x] `make test` rulează și testele din `backend/tests/documents/` și trece (962 de teste
      backend). Excluderea a fost eliminată: nu mai există `backend/vitest.documents.config.ts`,
      scriptul `test:documents`, ținta `test-documents` din Makefile, linia `exclude` din
      `backend/vitest.config.ts`, iar paragraful „Temporary” din `CLAUDE.md` a fost șters.
      **Abatere față de lista din 2A:** jobul `documents-spec` din CI a rămas, fără
      `continue-on-error` și fără script propriu (`npm test -- tests/documents`), la cererea
      Segmentului 2B: o verificare vizibilă și blocantă a specificației de documente. Jobul a fost
      șters în Segmentul 2C (testele rulează oricum în jobul `backend`).
- [x] Niciun test din `backend/tests/documents/` din 2A nu a fost modificat, șters, sărit sau
      slăbit. Testele noi din 2B (în același director, fișiere noi): `docx-and-layout.test.ts`,
      `pdf-page-counter.test.ts`, `pdf-reader-process.test.ts`. Singurele teste existente care s-au
      schimbat: `migrations.test.ts` (16 → 17 tabele) și `helpers/db.ts` (fabrica de propoziții).
- [x] `'documents'` este în `IMPLEMENTED_TAGS` (`tests/api-contract.test.ts`); suita de proprietate
      (`tests/auth/ownership.test.ts`) acoperă acum rutele de materii și documente.
- [x] Interfețele din `modules/documents/types.ts` au aceeași formă; semnăturile
      `createDocumentsService`, `structureText`, `documentsWorkerTasks` sunt neschimbate.
      `createTextExtractor` primește acum un parametru **opțional** (`{ pdfMemoryMb, maxPages }`),
      compatibil cu apelurile din teste.
- [x] Migrarea `0002_sentences_and_subject_name` are inversă scrisă de mână
      (`drizzle/down/`); `docs/DATA_MODEL.md` este actualizat; `migrations.test.ts` spune 17 și trece.
- [x] Dependențe noi, justificate în mesajele de commit: `pdfjs-dist` (PDF: pagini și text cu poziții,
      fără cod executat, fără compilare nativă; cere Node 22.13+, iar `engines` o spune). DOCX se
      citește fără bibliotecă (`node:zlib`); ZIP-ul exportului la fel.
- [x] `make lint`, `make check-generated` trec; `docs/openapi.json` nu s-a schimbat în 2B.
- [x] Node: imaginile Docker (`node:24-alpine`), CI (`node-version: 24`) și `.nvmrc` (24) au același
      major, peste cerința de 22.13 a `pdfjs-dist`; minorul nu este fixat nicăieri (Q54).
- [x] `docs/OPEN_QUESTIONS.md`: Q12, Q13, Q16, Q17, Q46–Q50 confirmate; Q51 și Q52 amânate către
      Segmentul 3; Q53 (60 s) confirmată ca valoare configurabilă, de validat în Segmentul 3; Q48 are
      măsurătorile numărării paginilor și ale citirii PDF.
- [x] Testul care contrazicea Q48 a fost corectat în 2A (`pdf-page-limit.test.ts`).
- [x] `modules/shared-queries/` există, cu excepția ESLint numai pentru acel folder
      (`eslint.config.js`, ADR-0014); `readStudyData` s-a mutat din `auth/repository.ts`, cu
      `tests/auth/` neschimbat și trecut înainte și după mutare (`tests/shared-queries.test.ts`
      verifică cu doi studenți). **Rămâne în `auth/repository.ts`:** `listUsers` numără documentele
      unui utilizator cu SQL brut, o citire peste tabelele documentelor; se mută în
      `shared-queries` la Segmentul 7 (Q50).
- [x] `createPendingUserFileStore` a fost șters; `app.ts` dă serviciului `auth`
      `app.documents.userFiles`, iar `worker.ts` și `admin:create` iau același depozit din serviciul
      de documente (design 8, Q43). *(`tests/documents/file-store.test.ts`)*
- [x] În `docs/design/auth-checklist.md`, secțiunea G, obligația Segmentului 2 (Q43) este bifată.

## B. Încărcarea (2)

- [x] Ordinea verificărilor este cea din 2.1 (`documents/service.ts`, `uploadDocument`);
      formatul și dimensiunea se verifică înainte de salvare. *(`upload.test.ts`)*
- [x] Tipul declarat de browser nu se folosește; conținutul trebuie să corespundă extensiei
      (`documents/upload.ts`). *(`upload.test.ts`)*
- [x] Limita zilnică este atomică per student (`lockUploads`, `pg_advisory_xact_lock`) și numără și
      documentele șterse logic. *(`upload-quota.test.ts`, inclusiv 6 încărcări simultane)*
- [x] Limitele se citesc din CONFIGURARE la fiecare cerere (`admin/service.ts`, `getSettings`).
      *(`upload.test.ts`, `upload-quota.test.ts`, `admin-settings.test.ts`)*
- [x] Un PDF cu prea multe pagini este respins la încărcare, fără extragerea textului.
      *(`pdf-page-limit.test.ts`)*
- [x] Un PDF corupt sau protejat este acceptat și decide analiza (M06). *(`pdf-page-limit.test.ts`)*
- [x] Un PDF la care numărarea atinge timeout-ul sau limita de memorie este respins ca „fișier prea
      complex” (`FILE_TOO_LARGE`, `exceeded = complexity`). *(`pdf-page-limit.test.ts` cu un
      numărător înlocuit; `pdf-page-counter.test.ts` cu cel real)*
- [x] **Numărătorul real** rulează într-un **proces copil** (nu într-un fir: un fir care depășește
      limita de heap a oprit tot procesul), cu timeout și limită de heap din configurare, iar
      valorile au fost măsurate pe PDF-uri reale (`documents/pdf-pages.ts`; Q48).
- [x] Un fișier respins nu lasă rând sau fișier pe disc. *(`upload.test.ts`, `pdf-page-limit.test.ts`)*

## C. Textul structurat (3)

- [x] `structureText` este pură: fără acces la fișiere, bază de date sau ceas
      (`documents/structure.ts`). *(`text-structure.test.ts`: determinism)*
- [x] Invariantele din 3.2 sunt verificate pe fiecare document procesat. *(`helpers/structure.ts`,
      folosit în `text-structure.test.ts`, `extraction.test.ts`, `processing.test.ts`,
      `passages.test.ts`)*
- [x] Propozițiile și pasajele se salvează într-o singură tranzacție, împreună cu `page_count`
      (`repository.ts`, `storeStructure`). *(`processing.test.ts`: C-08)*
- [x] Pozițiile sunt în unități UTF-16 și se raportează la textul canonic. *(`passages.test.ts`)*
- [ ] Pe un curs real al autoarei, propozițiile și pasajele arată rezonabil: verificare manuală,
      cu 2–3 documente, înainte de Segmentul 3. *(a autoarei. Statistici pe 4 documente reale,
      fără a citi conținutul: pasaje de 100–300 de cuvinte, propoziții cu mediana de 64–109
      caractere. Titlurile și elementele de listă fără punct se separă acum (26.11.2026): rânduri de
      peste 300 de caractere, de la 4–16 pe document la 0–9; rămân cele din coduri sursă lipite în
      rapoarte, cu rânduri de până la 2083 de caractere. De privit cu ochii.)*

## D. Analiza și stările (4)

- [x] Toate scrierile după revendicare sunt condiționate de `status = 'processing'` și de
      momentul revendicării (`repository.ts`: `storeStructure`, `finishClaimed`).
      *(`processing.test.ts`: C-08, C-10)*
- [x] Revendicarea folosește `FOR UPDATE SKIP LOCKED` (`claimNext`). *(`processing.test.ts`: doi
      workeri nu iau același document)*
- [x] Un document rămas în analiză peste limită devine „Eroare”, chiar dacă procesul a căzut
      (`failStuckDocuments`). *(`processing.test.ts`)*
- [x] Reprocesarea nu extrage din nou textul și păstrează identificatorii pasajelor.
      *(`processing.test.ts`)*
- [x] Analiza (Segmentul 3) este primită ca funcție; `documents` nu importă `analysis`.
- [x] Stările se schimbă numai prin `state-machine.ts` (`applyUserDocumentEvent`,
      `nextDocumentStatus`); scrierea este condiționată de starea în care s-a citit rândul.
      *(`processing.test.ts`, `document-state-machine.test.ts`)*

## E. Fișiere (6, 8)

- [x] Calea fișierului este construită numai din identificatori (`documents/files.ts`).
      *(`file-store.test.ts`)*
- [x] Fișierul original se servește cu `nosniff`, `Content-Security-Policy: sandbox`,
      `Cache-Control: private, no-store`. *(`documents.test.ts`)*
- [x] Ștergerea contului șterge fișierele (Q43), după `COMMIT`. *(`file-store.test.ts`)*
- [x] Directorul de încărcări nu este servit static (nicio rută îl expune), nu este în imaginea
      Docker (`.dockerignore`: `storage`) și în Compose este un volum (`uploads`). `.gitignore` îl
      exclude acum și din `backend/storage/`.
- [ ] Copiile de rezervă ale volumului expiră în cel mult 30 de zile (RF20): procedură
      operațională, de verificat la punerea în funcțiune.
- [x] **O limită de memorie pe containerul workerului** (`mem_limit: 768m` în Compose; verificată în CI cu `docker inspect`): memoria din afara
      heap-ului nu este limitată de `--max-old-space-size` (Q48). Ține de infrastructură și de 2C.

## F. Jurnalizare și confidențialitate (10)

- [x] În jurnal nu apar textul documentului, pasajele și numele fișierului: erorile se jurnalizează
      cu identificatorul documentului. *(`file-store.test.ts`, `pdf-page-limit.test.ts`,
      `processing.test.ts`)*
- [x] Nimic din Segmentul 2 nu apelează modelul de limbaj (ADR-0012).

## G. Ce rămâne pentru alte segmente

- [x] **Segmentul 2C, primul commit** *(făcut la 27.11.2026)*: s-a șters jobul `documents-spec` din `.github/workflows/ci.yml`
      (redundant cu jobul `backend`).
- [x] **Segmentul 2C:** jobul Compose numără paginile unui PDF în imaginea Alpine și duce un TXT, un DOCX și un PDF din „În coadă” în „Gata” (`backend/tests/e2e/verify-worker.ts`, `make verify-worker`). *(CI, 27.11.2026)*
- [x] **Segmentul 2C:** sarcinile din `documentsWorkerTasks` sunt înregistrate în `collectTasks()` din
      `backend/src/worker.ts`; documentele trec singure din „În coadă” în „Gata” în aplicația pornită.
      *(`tests/documents/worker-integration.test.ts`, `tests/worker-startup.test.ts`, CI Compose)*
- [ ] **Segmentul 3:** funcția `analyseDocument` reală; un concept fără pasaj nu respectă RB1:
      decizia între ștergere și marcare inactivă (Q51); ce face analiza reluată cu conceptele
      existente (Q47); **validarea limitei de 60 s pe un document real de 100 de pagini (Q53)**.
- [ ] **Segmentul 5:** exportul trece pe serviciile modulelor (Q45) și `readStudyData` dispare din
      `shared-queries`; numărătorile pot rămâne acolo definitiv (Q50, ADR-0014).
- [ ] **Segmentul 6:** interogarea la cel mult 3 s (C-02); mesajele M04–M06, M08 cu limita
      încălcată afișată o singură dată (C-03); evidențierea citatului în vizualizator (RF5).
- [ ] **Segmentul 7:** `getSettings` primește validarea, modificarea și auditul (Q49).
