# Testele modulului de conturi: trasabilitate

Specificația executabilă a Segmentului 1 este în `backend/tests/auth/`: 14 fișiere, 477 de teste,
scrise în Segmentul 1A. După decizia Q42 s-a adăugat `consent-version.test.ts` (5 teste).
Tabelele de mai jos leagă fiecare grup de cazuri de cerința din SRS sau din Dosar.

## Cum se rulează

```sh
make test                           # toate testele, inclusiv cele din tests/auth/
npm --prefix backend test -- tests/auth/login-lockout.test.ts
```

De la Segmentul 1B testele trec și fac parte din `make test` și din jobul `backend` din CI. Până
atunci au fost ținute separat (`test:auth`, jobul `auth-spec`), fiindcă picau contra rutelor `501`.

Testele au fost verificate pe o implementare de probă, care nu face parte din repozitoriu: toate
cele 477 trec pe ea, deci sunt coerente între ele și cu designul. Implementarea de probă nu este
un model de urmat: scopul ei a fost doar să găsească greșelile din teste.

## Fișiere

| Fișier                       | Teste | Subiect                                             | Design       |
| ---------------------------- | ----: | --------------------------------------------------- | ------------ |
| `register.test.ts`           |    30 | Înregistrarea                                       | 1, 2.1       |
| `login.test.ts`              |    16 | Autentificarea                                      | 3.2, 3.4     |
| `login-lockout.test.ts`      |    14 | Blocarea după încercări eșuate                      | 3.1, 3.2     |
| `session.test.ts`            |    31 | Cookie-ul, jetonul, `/auth/me`, deconectarea        | 2            |
| `access-control.test.ts`     |   195 | Hook-ul global: fiecare rută × fiecare rol          | 6.1, 6.2     |
| `csrf.test.ts`               |    16 | Verificarea originii                                | 2.5          |
| `rate-limit.test.ts`         |    13 | Limite per IP și per cont                           | 3.3          |
| `password-reset.test.ts`     |    36 | Cererea, confirmarea, curățarea                     | 4            |
| `preferences.test.ts`        |    18 | Preferințele                                        | —            |
| `account-export.test.ts`     |    11 | Exportul datelor                                    | 5.4          |
| `account-delete.test.ts`     |    16 | Ștergerea contului                                  | 5.1, 5.2     |
| `admin-accounts.test.ts`     |    19 | Blocare, ștergere, listare, crearea administratorului | 5.3, 6.2   |
| `logging.test.ts`            |    16 | Audit și ce nu se jurnalizează                      | 7            |
| `ownership.test.ts`          |    46 | „Doar datele proprii”, pe toate rutele de student   | 6.3          |

## Cazuri și cerințe

### UC-01 „Creează cont” — RF1

| Caz                                                                                   | Cerință            | Fișier              |
| ------------------------------------------------------------------------------------- | ------------------ | ------------------- |
| Cont creat: `201`, utilizator `student` activ, expirarea sesiunii                     | RF1, UC-01         | `register`          |
| Înregistrarea autentifică: cookie de sesiune                                          | SRS 3.2.1.1        | `register`          |
| Parola stocată doar ca hash bcrypt, cu costul configurat; sare diferită               | RNF6, ADR-0010     | `register`          |
| Data acordului GDPR consemnată                                                        | RF1, RNF8          | `register`          |
| Preferințele create cu valorile implicite                                             | C-23, Q5           | `register`          |
| E-mail normalizat (spații, majuscule)                                                 | RF1, design 1.1    | `register`          |
| Rolul din corp este ignorat: întotdeauna `student`                                    | SRS 3.7.2          | `register`, `admin-accounts` |
| Limite: 8 și 64 de caractere, litere din orice alfabet, parola nemodificată           | RF1                | `register`          |
| Date invalide (12 variante) → `400 INVALID_REGISTRATION_DATA`, fără cont, fără cookie | RF1, M01           | `register`          |
| Parolă peste 72 de octeți → `PASSWORD_TOO_LONG`, cu limita în mesaj; exact 72 acceptat | Q34, ADR-0010     | `register`          |
| E-mail existent (și cu altă scriere) → `409 EMAIL_ALREADY_EXISTS`; contul existent neschimbat | RF1, M02   | `register`          |
| Trei înregistrări simultane cu aceeași adresă: exact una reușește                     | RF1 (unicitate)    | `register`          |

