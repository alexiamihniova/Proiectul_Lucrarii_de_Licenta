# ADR-0001: Fastify + TypeScript + Zod, nu Express

Stare: Acceptat · Data: 2026-11-12

## Context

SRS 2.4 fixează tehnologiile: React, Node.js, PostgreSQL. Prototipul existent
(`legacy/express/`) era Express în JavaScript (CommonJS), fără validare a cererilor, fără tipuri
și fără documentație de API. Fundația trebuie să ofere un contract complet (UC-01..UC-17) pe
care lucrează frontendul și celelalte segmente, construite de sesiuni diferite. Contractul nu
are voie să se abată de la cod.

## Decizie

- **Node.js 24 + TypeScript strict** pentru backend.
- **Fastify 5** ca server HTTP.
- **Zod 4** pentru scheme, cu **fastify-type-provider-zod**: aceeași schemă validează cererea,
  dă tipurile handlerului și serializează răspunsul.
- **@fastify/swagger** generează OpenAPI din schemele rutelor; `docs/openapi.json` se exportă
  din cod, iar un test și CI verifică faptul că fișierul este la zi.
- Teste cu **Vitest**; **ESLint + Prettier**; `tsc --noEmit` în CI.

## Alternative respinse

- **Express (continuarea prototipului)**. Nu are scheme de rută: validarea, tipurile și OpenAPI
  ar fi trei artefacte întreținute separat (de exemplu express-validator + tipuri scrise de mână
  + un fișier OpenAPI scris de mână), care se abat unul de altul. Tocmai asta trebuie evitat
  când contractul este folosit de alte sesiuni.
- **NestJS**. Rezolvă aceleași probleme, dar cu decoratori, injecție de dependențe și mult cod
  de structură; prea mult pentru un proiect individual cu termen fix (SRS 3.5, punctul 6).
- **Python + FastAPI** (propunerea inițială). Ar fi contrazis SRS 2.4 și ar fi cerut apărarea
  abaterii în teză, fără un câștig care să o justifice.
- **JSON Schema scris de mână sau TypeBox** în loc de Zod. Mai rapide la rulare, dar Zod
  exprimă direct regulile din SRS (rafinări, mesaje, transformări) și este folosit și pentru
  configurare și pentru răspunsurile modelului de limbaj: o singură bibliotecă de validare.

## Consecințe

- O rută se declară o singură dată; schimbarea schemei schimbă validarea, tipurile și OpenAPI.
- Dependențe: `fastify`, `zod`, `fastify-type-provider-zod`, `@fastify/swagger`,
  `@fastify/swagger-ui` (interfața `/docs`, doar în afara producției), `@fastify/multipart`
  (încărcarea fișierelor), `pino` (jurnal; vine oricum cu Fastify).
- Biblioteca de legătură emite în OpenAPI și variante `…Input` ale schemelor de cerere (forma
  trimisă, înainte de valorile implicite). `core/openapi.ts` le elimină pe cele nefolosite.
- Frontendul folosește TypeScript 5.x, pentru că `openapi-typescript` nu acceptă încă 6.x;
  backendul folosește 6.x. Se aliniază când generatorul permite.
