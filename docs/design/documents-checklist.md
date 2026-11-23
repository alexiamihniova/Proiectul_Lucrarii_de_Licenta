# Lista de verificare: materii și documente

Pentru sfârșitul Segmentului 2B și pentru recenzia finală (Segmentul 10). Fiecare punct se
verifică în cod sau prin rulare; „testat” înseamnă că există un test care pică dacă punctul este
încălcat.

Referințe: `docs/design/documents.md` (secțiunile din paranteze), ADR-0003, ADR-0008, ADR-0013.

## A. Predarea Segmentului 2B

- [ ] `make test` rulează și testele din `backend/tests/documents/` și trece. **Excluderea a fost
      eliminată**: nu mai există `backend/vitest.documents.config.ts`, scriptul `test:documents`,
      ținta `test-documents` din Makefile, linia `exclude` din `backend/vitest.config.ts` și jobul
      `documents-spec` din `.github/workflows/ci.yml`; paragraful „Temporary” din `CLAUDE.md` a
      fost șters.
- [ ] Niciun test din `backend/tests/documents/` nu a fost modificat, șters, sărit sau slăbit ca
      să treacă. `git diff` față de commit-ul Segmentului 2A, pe acest director, este gol sau
      conține doar corecții semnalate și aprobate.
- [ ] `'documents'` a fost adăugat în `IMPLEMENTED_TAGS` din `tests/api-contract.test.ts`.
- [ ] Interfețele din `modules/documents/types.ts` au aceeași formă; semnăturile
      `createDocumentsService`, `structureText`, `createTextExtractor`, `documentsWorkerTasks` sunt
      neschimbate.
- [ ] Migrarea pentru `sentences` și pentru indexul `lower(name)` are inversă scrisă de mână;
      `docs/DATA_MODEL.md` este actualizat; testul care numără tabelele spune 17 și trece.
- [ ] Fiecare dependență nouă (PDF, DOCX) este justificată în mesajul de commit sau într-un ADR.
- [ ] `make lint`, `make check-generated` trec; `docs/openapi.json` este la zi.
- [ ] `docs/OPEN_QUESTIONS.md`: Q46–Q52 au decizie sau sunt marcate explicit ca acceptate; Q12,
      Q13, Q16, Q17 sunt confirmate.
- [ ] `createPendingUserFileStore` din `modules/auth/service.ts` a fost șters, iar `app.ts` și
      `worker.ts` dau serviciului `auth` `documents.userFiles` (design 8, Q43).
- [ ] În `docs/design/auth-checklist.md`, secțiunea G, obligația Segmentului 2 (Q43) este bifată.

## B. Încărcarea (2)

- [ ] Ordinea verificărilor este cea din 2.1; formatul și dimensiunea se verifică înainte de
      salvare. *(testat)*
- [ ] Tipul declarat de browser nu se folosește; conținutul trebuie să corespundă extensiei. *(testat)*
- [ ] Limita zilnică este atomică per student și numără și documentele șterse logic. *(testat)*
- [ ] Limitele se citesc din CONFIGURARE la fiecare cerere. *(testat)*
- [ ] Un fișier respins nu lasă rând sau fișier pe disc. *(testat)*

## C. Textul structurat (3)

- [ ] `structureText` este pură: fără acces la fișiere, bază de date sau ceas. *(testat: determinism)*
- [ ] Invariantele din 3.2 sunt verificate pe fiecare document procesat. *(testat)*
- [ ] Propozițiile și pasajele se salvează într-o singură tranzacție, împreună cu `page_count`.
- [ ] Pozițiile sunt în unități UTF-16 și se raportează la textul canonic. *(testat)*
- [ ] Pe un curs real al autoarei, propozițiile și pasajele arată rezonabil: verificare manuală,
      cu 2–3 documente, înainte de Segmentul 3.

## D. Analiza și stările (4)

- [ ] Toate scrierile după revendicare sunt condiționate de `status = 'processing'` și de
      momentul revendicării. *(testat: C-08, C-10)*
- [ ] Revendicarea folosește `FOR UPDATE SKIP LOCKED`. *(testat)*
- [ ] Un document rămas în analiză peste limită devine „Eroare”, chiar dacă procesul a căzut.
      *(testat)*
- [ ] Reprocesarea nu extrage din nou textul și păstrează identificatorii pasajelor. *(testat)*
- [ ] Analiza (Segmentul 3) este primită ca funcție; `documents` nu importă `analysis`.

## E. Fișiere (6, 8)

- [ ] Calea fișierului este construită numai din identificatori. *(testat)*
- [ ] Fișierul original se servește cu `nosniff`, `Content-Security-Policy: sandbox`,
      `Cache-Control: private, no-store`. *(testat)*
- [ ] Ștergerea contului șterge fișierele (Q43), după `COMMIT`. *(testat)*
- [ ] Directorul de încărcări nu este servit static și nu este în imaginea Docker; în Compose este
      un volum.
- [ ] Copiile de rezervă ale volumului expiră în cel mult 30 de zile (RF20).

## F. Jurnalizare și confidențialitate (10)

- [ ] În jurnal nu apar textul documentului, pasajele și numele fișierului. *(testat parțial)*
- [ ] Nimic din Segmentul 2 nu apelează modelul de limbaj (ADR-0012).

## G. Ce rămâne pentru alte segmente

- [ ] **Segmentul 3:** funcția `analyseDocument` reală; ștergerea conceptelor rămase fără pasaje
      (Q51); ce face analiza reluată cu conceptele existente (Q47).
- [ ] **Segmentul 5:** `concept_count` și `due_concept_count` pot trece pe serviciile modulelor
      respective, sau excepția devine definitivă (Q50).
- [ ] **Segmentul 6:** interogarea la cel mult 3 s (C-02); mesajele M04–M06, M08 cu limita
      încălcată afișată o singură dată (C-03); evidențierea citatului în vizualizator (RF5).
- [ ] **Segmentul 7:** `getSettings` primește validarea, modificarea și auditul (Q49).
