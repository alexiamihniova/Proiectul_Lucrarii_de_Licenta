# Lista de verificare: conturi și acces

Pentru recenzia finală (Segmentul 10) și pentru sfârșitul Segmentului 1B. Fiecare punct se
verifică în cod sau prin rulare; „testat” înseamnă că există un test care pică dacă punctul este
încălcat, dar recenzia confirmă totuși că testul rulează în `make test`.

Referințe: `docs/design/auth.md` (secțiunile din paranteze), ADR-0005, ADR-0010, ADR-0011.

## A. Predarea Segmentului 1B

Verificat la 16.11.2026, la sfârșitul Segmentului 1B: 647 de teste backend în `make test`, dintre
care 477 în `tests/auth/`; `git diff` pe `backend/tests/auth/` față de Segmentul 1A este gol.
Dependență nouă: `bcrypt` (ADR-0010). Recenzia finală reverifică fiecare punct.

- [x] `make test` rulează și testele din `backend/tests/auth/` și trece. **Excluderea a fost
      eliminată**: nu mai există `backend/vitest.auth.config.ts`, scriptul `test:auth`, ținta
      `test-auth` din Makefile, linia `exclude` din `backend/vitest.config.ts` și jobul
      `auth-spec` din `.github/workflows/ci.yml`.
- [x] Niciun test din `backend/tests/auth/` nu a fost modificat, șters, sărit (`skip`, `todo`) sau
      slăbit ca să treacă. `git diff` față de commit-ul Segmentului 1A, pe acest director, este
      gol sau conține doar corecții semnalate și aprobate.
- [x] `'auth'` a fost adăugat în `IMPLEMENTED_TAGS` din `backend/tests/api-contract.test.ts`.
- [x] Interfețele din `modules/auth/types.ts` au aceeași formă; semnăturile `createAuthService`,
      `registerAuthHooks`, `authWorkerTasks` sunt neschimbate.
- [x] Fiecare dependență nouă este justificată în mesajul de commit sau într-un ADR.
- [x] `make lint` și `make check-generated` trec; `docs/openapi.json` este la zi.
- [x] `npm run admin:create` există, cere parola interactiv și nu o primește ca argument.
- [x] `docs/OPEN_QUESTIONS.md`: Q33, Q36–Q41 sunt confirmate (16.11.2026); Q42 este acceptată
      ca limitare; Q43 este obligația Segmentului 2 (secțiunea G).
- [x] Procedura pentru conturile de administrator din `docs/design/auth.md`, 6.4, corespunde
      scriptului `admin:create` livrat.

## B. Parole (1)

- [ ] Hash cu bcrypt, cost din `BCRYPT_COST`; în producție configurarea refuză sub 10. *(testat)*
- [ ] Hash-ul se calculează în afara buclei de evenimente (bibliotecă nativă sau fire de lucru).
- [ ] Parola nu este tăiată, normalizată sau trecută prin alt hash înainte. *(testat)*
- [ ] Peste 72 de octeți → `PASSWORD_TOO_LONG`, la înregistrare, la resetare și la crearea
      administratorului. *(testat)*
- [ ] Căutare în cod: `password` nu apare în niciun apel de jurnal, mesaj de eroare sau răspuns.
- [ ] `password_hash` nu părăsește `modules/auth/`: nu apare în alt modul, în scheme sau în export.
- [ ] La e-mail inexistent se face totuși o comparație bcrypt cu un hash fictiv (timp egal).
      **Nu este testat**: se verifică citind `login` și măsurând de mână câteva cereri.
- [ ] Rehash la schimbarea costului, înainte de emiterea cookie-ului. *(testat)*

## C. Sesiune (2)

- [ ] Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, fără `Domain`, `Max-Age` = durata sesiunii;
      `Secure` când `NODE_ENV=production`. *(testat)*
- [ ] Jetonul conține doar `sub`, `iat`, `exp`, `pfp`. *(testat)*
- [ ] `pfp` este HMAC cu `SESSION_SECRET`, cu prefixul `recap:pfp:v1:`; nu este o bucată din
      hash. *(testat)*
- [ ] Algoritmul este fixat la HS256 la verificare (nu „ce spune antetul”). *(testat)*
- [ ] Comparațiile de semnătură și de amprentă sunt în timp constant (`timingSafeEqual`).
- [ ] Utilizatorul este citit din bază la **fiecare** cerere protejată; nu există cache de
      sesiuni sau de utilizatori. *(testat prin efectul imediat al blocării și al rolului)*
