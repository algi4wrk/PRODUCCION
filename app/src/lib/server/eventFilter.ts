/**
 * Turns an `EventFilter` into Drizzle conditions.
 *
 * Every process table names the same three columns, so one helper serves all
 * four of them — and keeps the four list functions from each growing their own
 * spelling of the same `where`.
 */

import { eq, gte, lte, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { orders } from './db/schema.ts';
import type { EventFilter } from '../domain/eventFilter.ts';

type Columns = {
	orderId: SQLiteColumn;
	lotId?: SQLiteColumn;
	staffId: SQLiteColumn;
	date: SQLiteColumn;
};

/**
 * The client condition reads `ordenes`, so every list that accepts a filter
 * joins it. They all do already — the order code is a column in each of them.
 */
export function conditionsFor(filter: EventFilter, columns: Columns): SQL[] {
	const conditions: SQL[] = [];
	if (filter.orderId !== undefined) conditions.push(eq(columns.orderId, filter.orderId));
	if (filter.lotId !== undefined && columns.lotId) conditions.push(eq(columns.lotId, filter.lotId));
	if (filter.staffId !== undefined) conditions.push(eq(columns.staffId, filter.staffId));
	if (filter.clientId !== undefined) conditions.push(eq(orders.clientId, filter.clientId));
	// Inclusive at both ends: a range typed as one day means that day.
	if (filter.from) conditions.push(gte(columns.date, filter.from));
	if (filter.to) conditions.push(lte(columns.date, filter.to));
	return conditions;
}