### UC-02 „Se autentifică” — RF2

| Caz                                                                                   | Cerință            | Fișier              |
| ------------------------------------------------------------------------------------- | ------------------ | ------------------- |
| Autentificare reușită: `200`, cookie, expirare la 24 h                                | RF2                | `login`             |
| E-mail în orice scriere; parola sensibilă la majuscule                                | RF1, RF2           | `login`             |
| Parolă greșită → `401 INVALID_CREDENTIALS`                                            | RF2, M03           | `login`             |
| E-mail inexistent → răspuns identic                                                   | design 3.4         | `login`             |
| Eșecul se numără; succesul resetează contorul                                         | RF2                | `login`             |
| Cerere malformată → `400 VALIDATION_ERROR`                                            | SRS 3.2.4.1        | `login`             |
| Cont blocat de administrator: `403` cu parola corectă, M03 cu cea greșită             | RF21, Q36          | `login`             |
| Rehash la schimbarea costului, fără a strica sesiunea nouă                            | ADR-0010           | `login`             |
| Primele 4 greșeli `401`; a 5-a `429 ACCOUNT_TEMPORARILY_LOCKED`, blocare 15 minute    | RF2, M03, C-17     | `login-lockout`     |
| Timpul rămas: `retry_after_seconds` și `Retry-After`; scade                           | C-12               | `login-lockout`     |
| Cât e blocat, și parola corectă primește `429`; blocarea nu se prelungește            | RF2                | `login-lockout`     |
| După 15 minute contul revine singur la activ; contorul repornește de la zero          | C-17, EV12         | `login-lockout`     |
| Contează doar greșelile consecutive                                                   | RF2                | `login-lockout`     |
| Contorul este per cont; scrierea e-mailului nu contează                               | RF2                | `login-lockout`     |
| Adresă fără cont: niciodată „blocată”                                                 | Q35                | `login-lockout`     |
| Blocarea rezistă la repornirea serverului                                             | C-17               | `login-lockout`     |
| Numărul de încercări și durata vin din configurare                                    | design 0           | `login-lockout`     |
| Cinci greșeli simultane nu ocolesc contorul                                           | RF2                | `login-lockout`     |
| Cookie `HttpOnly`, `SameSite=Lax`, `Path=/`, 24 h; `Secure` doar în producție         | RNF6, ADR-0005     | `session`           |
| Jeton HS256 cu `sub`, `iat`, `exp`, `pfp`; fără e-mail, fără rol, fără părți din hash | RFC 7519, ADR-0011 | `session`           |
| `/auth/me`: utilizatorul și expirarea; sesiunea nu se prelungește                     | RF2, Q41           | `session`           |
| Fără cookie → `401 UNAUTHENTICATED` (ecranul D15)                                     | C-11               | `session`           |
| 14 jetoane respinse (expirat, alt secret, `alg: none`, HS512, modificat, amprentă greșită…) | RNF6, OWASP  | `session`           |
| Jetonul respins este șters din browser                                                | C-11               | `session`           |
| Deconectare: `204`, cookie șters; cere sesiune                                        | RF2                | `session`           |

### UC-03 „Resetează parola” — RF2, C-24