- [ ] Sesiunea nu se prelungește la activitate. *(testat)*
- [ ] Deconectarea șterge cookie-ul cu aceleași atribute. *(testat)*
- [ ] Jetonul nu apare în niciun corp de răspuns și în niciun URL.
- [ ] `SESSION_SECRET` are cel puțin 32 de caractere și este diferit în fiecare mediu.
- [ ] **Risc acceptat, confirmat din nou la recenzie**: după deconectare, un jeton furat rămâne
      valid până la expirare sau până la schimbarea parolei (ADR-0011). Dacă nu mai este
      acceptabil: coloana `users.session_version`.

## D. CSRF (2.5)

- [ ] Verificarea originii rulează pe toate metodele care modifică date, inclusiv pe rutele
      publice și la încărcarea de fișiere. *(testat)*
- [ ] Nicio rută `GET` nu modifică date. Se parcurge `docs/openapi.json` și fiecare `GET` nou.
- [ ] `APP_BASE_URL` din producție este originea reală a aplicației (schemă, gazdă, port).
- [ ] Nu există configurare CORS care să permită alte origini cu credențiale.

## E. Blocare, rată, enumerare (3)

- [ ] 5 greșeli consecutive → blocare 15 minute; a 5-a răspunde deja `429` cu timpul rămas.
      *(testat)*
- [ ] Contorul crește atomic, într-o singură instrucțiune SQL. *(testat cu cereri simultane)*
- [ ] Starea de blocare este în baza de date, nu în memorie. *(testat)*
- [ ] Limita per IP acoperă toate rutele publice de cont; cererea respinsă nu atinge baza.
      *(testat)*
- [ ] `TRUST_PROXY` este `true` numai dacă aplicația stă în spatele unui proxy controlat; altfel
      limita poate fi ocolită cu `X-Forwarded-For`. *(comportamentul este testat; valoarea din
      producție se verifică de mână)*
- [ ] Limita per IP este în memoria procesului: valabil cât timp rulează un singur proces API.
      La mai multe procese trebuie mutată în baza de date (Q33).
- [ ] Autentificare: același răspuns pentru e-mail inexistent și parolă greșită. *(testat)*
- [ ] Cerere de resetare: întotdeauna `202`, fără corp. *(testat)*
- [ ] Confirmare de resetare: același răspuns pentru jeton necunoscut, expirat, folosit. *(testat)*
- [ ] Resursa altui utilizator răspunde `404`, niciodată `403`. *(testat)*
- [ ] Cele două excepții de la anti-enumerare sunt cele cerute de SRS și doar ele: M02 la
      înregistrare; `429` după a 5-a greșeală pentru un cont existent (Q35).

## F. Resetarea parolei (4)

- [ ] Jeton din `crypto.randomBytes(32)`; nu din `Math.random`, UUID sau marcaj de timp.
- [ ] În bază doar SHA-256 al jetonului. *(testat)*
- [ ] Valabil o oră, o singură folosire; folosirea este atomică. *(testat cu cereri simultane)*
- [ ] Reușita anulează celelalte jetoane, închide sesiunile, ridică blocarea temporară. *(testat)*
- [ ] Nu se deschide sesiune la confirmare. *(testat)*
- [ ] Sarcina de curățare este înregistrată în `collectTasks()` din `backend/src/worker.ts`.
      *(funcția este testată; înregistrarea se verifică de mână)*
- [ ] **Segmentul 8**: `createPasswordResetSender` trimite e-mail real, iar linia de jurnal de
      dezvoltare cu legătura a fost eliminată. Până atunci: în producție nu apare nicio legătură
      în jurnal. *(testat)*
- [ ] Pagina de resetare din frontend nu trimite jetonul mai departe: fără resurse de pe alte
      domenii pe acea pagină, `Referrer-Policy: no-referrer`, jetonul scos din URL după citire
      (Segmentul 6).

## G. Ștergerea contului și exportul (5)

- [ ] Ștergerea cere parola curentă; greșelile nu se numără la blocarea autentificării. *(testat)*
- [ ] După ștergere nu rămâne niciun rând al utilizatorului, în niciun tabel, cu excepția
      `llm_calls`, unde `user_id` și `document_id` sunt NULL. *(testat)* La fiecare tabel nou cu
      date de utilizator se verifică `ON DELETE CASCADE` și se adaugă în test.
- [ ] Fișierele se șterg după `COMMIT`. *(testat cu un înregistrator)*
- [ ] **Obligația Segmentului 2 (Q43).** Segmentul 2 a furnizat implementarea reală a
      `UserFileStore.deleteAllForUser`, a legat-o în `app.ts` în locul celei implicite (care nu
      face nimic), a adăugat un test care verifică, pe disc, că fișierele unui cont șters dispar
      și are o curățare a fișierelor orfane. Până atunci ștergerea contului NU șterge fișiere.
