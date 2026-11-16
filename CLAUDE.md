# CLAUDE.md

Guidance for every session that continues this project. Read it fully before changing anything.

## What this is

A web application for active, adaptive revision of university course material (bachelor thesis).
A student uploads documents (PDF, DOCX, TXT); one language model, called only from the server,
extracts concepts and generates materials and tests whose source is verified; the app computes
mastery per concept and schedules reviews with SM-2.

The project is built in segments by different sessions. **Segment 0 (foundation) and Segment 1
(accounts and access) are done**: schema, API contracts (stubs answering 501 outside `auth`),
config, `LLMClient` interface, dev infrastructure, sessions and roles. Your job is one of
Segments 2–8.

Specifications (Romanian) are the source of truth for behaviour:

- `docs/SRS_Specificarea_Cerintelor_Software.docx` — requirements RF1–RF25, RNF1–RNF16, formulas.
- `docs/Dosar_Modele_Vizuale_Cerinte.pdf` — state table, decision table R1–R5, UC-01..UC-17, ERD,
  found requirements C-01..C-24.

Project documents: `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md` (Romanian ↔ English names),
`docs/ADR/`, `docs/OPEN_QUESTIONS.md`, `docs/openapi.json`.

## Commands

Run from the repository root. `make help` lists everything.

| Task                                   | Command                                   |
| -------------------------------------- | ----------------------------------------- |
| Install dependencies                   | `make install`                            |
| Create `.env`                          | `make env`                                |
| Create local databases (no Docker)     | `make db-create`                          |
| Run everything locally (no Docker)     | `make dev`                                |
| Run everything in Docker               | `make up` / `make down`                   |
| Apply / revert / list migrations       | `make migrate` / `make migrate-down` / `make migrate-status` |
| Seed default settings                  | `make seed`                               |
| Create an administrator account        | `make admin EMAIL=<address>`              |
| All tests                              | `make test`                               |
| One backend test file                  | `npm --prefix backend test -- tests/config.test.ts` |
| Lint + format check + typecheck        | `make lint`                               |
| Fix formatting                         | `make format`                             |
| Regenerate `openapi.json` + API types  | `make openapi`                            |
| Generate a migration after a schema change | `npm --prefix backend run db:generate -- --name <what_changed>` |
| Check generated files are current      | `make check-generated`                    |

Before you say a task is done: `make lint && make test && make check-generated` must pass.

Backend tests need a PostgreSQL database at `TEST_DATABASE_URL`; they drop and recreate every
table in it. Without Docker, use a local PostgreSQL (`make db-create`); the Compose stack is
verified by the `compose` job in CI.

## Hard rules

1. **Modules talk to each other only through `service.ts`.** Code in `backend/src/modules/<a>/`
   may import from another module only `../<b>/service.js`. Never its `router`, `repository` or
   `schemas`. ESLint enforces this; do not disable the rule.
2. **A segment's logic lives only in its own module.** Do not write another segment's logic
   anywhere else, not even "temporarily". If you need something that belongs to a segment that is
   not built yet, call the function its `service.ts` is expected to export (listed in the comment
   at the top of each `service.ts`) and, if it is missing, add a clearly marked stub there that
   throws `AppError('NOT_IMPLEMENTED')`. Never implement it in your module.
3. **`core/` holds infrastructure only**, no business rules. Shapes shared by several modules go
   in `core/api-schemas.ts`; closed value sets go in `core/domain.ts`.
4. **Only `repository.ts` queries the database.** Routers and schemas never import from `db/`.
5. **Every route is declared with `endpoint()`** (`core/http.ts`). The app refuses to start
   otherwise. Routers never check roles or read cookies: the one global `onRequest` hook of the
   auth module does, from `config.auth`, and sets `request.user` and `request.actor`.
   **Repository functions that touch user-owned data take a `UserActor` (`core/actor.ts`) as
   their first parameter** and filter by `actor.userId`; another user's resource answers `404`.
6. **Errors**: throw `new AppError('CODE', details?)`. Add new codes to the catalogue in
   `core/errors.ts`. Never send an ad-hoc error body.
