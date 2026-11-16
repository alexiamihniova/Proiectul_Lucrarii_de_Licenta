# ADR-0002: Drizzle ORM și migrări reversibile

Stare: Acceptat · Data: 2026-11-12

## Context

Schema are 16 tabele cu multe constrângeri `CHECK`, indecși parțiali și un trigger. Criteriile
de acceptare cer ca migrarea să pornească pe o bază goală, să poată fi anulată și reaplicată.
drizzle-kit generează SQL-ul de aplicare din schema TypeScript, dar **nu** generează migrări de
anulare și nu are comandă de revenire.

## Decizie

- **Drizzle ORM** (`drizzle-orm` + `pg`) pentru interogări, cu schema în `backend/src/db/schema/`.
- **drizzle-kit generate** produce `backend/drizzle/NNNN_nume.sql` și ține ordinea în
  `backend/drizzle/meta/_journal.json`.
- Pentru fiecare migrare se scrie de mână inversa: `backend/drizzle/down/NNNN_nume.sql`.
- Un rulator propriu, `backend/src/db/migrate.ts` (~150 de linii, fără dependențe noi), aplică
  și anulează migrările: citește ordinea din jurnalul drizzle-kit, ține evidența în tabelul
  `schema_migrations`, rulează fiecare migrare într-o tranzacție și ia un `pg_advisory_lock`,
  ca două procese să nu migreze simultan.
- Ce nu poate exprima drizzle-kit (triggerul de stări) se adaugă de mână la sfârșitul fișierului
  generat.

## Alternative respinse

- **Prisma**. Limbaj de schemă propriu, motor binar separat, sprijin slab pentru `CHECK`,
  indecși parțiali și triggere (ar fi ajuns oricum în SQL scris de mână), iar interogări precum
  `FOR UPDATE SKIP LOCKED` cer SQL brut.
- **Migratorul inclus în Drizzle** (`drizzle-orm/node-postgres/migrator`). Aplică doar înainte;
  cerința de anulare ar fi rămas neacoperită.
- **node-pg-migrate / Knex** cu migrări scrise integral de mână. Au `down`, dar schema ar fi
  existat de două ori (în migrări și în tipurile TypeScript), fără verificare că sunt la fel.
- **`drizzle-kit push`** (sincronizare directă, fără fișiere). Nereproductibil și periculos pe
  date reale.

## Consecințe

- Schema TypeScript este sursa unică; CI rulează `db:generate` și pică dacă apare o migrare
  necomisă (schema și migrările nu se pot abate).
- Autorul unei migrări scrie și fișierul `down`. Testul `migrations.test.ts` verifică existența
  lui și faptul că după `down` nu rămâne niciun tabel, funcție sau secvență.
- `make migrate`, `make migrate-down`, `make migrate-status`.
- Tabelul de evidență este `schema_migrations`, nu cel al migratorului Drizzle.
