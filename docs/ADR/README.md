# Decizii de arhitectură (ADR)

O decizie pe fișier. Fiecare spune ce s-a ales, ce s-a respins și de ce. Un ADR acceptat nu se
rescrie: dacă decizia se schimbă, se adaugă un ADR nou care îl înlocuiește și se marchează cel
vechi „Înlocuit de ADR-NNNN”.

| Nr.  | Decizie                                                                    | Stare    |
| ---- | -------------------------------------------------------------------------- | -------- |
| 0001 | [Fastify + TypeScript + Zod, nu Express](0001-fastify-typescript-zod.md)   | Acceptat |
| 0002 | [Drizzle ORM și migrări reversibile](0002-drizzle-si-migrari-reversibile.md) | Acceptat |
| 0003 | [Coadă în PostgreSQL și proces worker separat](0003-coada-in-postgresql.md) | Acceptat |
| 0004 | [Chei BIGINT identity și enumerări VARCHAR + CHECK](0004-chei-si-enumerari.md) | Acceptat |
| 0005 | [Sesiune JWT în cookie httpOnly, aceeași origine](0005-sesiune-jwt-cookie.md) | Acceptat |
| 0006 | [Monolit modular, module pe segmente](0006-monolit-modular.md)             | Acceptat |
| 0007 | [Convențiile API și contractul generat din cod](0007-conventii-api.md)     | Acceptat |
| 0008 | [Ștergere logică și stările documentului impuse în baza de date](0008-starile-documentului.md) | Acceptat |
| 0009 | [Interfața LLMClient](0009-llmclient.md)                                   | Acceptat |
| 0010 | [Parole cu bcrypt, cost 12, configurabil](0010-bcrypt-cost-12.md)          | Acceptat |
| 0011 | [Amprenta sesiunii și CSRF prin verificarea originii](0011-amprenta-sesiunii-si-csrf.md) | Acceptat |

Șablon: Context · Decizie · Alternative respinse · Consecințe.