7. **RB1 has one implementation.** Source verification (passage exists in the document, quote
   found in the passage) lives in the `analysis` module. `content` calls it; nobody copies it.
   Nothing generated is saved or shown unless its source is verified.
8. **Formulas have one home.** Mastery (RB2) and SM-2 (RB3) live in `mastery`, as pure functions
   with tests. Thresholds and parameters come from settings (`admin` service), never constants.
9. **The model is reached only through `LLMClient`** (`modules/llm/service.ts`). No provider SDK
   or HTTP call to a model anywhere else. The API key never leaves the server and is never logged.
10. **Do not edit generated files by hand**: `docs/openapi.json`, `frontend/src/api/schema.d.ts`,
    `backend/drizzle/meta/*`. Regenerate them.
11. **Do not invent** entities, fields or rules that contradict the SRS or the dossier. If the
    documents are ambiguous or contradict each other, add an entry to `docs/OPEN_QUESTIONS.md`
    with a proposal and say what you did meanwhile. Do not decide silently.
12. **No new dependency without a reason** stated in an ADR or in the commit message.
13. **Never commit secrets.** `.env` is ignored; new variables go in `.env.example` and in
    `core/config.ts` together.

## Conventions

- TypeScript strict, ESM. Imports of local files end in `.js` (NodeNext). Use `import type` for
  types. No `console.*` in backend code: use `request.log` / `app.log`.
- Names: code, tables, columns and commit messages in English; user-facing messages in Romanian.
  JSON and database names are `snake_case`; TypeScript names are `camelCase`.
- API: prefix `/api/v1`; integer ids; ISO 8601 UTC timestamps; `YYYY-MM-DD` dates; errors as
  `{ error: { code, message, details } }`; lists as `{ items, total, page, page_size }`.
- Each operation's `summary` starts with the use cases it serves: `[UC-04] …`.
- Implementing a stub: replace `handler: notImplemented` with the real handler and keep the
  schema. If the contract must change, change the Zod schema, run `make openapi`, and mention the
  change in the commit message. A test checks that all UC-01..UC-17 stay covered.
- Schema change: edit `backend/src/db/schema/`, run `db:generate`, then **write the inverse by
  hand** in `backend/drizzle/down/<same name>.sql`, update `docs/DATA_MODEL.md`. Never edit an
  applied migration; add a new one.
- Every query on user data filters by the current user; someone else's resource answers `404`.
- Deleted documents (`status = 'deleted'`) are never returned by the API.
- Tests live in `backend/tests/` (Vitest, real PostgreSQL) and next to the code in
  `frontend/src/`. Use `FakeLLMClient` for anything that touches the model.
- In tests, act as a user through `tests/helpers/session.ts` (`registerStudent`,
  `registerAdmin`); never build cookies or insert users by hand. When a segment implements
  routes, it adds its tag to `IMPLEMENTED_TAGS` in `tests/api-contract.test.ts`.
- `tests/helpers/authorization.ts` (`describeOwnership`) checks, for every student route of the
  contract, that another student gets `404`. It picks up new routes by itself; a route with a
  new kind of identifier fails it until you teach the helper to create that resource. Data
  scoped by the session alone (no identifier) needs a hand-written check with `twoStudents()`.
- Never change a test in `backend/tests/auth/` to make it pass; report it instead.
- One commit per step, imperative English message, body explaining why.
- Audit events (failed logins, account deletion, settings changes, admin actions) go through
  `auditLog()` in `core/logger.ts`.

## Where things are

```
backend/src/core/        config, errors, http helpers, logger, openapi, worker runtime, domain enums
backend/src/db/          schema (16 tables), client, migrate, seed
backend/src/modules/     auth, documents, analysis, llm, content, mastery, reminders, admin
backend/src/server.ts    HTTP entry point
backend/src/worker.ts    background worker entry point (register tasks in collectTasks())
backend/drizzle/         migrations: NNNN_name.sql (generated) + down/NNNN_name.sql (by hand)
backend/tests/           foundation tests; helpers/db.ts has row factories
frontend/src/api/        typed API client; schema.d.ts is generated
infra/                   Dockerfiles, docker-compose.yml
legacy/express/          old prototype, reference only for Segment 2; never import from it
```