| Caz                                                                                   | Cerință            | Fișier              |
| ------------------------------------------------------------------------------------- | ------------------ | ------------------- |
| Cerere: `202` fără corp; link către pagina de resetare; jeton de 256 de biți          | RF2, UC-03         | `password-reset`    |
| În bază doar hash-ul SHA-256 al jetonului                                             | C-24               | `password-reset`    |
| Linkul expiră după o oră (configurabil)                                               | RF2, C-24          | `password-reset`    |
| Adresă fără cont: răspuns identic, nimic trimis                                       | design 3.4         | `password-reset`    |
| Răspuns `202` și când e-mailul nu poate fi trimis                                     | C-01               | `password-reset`    |
| Cont blocat temporar poate cere; cont blocat de administrator nu primește             | Q36                | `password-reset`    |
| Confirmare: `204`, parolă nouă, fără sesiune nouă                                     | RF2                | `password-reset`    |
| Link folosit o singură dată; link expirat respins; răspuns identic pentru toate       | C-24               | `password-reset`    |
| Parolă nouă invalidă (6 variante): respinsă fără a consuma linkul                     | RF1, Q34           | `password-reset`    |
| Reușita anulează celelalte linkuri; până atunci, mai multe sunt valabile              | Q39, Dosar T5.3    | `password-reset`    |
| Reușita închide toate sesiunile contului, nu și pe ale altora                         | ADR-0011           | `password-reset`    |
| Reușita ridică blocarea temporară, nu și pe cea a administratorului                   | Q38                | `password-reset`    |
| Două confirmări simultane cu același link: exact una reușește                         | C-24               | `password-reset`    |
| Curățarea linkurilor expirate și folosite; sarcină de worker, o dată pe oră           | SRS 2.1.7          | `password-reset`    |
| Cel mult N linkuri pe oră per cont, cu răspuns tot `202`                              | Q33                | `rate-limit`        |

### UC-11 „Modifică setările” — RF18, C-23

| Caz                                                                                   | Cerință            | Fișier              |
| ------------------------------------------------------------------------------------- | ------------------ | ------------------- |
| Valorile implicite ale unui cont nou                                                  | C-23, Q5           | `preferences`       |
| Ora în format `HH:MM`                                                                 | RF18               | `preferences`       |
| Modificare parțială; toate câmpurile din RF18; modificare goală                       | RF18               | `preferences`       |
| 8 valori invalide respinse cu `400`, fără nicio schimbare                             | RF18, SRS 3.2.4.1  | `preferences`       |
| Fiecare utilizator are preferințele lui; identificatorii din corp sunt ignorați       | RNF7               | `preferences`       |

### UC-12 „Exportă sau șterge datele” — RF20

| Caz                                                                                   | Cerință            | Fișier              |
| ------------------------------------------------------------------------------------- | ------------------ | ------------------- |
| Export JSON: fișier datat, cu cont, preferințe, materii, concepte, rezultate, progres | RF20               | `account-export`    |
| Doar datele proprii; nicio parolă, niciun jeton                                       | RNF7, RNF8         | `account-export`    |
| Export CSV: arhivă ZIP cu câte un fișier pe set                                       | RF20, Q11          | `account-export`    |
| Doar pentru studenți; format necunoscut respins                                       | SRS 3.7.2          | `account-export`    |
| Ștergere cu parola corectă: `204`, cookie șters                                       | RF20               | `account-delete`    |
| Tot ce aparține utilizatorului dispare imediat, inclusiv documentele șterse logic     | RF20, SRS 3.4      | `account-delete`    |
| Jurnalul apelurilor rămâne, fără legătură cu contul                                   | C-20               | `account-delete`    |
| Celelalte conturi rămân neatinse                                                      | RNF7               | `account-delete`    |
| Fișierele se șterg după baza de date, o singură dată; eșecul lor nu anulează ștergerea | Q43               | `account-delete`    |
| Sesiunea veche moare; credențialele vechi dau M03; adresa poate fi reînregistrată     | RF20               | `account-delete`    |
| Parolă greșită → `403 PASSWORD_CONFIRMATION_FAILED`, nimic șters, nu se numără la blocare | RF20, M10      | `account-delete`    |
| Nu poate fi îndreptată spre alt cont; un administrator nu o poate folosi              | RNF7, Q37          | `account-delete`    |

