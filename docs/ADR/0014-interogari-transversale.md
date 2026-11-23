# ADR-0014: Interogările de citire transversale stau într-un singur loc

Stare: Acceptat (23.11.2026, Q50) · Data: 23.11.2026 · Se implementează în Segmentul 2B

## Context

Regula 4 din `CLAUDE.md` spune că numai `repository.ts` interoghează baza de date, iar regula 1,
că modulele comunică numai prin `service.ts`. Două funcții cer date din mai multe module înainte
ca acestea să existe: exportul contului (RF20), care citește materii, concepte, teste, răspunsuri
și progres, și numărătorile unei materii (`concept_count`, `due_concept_count`). În Segmentul 1B
exportul a citit direct tabelele altor module, din `auth/repository.ts` (Q45): o excepție
nedeclarată, greu de găsit și de verificat.

## Decizie

- Un singur modul, `backend/src/modules/shared-queries/`, conține **toate** interogările de
  citire peste tabelele altor module. Intrarea sa publică este `service.ts`, ca la orice modul.
- Excepția din ESLint (importul din `db/` în afara unui `repository.ts`) se aplică **numai** acestui
  folder. Nicio altă excepție, nici pe fișier.
- Regulile funcțiilor: numai citire; primul parametru este un `UserActor` și fiecare interogare
  filtrează după `actor.userId`; coloanele sunt enumerate, fără `SELECT *`; nu exportă textul
  documentelor, pasajele și materialele generate decât dacă ruta care o folosește o cere.
- Modulele de business le apelează prin `shared-queries/service.ts`; nu citesc ele tabelele altor
  module.
- Se mută acolo: `readStudyData` (de la `auth`) și numărătorile de concepte ale materiilor.

## Alternative respinse

- **Citire directă în fiecare modul, cu comentariu.** Excepțiile s-ar răspândi și nu s-ar mai
  putea verifica cu o singură regulă.
- **Servicii ale modulelor proprietare.** Corect pe termen lung, dar serviciile nu există până la
  Segmentele 3–5, iar numărătoarea pe materie ar însemna un apel pentru fiecare rând al listei.
- **Excepție ESLint pe fișier.** Mai greu de ținut la zi și de revizuit decât un folder întreg.

## Consecințe

- 2B adaugă modulul, excepția ESLint și mută exportul din `auth` (a doua parte atinge cod din
  Segmentul 1). Testele din `tests/auth/` rămân neschimbate și se rulează **înainte** de mutare
  (trec) și **după** (trebuie să treacă).
- Un test cu doi studenți verifică, pentru fiecare funcție, că nu întoarce datele altuia.
- Lista funcțiilor din `shared-queries` este în `docs/design/documents-checklist.md` și se
  revizuiește la fiecare segment: ce poate trece pe serviciul unui modul proprietar trece. Segmentul 5
  are obligația din Q45 pentru export.
