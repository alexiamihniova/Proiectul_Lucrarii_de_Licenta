# ADR-0003: Coadă în PostgreSQL și proces worker separat

Stare: Acceptat · Data: 2026-11-12

## Context

Analiza unui document rulează în fundal (RF4, SRS 3.5 punctul 5), poate dura până la 60 s și
are stări vizibile studentului. Sistemul are de servit cel puțin 50 de utilizatori simultani
(RNF1) într-un pilot cu cel puțin 15 studenți. Mai există sarcini declanșate de timp:
memento-uri, curățarea jetoanelor și a jurnalului.

## Decizie

- **Fără bibliotecă de coadă și fără tabel de sarcini.** Documentul cu `status = 'queued'` este
  sarcina. Un worker îl preia atomic:

  ```sql
  UPDATE documents SET status = 'processing', processing_started_at = now()
  WHERE id = (SELECT id FROM documents WHERE status = 'queued'
              ORDER BY uploaded_at FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING *;
  ```

- Un **proces worker separat** (`backend/src/worker.ts`), același cod ca API-ul, rulează sarcinile
  periodice prin `core/worker.ts`.
- `processing_started_at` permite detectarea depășirii de 60 s (evenimentul PE) și a
  documentelor rămase „În analiză” după o cădere a workerului.

## Alternative respinse

- **BullMQ / bee-queue (Redis)**. Un al cincilea serviciu de instalat, configurat și salvat,
  pentru un singur tip de sarcină la volumul unui pilot.
- **pg-boss / graphile-worker** (cozi peste PostgreSQL). Aduc tabele și concepte proprii
  (sarcini, reîncercări, arhivare), dar starea sarcinii ar fi existat de două ori: în coadă și
  în `documents.status`, pe care Dosarul îl definește deja ca mașină de stări. Două surse de
  adevăr pentru aceeași stare înseamnă exact erorile C-08, C-09 și C-10.
- **Procesare în procesul API** (`setImmediate`, fără worker). Blochează bucla de evenimente la
  extragerea textului și pierde sarcinile la repornire.
- **Tabel `jobs` propriu**. Ar fi a 17-a entitate, fără corespondent în SRS sau Dosar.

## Consecințe

- Coada supraviețuiește repornirilor: starea este în baza de date.
- `SKIP LOCKED` permite mai multe procese worker fără coordonare (testat în
  `document-state-machine.test.ts`).
- Indexul parțial `documents_queue_idx` menține preluarea rapidă.
- Limite acceptate: fără priorități, fără reîncercare automată a unui document eșuat (studentul
  cere reprocesarea, RP), latență de cel mult `WORKER_POLL_INTERVAL_MS`.
- Dacă apar alte sarcini asincrone grele (de exemplu generarea materialelor, Q14), decizia se
  reevaluează printr-un ADR nou.
