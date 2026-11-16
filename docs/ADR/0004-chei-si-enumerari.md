# ADR-0004: Chei BIGINT identity și enumerări VARCHAR + CHECK

Stare: Acceptat · Data: 2026-11-12

## Context

SRS 3.1.3 cere ca pasajele să fie trimise modelului de limbaj cu „id (întreg)”. Multe coloane
au un set închis de valori (stări, tipuri, roluri) care se poate schimba pe parcursul proiectului.

## Decizie

- Toate cheile primare sunt `BIGINT GENERATED ALWAYS AS IDENTITY`, citite în cod ca `number`.
- Seturile închise sunt `VARCHAR` + constrângere `CHECK`. Listele de valori stau o singură dată
  în `backend/src/core/domain.ts` și sunt folosite atât de `CHECK`, cât și de schemele Zod.

## Alternative respinse

- **UUID**. Identificatorii ar fi fost de 36 de caractere în prompturile trimise modelului (cost
  în jetoane și mai multe greșeli de copiere în răspunsuri) și ar fi contrazis „id (întreg)”.
  Avantajul lor, că nu pot fi ghiciți, nu contează aici: accesul se verifică pe server la
  fiecare cerere (RNF7), nu prin secretul identificatorului.
- **`SERIAL`**. Formă veche; `IDENTITY` este standardul SQL și nu permite inserarea accidentală
  a unui id ales de aplicație.
- **Tipul `ENUM` din PostgreSQL**. Eliminarea sau redenumirea unei valori cere recrearea tipului,
  iar `ALTER TYPE … ADD VALUE` are restricții în tranzacții; migrările de anulare ar fi fost
  fragile. Un `CHECK` se înlocuiește într-o singură instrucțiune.
- **Tabele de nomenclator** cu chei străine. Join-uri în plus pentru liste de 2–5 valori fixe.

## Consecințe

- Adăugarea unei valori: se modifică lista din `domain.ts`, se rulează `db:generate` și se scrie
  fișierul `down`.
- `BIGINT` ca `number` este exact până la 2⁵³, mult peste nevoile proiectului.
- Identificatorii sunt secvențiali și vizibili în URL; fiecare serviciu trebuie să filtreze
  după utilizatorul curent și să răspundă `404` pentru resursele altcuiva.
