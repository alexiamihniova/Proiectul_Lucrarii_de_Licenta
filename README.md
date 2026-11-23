# Recapitulare activă

Aplicație web pentru recapitularea activă și adaptată a materialelor universitare (teză de
licență, UTM). Studentul încarcă documente de curs (PDF, DOCX, TXT); un singur model de limbaj,
apelat doar de pe server, extrage concepte și generează materiale și teste cu sursă verificată;
aplicația calculează stăpânirea pe concept și programează recapitularea cu SM-2.

**Starea curentă: Segmentele 0 (fundația) și 1 (conturi și acces).** Există schema bazei de date,
contractele API pentru toate cazurile de utilizare, configurarea, interfața către modelul de
limbaj, infrastructura de dezvoltare și conturile: înregistrare, autentificare, sesiune,
resetarea parolei, preferințe, export și ștergerea contului. Celelalte rute cer o sesiune și
răspund `501` până la implementare, în Segmentele 2–8.

## Documentație

| Fișier                                                    | Conținut                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)              | Straturi, fluxul unei cereri, procesele de fundal          |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md)                  | Cele 17 tabele, corespondența română–engleză, constrângeri |
| [docs/ADR/](docs/ADR/README.md)                           | Deciziile de arhitectură, câte una pe fișier               |
| [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md)          | Contradicții și lipsuri din specificații, cu propuneri     |
| [docs/design/auth.md](docs/design/auth.md)                | Proiectarea conturilor și a accesului (Segmentul 1)        |
| [docs/design/auth-tests.md](docs/design/auth-tests.md)    | Testele de conturi, trasate la cerințe                     |
| [docs/design/auth-checklist.md](docs/design/auth-checklist.md) | Lista de verificare pentru recenzia de securitate     |
| [docs/design/documents.md](docs/design/documents.md)      | Proiectarea materiilor și documentelor (Segmentul 2)       |
| [docs/design/documents-tests.md](docs/design/documents-tests.md) | Testele de documente, trasate la cerințe          |
| [docs/design/documents-checklist.md](docs/design/documents-checklist.md) | Lista de verificare pentru Segmentul 2   |
| [docs/openapi.json](docs/openapi.json)                    | Contractul API (generat din cod)                           |
| [CLAUDE.md](CLAUDE.md)                                    | Reguli și comenzi pentru sesiunile care continuă proiectul |
| `docs/SRS_Specificarea_Cerintelor_Software.docx`          | Cerințele RF1–RF25, RNF1–RNF16                             |
| `docs/Dosar_Modele_Vizuale_Cerinte.pdf`                   | DFD, stări, dialoguri, UC-01..UC-17, ERD, C-01..C-24       |

## Pornire de la zero

Sunt două moduri. Ambele pornesc aceleași procese: baza de date, API-ul, workerul și frontendul.

### Varianta A: cu Docker

Ai nevoie de Docker (cu Compose v2) și `make`.

```sh
git clone <adresa-repozitoriului> && cd Proiectul_Lucrarii_de_licenta
make up
```

`make up` creează `.env` din `.env.example` (cu un `SESSION_SECRET` aleator), construiește
imaginile, pornește PostgreSQL 16, aplică migrările, scrie setările implicite și așteaptă până
când serviciile sunt sănătoase.

| Adresă                         | Ce este                                  |
| ------------------------------ | ---------------------------------------- |
| http://localhost:5173          | Frontendul                               |
| http://localhost:3001/health   | Starea API-ului și a bazei de date       |
| http://localhost:3001/docs     | Documentația interactivă a API-ului      |
| `localhost:5433`               | PostgreSQL din container (utilizator și parolă `recap`) |

```sh
make logs                # jurnalele tuturor serviciilor
make migrate DOCKER=1    # aplică migrările în container
make down                # oprește (datele rămân în volum)
```

### Varianta B: fără Docker

Ai nevoie de Node.js 24 (vezi `.nvmrc`), `make` și un PostgreSQL local pe portul 5432
(de exemplu Postgres.app), cu `createdb` în `PATH`.

```sh
git clone <adresa-repozitoriului> && cd Proiectul_Lucrarii_de_licenta
make install      # dependențele backend și frontend
make env          # creează .env cu un SESSION_SECRET aleator
make db-create    # bazele recap_dev și recap_test
make migrate      # cele 17 tabele
make seed         # setările implicite
make dev          # API pe :3001, worker, frontend pe :5173
```

Dacă PostgreSQL-ul local cere utilizator și parolă, modifică `DATABASE_URL` și
`TEST_DATABASE_URL` în `.env`.

### Verificare

