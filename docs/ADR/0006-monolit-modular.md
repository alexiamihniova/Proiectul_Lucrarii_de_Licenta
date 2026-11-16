# ADR-0006: Monolit modular, module pe segmente

Stare: Acceptat · Data: 2026-11-12

## Context

Proiectul se construiește în segmente (conturi, documente, nucleul LLM, materiale și teste,
stăpânire, interfață, administrare, e-mail), de sesiuni diferite, care nu văd conversațiile
celorlalte. Fără granițe verificate automat, logica unui segment ajunge în modulul altuia.

## Decizie

- Un singur serviciu backend, împărțit în `src/modules/<modul>/`, câte un modul pe segment:
  `auth`, `documents`, `analysis`, `llm`, `content`, `mastery`, `reminders`, `admin`.
- Fiecare modul are `router.ts`, `schemas.ts`, `service.ts`, `repository.ts`.
- **Un modul importă din altul numai `service.ts`.** Regula este impusă de ESLint
  (`no-restricted-imports`), deci o încălcare pică `make lint` și CI.
- `core/` conține doar infrastructură, fără reguli de business.
- Schema bazei de date este comună (`db/schema/`), dar fiecare tabel are un singur modul care
  scrie în el.

## Alternative respinse

- **Microservicii** (un serviciu pe segment). Rețea, implementări și tranzacții distribuite
  pentru un proiect individual; RNF10 (scalarea) este Won't.
- **Structură pe straturi** (`routes/`, `services/`, `repositories/` la rădăcină). Codul unui
  segment ar fi fost răspândit în trei directoare, fără o graniță pe care o unealtă să o verifice.
- **Regulă doar în documentație**. Sesiunile următoare nu au contextul acesteia; o regulă
  neverificată se pierde.
- **Pachete npm separate** (workspaces) pentru fiecare modul. Granițe mai puternice, dar
  configurare de build și versiuni pentru opt pachete.

## Consecințe

- Un segment lucrează aproape numai în modulul lui; ce are nevoie de la altul cere prin
  `service.ts` al aceluia (lista exporturilor așteptate este în comentariul fiecărui `service.ts`).
- Formele API comune stau în `core/api-schemas.ts`.
- Dependențele între module trebuie să rămână aciclice: `llm` ← `analysis` ← `content` →
  `mastery`; `admin` și `reminders` citesc din celelalte. Un ciclu este semn că o funcție stă în
  modulul greșit.