- [ ] Datele deja trimise furnizorului modelului de limbaj nu pot fi șterse la ștergerea contului
      ([ADR-0012](../ADR/0012-furnizor-llm.md), constrângerea 3): textul acordului de la înregistrare și cel de la ștergerea contului spun
      asta, iar aplicația nu promite nicăieri contrariul.
- [ ] Ștergerea de către administrator trece prin aceeași funcție. *(testat)*
- [ ] Exportul conține doar datele utilizatorului și nicio credențială. *(testat)* La fiecare
      set de date nou se decide dacă intră în export (RF20: materii, concepte, rezultate, progres).
- [ ] Copiile de rezervă expiră în cel mult 30 de zile (RF20): se verifică procedura de backup.

## H. Roluri și autorizare (6)

- [ ] Există un singur hook de autentificare, în `modules/auth`; niciun router nu verifică roluri
      și nu citește cookie-ul. Căutare: `request.headers.cookie`, `role ===` în `modules/*/router.ts`.
- [ ] Hook-ul rulează în `onRequest`, înaintea validării. *(testat)*
- [ ] Fiecare rută nouă apare în `access-control.test.ts` fără să fie adăugată de mână (testul
      pornește de la `docs/openapi.json`). *(testat)*
- [ ] Un administrator nu trece pe rutele de student. *(testat)*
- [ ] Înregistrarea creează doar studenți; nu există cale prin API spre rolul de administrator.
      *(testat)*
- [ ] Fiecare funcție de repository care atinge date ale utilizatorilor are un `UserActor` ca prim
      parametru și filtrează după `actor.userId`. Se parcurg toate fișierele `repository.ts`.
- [ ] Fiecare apariție a `systemActor(` este justificată (worker, script), niciodată într-un
      handler HTTP. Căutare în cod.
- [ ] `ownership.test.ts` trece și nu mai sare nicio rută implementată: numărul de rute care
      răspund `501` este cel așteptat pentru segmentele rămase. *(testat)*
- [ ] Pentru datele legate doar de sesiune (`/progress/…`, `/reviews/…`), fiecare segment a scris
      verificarea cu `twoStudents()`.
- [ ] Administratorul nu poate citi textul documentelor, al pasajelor, al răspunsurilor sau al
      materialelor (SRS 3.4), cu excepția deciziei de la Q10.

## I. Jurnalizare (7)

- [ ] `logging.test.ts` trece. *(testat: parole, hash-uri, jetoane, legături, cookie-uri, e-mailuri)*
- [ ] Niciun apel de jurnal nu primește obiectul `request.body` sau `request.headers` întreg.
- [ ] Evenimentele din tabelul 7.1 există, cu `actor_id` și `target`. *(testat)*
- [ ] Jurnalele de producție sunt păstrate și accesibile doar administratorului (operațional).
- [ ] Nivelul `debug` sau `trace` nu este activ în producție.

## J. Transport și configurare (RNF6)

- [ ] Producția servește numai HTTPS (TLS 1.2 sau mai nou); HTTP redirecționează.
- [ ] `.env` nu este în repozitoriu; `SESSION_SECRET`, `LLM_API_KEY`, parola SMTP nu apar în cod,
      în istoric sau în imaginea Docker. Căutare în `git log -p`.
- [ ] `LLM_PROVIDER=fake` este refuzat în producție. *(testat)*
- [ ] `/docs` (interfața OpenAPI) nu este servit în producție.
- [ ] Antete de securitate pe frontend: `Content-Security-Policy`, `X-Content-Type-Options`,
      `Referrer-Policy` (Segmentul 6 sau serverul web).

## K. Modelul de amenințări (8): un rând, o verificare

| Atac                                   | Verificare la recenzie                                               |
| -------------------------------------- | -------------------------------------------------------------------- |
| Forță brută pe un cont                 | `login-lockout.test.ts` în `make test`                               |
| O parolă pe multe conturi              | `rate-limit.test.ts`; valoarea `RATE_LIMIT_AUTH_MAX` din producție   |
| Hash-uri furate                        | `BCRYPT_COST` din producție ≥ 12                                     |
| Furt de sesiune                        | atributele cookie-ului; HTTPS; riscul acceptat reconfirmat           |
| Jeton falsificat                       | `session.test.ts`                                                    |
| Enumerare                              | secțiunea E; timpul egal verificat de mână                           |
| CSRF                                   | `csrf.test.ts`; niciun `GET` care modifică                           |
| IDOR                                   | `ownership.test.ts`; parcurgerea `repository.ts`                     |
| Escaladarea rolului                    | `access-control.test.ts`, `admin-accounts.test.ts`                   |
| Preluarea contului prin resetare       | `password-reset.test.ts`; secțiunea F                                |
| Scurgeri prin jurnal                   | `logging.test.ts`; un eșantion de jurnal de producție citit de mână  |