```sh
curl http://localhost:3001/health
# {"status":"ok","database":"connected","uptime_seconds":12}

curl http://localhost:5173/api/v1/health      # același răspuns, prin proxy-ul frontendului

curl http://localhost:3001/api/v1/subjects
# {"error":{"code":"UNAUTHENTICATED","message":"…"}}   (fără sesiune; cu sesiune: NOT_IMPLEMENTED)
```

Primul cont de administrator se creează de pe server (studenții se înregistrează singuri):

```sh
make admin EMAIL=admin@example.com    # cere parola de două ori, fără să o afișeze
```

Până la Segmentul 8 nu se trimit e-mailuri: în dezvoltare, legătura de resetare a parolei apare
în jurnalul backendului.

## Comenzi

`make help` le afișează pe toate.

| Comandă                | Efect                                                                         |
| ---------------------- | ----------------------------------------------------------------------------- |
| `make up` / `make down` | Pornește / oprește tot în Docker                                             |
| `make dev`             | Pornește tot pe mașina locală, fără Docker                                    |
| `make migrate`         | Aplică migrările în așteptare                                                 |
| `make migrate-down`    | Anulează ultima migrare                                                       |
| `make migrate-status`  | Arată migrările și dacă sunt aplicate                                         |
| `make seed`            | Scrie setările implicite care lipsesc                                         |
| `make admin EMAIL=…`   | Creează un cont de administrator; parola se cere interactiv                   |
| `make test`            | Testele backend (au nevoie de `TEST_DATABASE_URL`) și frontend                |
| `make test-documents`  | Temporar: specificația materiilor și documentelor, care pică până la Segmentul 2B |
| `make lint`            | ESLint, Prettier și `tsc --noEmit`, backend și frontend                       |
| `make format`          | Rescrie fișierele cu Prettier                                                 |
| `make openapi`         | Regenerează `docs/openapi.json` și tipurile frontendului                      |
| `make check-generated` | Verifică faptul că fișierele generate și migrările sunt la zi                 |

Testele backend **șterg și recreează toate tabelele** din baza indicată de `TEST_DATABASE_URL`.
Suita refuză să pornească dacă numele bazei nu conține „test”.

## Configurare

Toate valorile vin din variabile de mediu, descrise în [.env.example](.env.example). Serverul le
validează la pornire și se oprește, cu lista problemelor, dacă lipsește una obligatorie:
`DATABASE_URL`, `SESSION_SECRET` (cel puțin 32 de caractere), `SMTP_HOST`, `SMTP_FROM` și, când
`LLM_PROVIDER` nu este `fake`, `LLM_API_KEY` și `LLM_MODEL`.

`.env` nu se comite. Cu `LLM_PROVIDER=fake` (implicit) aplicația folosește un model fals,
determinist, fără cheie și fără rețea; în producție este refuzat.

## Structură

```
backend/    API Fastify + worker (TypeScript), migrări, teste
frontend/   React + TypeScript + Vite (schelet)
infra/      Dockerfile-uri și docker-compose.yml
docs/       specificații, arhitectură, model de date, ADR, întrebări deschise, openapi.json
legacy/     prototipul Express inițial, doar ca referință
```

Backendul este împărțit în module care corespund segmentelor: `auth`, `documents`, `analysis`,
`llm`, `content`, `mastery`, `reminders`, `admin`. Detalii în
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Segmentele următoare

| Segment | Conținut                               | Modul                     |
| ------- | -------------------------------------- | ------------------------- |
| 1       | Conturi, sesiune, preferințe, date personale | `auth`              |
| 2       | Materii, încărcare, extragere de text, pasaje, stările documentului | `documents` |
| 3       | Nucleul LLM: clientul real, extragerea conceptelor, verificarea surselor | `llm`, `analysis` |
| 4       | Materiale și teste                     | `content`                 |
| 5       | Stăpânire și SM-2                      | `mastery`                 |
| 6       | Interfața                              | `frontend/`               |
| 7       | Administrare                           | `admin`                   |
| 8       | E-mail și memento-uri                  | `reminders`               |

Înainte de a începe un segment: citește [CLAUDE.md](CLAUDE.md), secțiunea segmentului din
`service.ts` al modulului și întrebările din [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md)
marcate pentru acel segment.

## Integrare continuă

`.github/workflows/ci.yml` rulează la fiecare push pe `main` și la fiecare pull request:

- **backend**: lint, verificare de tipuri, migrările pe un PostgreSQL 16 gol (aplicare, anulare,
  reaplicare), teste, prospețimea `openapi.json` și a migrărilor;
- **frontend**: lint, tipuri, prospețimea tipurilor API, teste, build;
- **compose**: `make up` de la zero, `/health`, proxy-ul frontendului, cele 17 tabele.