### UC-13 „Gestionează conturile” — RF21 (partea din serviciul `auth`)

| Caz                                                                                   | Cerință            | Fișier              |
| ------------------------------------------------------------------------------------- | ------------------ | ------------------- |
| Blocarea are efect la următoarea cerere; deblocarea redă accesul                      | RF21, ADR-0011     | `admin-accounts`, `access-control` |
| Blocarea nu șterge nimic                                                              | RF21               | `admin-accounts`    |
| `CONFLICT` pentru acțiuni fără efect; `NOT_FOUND` pentru cont inexistent              | design 5.3         | `admin-accounts`    |
| Un cont de administrator nu poate fi blocat sau șters                                 | Q37                | `admin-accounts`    |
| Ștergerea de către administrator = ștergerea de către student, fără parolă            | RF21               | `admin-accounts`    |
| Lista: e-mail, data creării, stare, rol, număr de documente; căutare, filtru, paginare | RF21              | `admin-accounts`    |
| Un student nu poate apela aceste funcții                                              | SRS 3.7.2          | `admin-accounts`    |
| Crearea administratorului doar din linia de comandă, cu aceeași politică de parolă    | SRS 2.1.8, Q21     | `admin-accounts`    |

### Cerințe transversale

| Caz                                                                                   | Cerință            | Fișier              |
| ------------------------------------------------------------------------------------- | ------------------ | ------------------- |
| Fiecare rută protejată × vizitator → `401`                                            | SRS 3.7.2, C-11    | `access-control`    |
| Fiecare rută de administrare × student → `403`                                        | SRS 3.7.2          | `access-control`    |
| Fiecare rută de student × administrator → `403`                                       | SRS 3.4            | `access-control`    |
| Refuzul vine înaintea validării: nu se scurg detalii                                  | design 6.1         | `access-control`    |
| Rolul și starea se citesc din bază la fiecare cerere                                  | ADR-0011           | `access-control`    |
| Fiecare rută de student cu identificator × alt student → `404`, nimic modificat       | RNF7               | `ownership`         |
| Identificatori străini în corp și în filtre → `404` sau listă goală                   | RNF7               | `ownership`         |
| Cerere de pe altă origine → `403 ORIGIN_NOT_ALLOWED`, inclusiv pe rutele publice și la încărcare | SRS 3.5.1, OWASP | `csrf`      |
| `GET` nu este verificat; originea permisă vine din `APP_BASE_URL`                     | ADR-0011           | `csrf`              |
| Limită per IP pe rutele publice de cont; cererea respinsă nu face nimic               | Q33                | `rate-limit`        |
| `X-Forwarded-For` ignorat fără `TRUST_PROXY`                                          | design 3.3         | `rate-limit`        |
| Niciun secret în jurnal: parole, hash-uri, jetoane, linkuri, cookie-uri, e-mailuri    | SRS 3.6.3, RNF6    | `logging`           |
| Evenimente de audit pentru autentificări eșuate, blocări, ștergeri, acțiuni de administrator | SRS 2.4, 3.6.3 | `logging`        |

## Ce nu acoperă testele

- **Timpul de răspuns egal** pentru e-mail inexistent (design 1.4): o măsurătoare de timp ar fi
  instabilă în CI. Rămâne în lista de verificare a recenziei.
- **Rutele de administrare** (`/admin/users…`): sunt ale Segmentului 7. Aici se testează doar
  funcțiile serviciului pe care se vor sprijini.
- **Trimiterea reală a e-mailului** (Segmentul 8) și **ștergerea reală a fișierelor**
  (Segmentul 2): testele folosesc înregistratoare în locul lor.
- **Datele legate doar de sesiune** ale altor module (`/progress/…`, `/reviews/…`): suita de
  proprietate nu le poate verifica generic; fiecare segment scrie verificarea cu `twoStudents()`.
- **Riscul acceptat** din ADR-0011 (jeton valid după deconectare): nu există test, fiindcă nu
  este un comportament dorit, ci unul tolerat.
