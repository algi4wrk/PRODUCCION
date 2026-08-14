/**
 * Change logging.
 *
 * Replaces CHANGELOG, which recorded only a lot's previous status string — no
 * weights, no operator, no field values, and therefore no way to undo anything.
 *
 * This table covers descriptive field edits only. Weight and lot lineage will
 * be corrected by compensating events in the ledger, not by unwinding rows.
 *
 * Audit cannot be added retroactively, which is why it exists from the first
 * slice even though little is editable yet.
 */

import { and, desc, eq } from 'drizzle-orm';
import { db } from './db/index.ts';
import { audit } from './db/schema.ts';

/** Records one field change. No-ops when the value did not actually change. */
export async function logChange(
	table: string,
	rowId: number,
	field: string,
	previousValue: string | null,
	newValue: string | null,
	user?: string
) {
	if (previousValue === newValue) return;

	await db.insert(audit).values({
		table,
		rowId,
		field,
		previousValue,
		newValue,
		user: user ?? null,
		date: new Date()
	});
}

/** The change history for one row, newest first. */
export async function historyFor(table: string, rowId: number) {
	return db
		.select()
		.from(audit)
		.where(and(eq(audit.table, table), eq(audit.rowId, rowId)))
		.orderBy(desc(audit.date));
}