## Segments

Each segment works in its module(s). The comment at the top of each `service.ts` lists what the
segment implements and what it must export for the others.

| # | Segment | Module(s) | In scope | Requirements |
| - | ------- | --------- | -------- | ------------ |
| 0 | Foundation (done) | `core`, `db`, all stubs | Schema, contracts, config, `LLMClient` interface and fake, infrastructure | — |
| 1 | Accounts (done) | `auth` | Registration, login, logout, session JWT in httpOnly cookie, the global auth hook and `request.user`, lock after 5 failures, password reset tokens, preferences, data export, account deletion, initial admin. Specification: `docs/design/auth.md`, `docs/design/auth-tests.md`, `backend/tests/auth/`; review list: `docs/design/auth-checklist.md` | RF1, RF2, RF18, RF20; C-11, C-12, C-17, C-23, C-24; UC-01, 02, 03, 11, 12 |
| 2 | Document processing | `documents` | Subjects CRUD, upload validation and storage, daily quota, text extraction and cleaning, passages, document state machine, soft delete, the worker task that claims queued documents | RF3–RF6; C-02, C-03, C-07, C-08, C-09, C-10; UC-04 |
| 3 | LLM core | `llm`, `analysis` | Real `LLMClient`, retries and `llm_calls` journal, concept extraction, **source verification**, concept management | RF7–RF9, RF23 (journal writes); C-06, C-14, C-22; UC-05, UC-17 |
| 4 | Materials and tests | `content` | Material generation with rules R1–R5, tests (configure, answer, evaluate, result), reports | RF10–RF13; C-04, C-05, C-13, C-15, C-19; UC-06, 07, 08 |
| 5 | Mastery and SM-2 | `mastery` | Mastery formula, SM-2, progress views, review queue and session, confetti flag | RF14–RF17; UC-09, UC-10 |
| 6 | Interface | `frontend/` | All screens (dialog map D1–D15), state polling, accessibility | RF5 viewer, RF17, RNF11, RNF13, RNF16 |
| 7 | Administration | `admin` | Accounts, usage statistics, model journal and cost alert, reported materials, settings, journal retention | RF21–RF25; C-20; UC-13–16 |
| 8 | E-mail | `reminders` | SMTP mailer, reset e-mail, daily reminders, unsubscribe, expired token cleanup | RF19; C-01, C-16, C-18, C-21 |

Allowed dependency direction between modules (no cycles):
`llm` ← `analysis` ← `content` → `mastery`; `documents` ← `analysis`; `auth` ← everyone;
`admin` and `reminders` read from the others; everyone may read settings from `admin`.

## Business rules to keep in view

- **RB1** — nothing generated is saved or shown unless the source passage exists in the document
  and the quote is found in it.
- **RB2** — mastery S = 100·Σ(wₖ·cₖ)/Σwₖ, wₖ = 0.8ᵏ, over the last 10 answers, rounded to an
  integer; statuses: > 80 mastered, 50–80 in progress, < 50 to review, no answers = new.
- **RB3** — SM-2: intervals 1 day, 6 days, then I·EF; EF ≥ 1.3; a wrong answer resets to 1 day.
- **Document states** — queued, processing, ready, error, deleted; transitions in
  `modules/documents/state-machine.ts`, also enforced by a database trigger.

- LLM: Gemini API, plan gratuit — vezi docs/ADR/0012-furnizor-llm.md. Orice segment care atinge
  generarea respectă constrângerile de acolo (cotă comună mică, 429, fără date personale în
  prompturi, grupare, generare la cerere, rezervă clasică). „Rezerva clasică” nu este încă
  definită: nu o implementa și nu începe Segmentele 3–4 până când autoarea o definește.

## Before starting a segment

1. Read `docs/ARCHITECTURE.md` and the ADRs.
2. Read the entries for your segment in `docs/OPEN_QUESTIONS.md`; ask the author about the open
   ones that block you.
3. Read your module's `service.ts` comment and the routes in its `router.ts`.
4. Plan first, wait for confirmation, then build in small steps with one commit per step.
