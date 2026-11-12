# ADR-0005: Sesiune JWT în cookie httpOnly, aceeași origine

Stare: Acceptat · Data: 2026-11-12 · Implementarea aparține Segmentului 1

## Context

RF2 și RNF6 cer un jeton de sesiune semnat, valabil cel mult 24 de ore (RFC 7519), și
deconectare. SRS 3.5.1 cere protecție împotriva riscurilor OWASP, inclusiv falsificarea
cererilor. Fundația fixează doar mecanismul și configurarea (`SESSION_SECRET`,
`SESSION_TTL_HOURS`, `SESSION_COOKIE_NAME`).

## Decizie

- Sesiunea este un **JWT semnat (HS256)** cu `SESSION_SECRET`, cu durata `SESSION_TTL_HOURS`
  (cel mult 24), păstrat într-un **cookie `HttpOnly`, `SameSite=Lax`, `Secure` în producție**.
- Frontendul și API-ul au **aceeași origine**: Vite (în dezvoltare) sau serverul web (în
  producție) trimite `/api` către backend. Nu se configurează CORS.
- Deconectarea șterge cookie-ul. La fiecare cerere, hook-ul de autentificare citește
  utilizatorul din baza de date, deci un cont blocat sau șters pierde accesul imediat.
- În OpenAPI schema de securitate este `cookieAuth`.

## Alternative respinse

- **JWT în `localStorage`, trimis în antetul `Authorization`**. Orice script injectat (XSS) îl
  poate citi; cookie-ul `HttpOnly` nu este accesibil din JavaScript.
- **Sesiuni pe server** (identificator opac + tabel de sesiuni). Permit revocare individuală, dar
  cer o a 17-a entitate, fără corespondent în SRS, care menționează explicit JWT.
- **Jeton de reîmprospătare**. Complexitate inutilă când SRS limitează sesiunea la 24 de ore și
  prevede ecranul „Sesiune expirată” (C-11).
- **Origini diferite + CORS**. Ar cere `SameSite=None` și protecție CSRF separată.

## Consecințe

- `SameSite=Lax` plus faptul că toate operațiile care modifică date sunt `POST/PATCH/DELETE` cu
  corp JSON acoperă falsificarea cererilor între site-uri.
- Un JWT emis rămâne valid criptografic până la expirare; efectul practic este anulat de
  verificarea contului la fiecare cerere. O revocare strictă la deconectare nu există (Q22).
- `401 UNAUTHENTICATED` este semnalul pentru ecranul D15.
