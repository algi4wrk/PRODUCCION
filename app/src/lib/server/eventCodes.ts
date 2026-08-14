/**
 * Human-facing codes for process events: TIE-M0727A-TR-1, -SE-2, -TO-3.
 *
 * Numbered per order rather than stamped with the clock. Two events recorded in
 * the same millisecond — a roast entered straight after another, or a script —
 * produced identical timestamp codes and collided on the unique index.
 *
 * The count includes undone events, so a code is never reissued to a different
 * record. That is the rule the lot letters follow too, and for the same reason:
 * a code may already be written on a bag.
 */

import { eq, sql } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { db } from './db/index.ts';

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export function nextEventCode(
	tx: Db,
	table: SQLiteTable,
	orderColumn: SQLiteColumn,
	orderId: number,
	orderCode: string,
	prefix: string
): string {
	const [row] = tx
		.select({ count: sql<number>`count(*)` })
		.from(table)
		.where(eq(orderColumn, orderId))
		.all();

	return `${orderCode}-${prefix}-${(row?.count ?? 0) + 1}`;
}
