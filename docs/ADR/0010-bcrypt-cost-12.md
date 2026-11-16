# ADR-0010: Parole cu bcrypt, cost 12, configurabil

Stare: Acceptat · Data: 2026-11-16 · Implementarea aparține Segmentului 1B

## Context

RNF6 și SRS 3.6.3 cer explicit ca parolele să fie stocate ca hash **bcrypt**. Rămâne de ales
costul (numărul de runde este 2^cost) și modul în care se tratează limitele algoritmului. Sistemul
servește cel puțin 50 de utilizatori simultani (RNF1), iar o autentificare trebuie să rămână sub
pragul de 2 s al paginilor obișnuite.

## Decizie

- **bcrypt, cost 12**, din `BCRYPT_COST` (4–15). În producție configurarea refuză valori sub 10.
  Testele folosesc 4, ca suita să rămână rapidă.
- Hash-ul se calculează în firele de execuție ale Node (biblioteca nativă `bcrypt`), nu în bucla
  de evenimente.
- La o autentificare reușită, un hash cu alt cost decât cel configurat este recalculat și salvat,
  înainte de emiterea sesiunii. Costul se poate ridica fără migrare.
- O parolă de peste **72 de octeți** în UTF-8 este respinsă (`PASSWORD_TOO_LONG`), fiindcă
  bcrypt ar ignora în tăcere restul (Q34).
- Parola nu se transformă înainte de hash.

Cost 12 înseamnă aproximativ 200–300 ms pe un procesor obișnuit: imperceptibil la o autentificare,
dar un atacator cu hash-urile furate verifică doar câteva parole pe secundă pe nucleu, iar
blocarea după 5 încercări face ca atacul online să nu depindă de cost.

## Alternative respinse

- **argon2id**. Mai rezistent la atacuri cu plăci grafice și fără limita de 72 de octeți, dar
  contrazice litera RNF6. Ar cere actualizarea SRS și decizia autoarei; nu se justifică pentru
  un pilot cu 15 studenți.
- **Cost 10** (valoarea implicită a multor biblioteci). De patru ori mai ieftin pentru atacator,
  fără un câștig pe care utilizatorul să-l simtă.
- **Cost 14 sau mai mare**. Peste o secundă pe autentificare; cu 50 de utilizatori simultani și
  patru fire de execuție, cererile s-ar aduna la coadă.
- **Pre-hash cu SHA-256 înainte de bcrypt**, ca să dispară limita de 72 de octeți. Introduce
  capcane cunoscute (octeți nuli în rezultat, dacă nu se codifică) pentru un caz pe care RF1 îl
  face rar: parola are cel mult 64 de caractere.
- **`bcryptjs` (JavaScript pur)**. Nu cere compilare, dar rulează în bucla de evenimente și este
  de câteva ori mai lent. Rămâne soluția de rezervă dacă biblioteca nativă nu se instalează în
  imaginea Docker.
- **„Piper” (secret global amestecat în parolă)**. Încă un secret de păstrat și de rotit, fără
  cerință în SRS.

## Consecințe

- Variabilă nouă: `BCRYPT_COST`.
- Cod de eroare nou: `PASSWORD_TOO_LONG`, cu limita spusă în mesaj.
- Rehash-ul schimbă hash-ul, deci și amprenta sesiunii (ADR-0011): se face înaintea emiterii
  cookie-ului, altfel sesiunea abia creată ar fi invalidă.
- Dacă SRS trece la argon2id, se schimbă doar funcțiile de hash și de verificare; hash-urile
  vechi se recunosc după prefix și se migrează la următoarea autentificare.
