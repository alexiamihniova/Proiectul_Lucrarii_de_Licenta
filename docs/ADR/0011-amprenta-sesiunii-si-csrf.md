# ADR-0011: Invalidarea sesiunii prin amprenta parolei; CSRF prin verificarea originii

Stare: Acceptat · Data: 2026-11-16 · Completează ADR-0005 · Implementarea aparține Segmentului 1B

## Context

ADR-0005 a fixat sesiunea: JWT de 24 de ore în cookie `HttpOnly`, aceeași origine. Rămâneau două
lucruri: cum se invalidează sesiunile (un JWT fără stare nu poate fi revocat) și cum se apără
metodele care modifică date de falsificarea cererilor (SRS 3.5.1). Schema nu are tabel de
sesiuni, iar SRS nu prevede unul.

## Decizie

### Invalidarea

- Jetonul poartă câmpul `pfp`: primii 16 octeți din
  `HMAC-SHA256(SESSION_SECRET, "recap:pfp:v1:" + password_hash)`, în base64url.
- La fiecare cerere protejată, hook-ul citește utilizatorul din bază (oricum necesar pentru
  `request.user`) și compară amprenta. Schimbarea parolei schimbă hash-ul și invalidează
  **toate** sesiunile contului.
- Tot atunci se verifică `status`: blocarea de către administrator are efect la următoarea
  cerere, nu după 24 de ore. Rolul se citește din bază, nu din jeton.
- Deconectarea șterge cookie-ul și atât.

Amprenta este un HMAC cu secretul serverului, nu o parte a hash-ului: jetonul, care poate fi
decodificat de oricine îl are, nu conține nimic din hash-ul bcrypt și nu ajută la un atac asupra
parolei. Prefixul `recap:pfp:v1:` separă această folosire a secretului de semnarea jetonului.

### CSRF

- Cookie `SameSite=Lax`.
- Pe toate rutele `/api/v1` cu `POST`, `PATCH`, `PUT`, `DELETE`: dacă `Origin` există și diferă de
  originea din `APP_BASE_URL`, sau dacă `Origin` lipsește și `Sec-Fetch-Site` este `cross-site`,
  răspunsul este `403 ORIGIN_NOT_ALLOWED`.
- Nicio rută `GET` nu modifică date.

## Risc acceptat

**După deconectare, un JWT furat rămâne valid până la expirare (cel mult 24 de ore) sau până la
schimbarea parolei.** Se acceptă pentru că: cookie-ul este `HttpOnly` și, în producție, `Secure`,
deci furtul cere acces la dispozitiv; durata este limitată de SRS la 24 de ore; utilizatorul
care bănuiește un furt își poate reseta parola, ceea ce închide toate sesiunile.

**Opțiune viitoare**, dacă riscul nu mai este acceptabil: coloana `users.session_version`
(întreg), inclusă în jeton și incrementată la deconectare. Costă o migrare și deconectează toate
dispozitivele deodată.

## Alternative respinse

- **Amprentă derivată direct din hash** (de exemplu ultimele caractere). Ar pune în jeton o parte
  din hash-ul bcrypt, lizibilă pe client.
- **Tabel de sesiuni** sau **listă de jetoane revocate**. Revocare exactă, dar o a 17-a entitate
  și o scriere la fiecare autentificare; SRS cere JWT (RNF6, RFC 7519).
- **`users.session_version` de la început**. Corect tehnic, dar adaugă o coloană fără
  corespondent în SRS pentru un risc deja limitat. Rămâne opțiunea de rezervă.
- **`password_changed_at` comparat cu `iat`**. Tot o coloană nouă și sensibil la secundele de
  graniță.
- **Jeton CSRF (sincronizat sau „double submit”)**. Cere o rută care îl emite, stocare pe client
  și un antet la fiecare cerere, inclusiv la încărcarea de fișiere. Cu aceeași origine,
  `SameSite=Lax` și verificarea originii acoperă aceleași atacuri cu mult mai puțin cod.
- **Antet personalizat obligatoriu** (`X-Requested-With`). Ar bloca formularele simple de pe alte
  site-uri, dar ar bloca și clienții legitimi fără browser și nu aduce nimic peste `Origin`.
- **Doar `SameSite=Lax`**. Un singur strat, dependent de browser; verificarea originii este
  ieftină și independentă.

## Consecințe

- O citire a utilizatorului la fiecare cerere protejată (căutare după cheia primară).
- Rehash-ul parolei la creșterea costului (ADR-0010) schimbă amprenta: se face înainte de emiterea
  cookie-ului.
- Schimbarea `SESSION_SECRET` deconectează pe toată lumea.
- Coduri de eroare noi: `ORIGIN_NOT_ALLOWED`, `TOO_MANY_REQUESTS`.
- Testele construiesc jetoane de mână (expirate, cu `alg: none`, cu amprentă greșită), deci
  formatul jetonului este parte din contract și nu depinde de biblioteca aleasă în 1B.
