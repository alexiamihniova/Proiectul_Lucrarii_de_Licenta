import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { bigint, timestamp } from 'drizzle-orm/pg-core';

/** BIGINT identity primary key (ADR-0004). Fits in a JS number for any realistic row count. */
export const id = () => bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();

export const ref = () => bigint({ mode: 'number' });

export const timestamptz = () => timestamp({ withTimezone: true, mode: 'date' });

export const createdAt = () => timestamptz().notNull().defaultNow();

/** `column IN ('a', 'b', …)` for VARCHAR + CHECK enums (ADR-0004). Values come from core/domain.ts. */
export function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const list = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');
  return sql`${column} in (${sql.raw(list)})`;
}
