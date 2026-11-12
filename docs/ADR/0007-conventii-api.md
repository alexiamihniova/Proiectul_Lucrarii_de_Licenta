# ADR-0007: Convențiile API și contractul generat din cod

Stare: Acceptat · Data: 2026-11-12

## Context

Frontendul și segmentele următoare lucrează pe contract înainte ca logica să existe. Prototipul
avea deja formatul de eroare `{ error: { code, message } }`.

## Decizie

- Prefix **`/api/v1`**; `/health` și la rădăcină.
- **`snake_case`** în JSON, în parametrii de cale și de interogare; identificatori întregi;
  timp ISO 8601 UTC; date `YYYY-MM-DD`.
- **Eroare unică**: `{ "error": { "code", "message", "details" } }`. `code` vine din catalogul
  `core/errors.ts`; mesajele M01–M09 din SRS sunt intrări ale catalogului. M10 este un dialog de
  confirmare afișat de interfață, nu o eroare a serverului.
- **Paginare unică**: `?page=&page_size=` (implicit 20, maxim 100) →
  `{ items, total, page, page_size }`.
- **Toate rutele se declară cu `endpoint()`**, care stabilește împreună documentația, nivelul de
  acces și răspunsurile de eroare. Aplicația nu pornește dacă o rută nu își declară accesul.
- Rutele neimplementate răspund **`501 NOT_IMPLEMENTED`**.
- `docs/openapi.json` și tipurile frontendului se **generează**; CI verifică prospețimea.
- Acțiunile care nu sunt CRUD sunt sub-resurse cu `POST`: `/documents/{id}/reprocess`,
  `/concepts/{id}/merge`, `/tests/{id}/finish`, `/account/delete`.

## Alternative respinse

- **`camelCase` în JSON**. Ar fi cerut o conversie între coloanele `snake_case` și API, în
  ambele sensuri, fără niciun folos pentru utilizator.
- **Erori în format RFC 9457 (`application/problem+json`)**. Standard, dar ar fi rupt formatul
  deja folosit de prototip și nu aduce nimic pentru un singur client.
- **Paginare cu cursor**. Potrivită pentru fluxuri mari; listele de aici au zeci sau sute de
  rânduri, iar interfața are nevoie de totalul afișat.
- **OpenAPI scris de mână** („contract-first”). Se abate de la cod la prima modificare.
- **`DELETE /account` cu corp** pentru confirmarea cu parolă. Corpul la `DELETE` este tratat
  inconsecvent de proxy-uri; s-a ales `POST /account/delete`.
- **Rute goale care răspund `200` cu date false**. Frontendul ar fi părut funcțional fără să fie.

## Consecințe

- Frontendul tratează erorile într-un singur loc (`frontend/src/api/client.ts`).
- Un cod de eroare nou se adaugă în catalog, nu ca șir într-un modul.
- Schimbarea unei forme de contract de către un segment este permisă, dar explicită: schema,
  `make openapi`, mențiune în descrierea commit-ului.
