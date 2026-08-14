/**
 * Writing and reading REGISTRO.
 *
 * The ledger is append-only. Nothing here updates or deletes a row: a mistake is
 * corrected by posting its opposite, because deleting an entry that newer
 * entries were computed against causes exactly the problems an append-only log
 * exists to prevent.
 *
 * Every process step will call `postEntries` from inside its own transaction, so
 * an event and the weight it moved are written together or not at all.
 */

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from './db/index.ts';
import { ledger, lots } from './db/schema.ts';
import {
	isEmpty,
	summarise,
	summariseByLot,
	type LedgerRow,
	type LotLedger
} from '../domain/ledger.ts';
import { sourceBalances, type SourceBalance } from '../domain/sourceMerma.ts';
import type { EventType, LedgerState } from '../domain/vocabulary.ts';

/** Anything that can run queries: the database, or a transaction inside one. */
type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** One line of a posting. */
export type Entry = {
	orderId: number;
	lotId: number;
	state: LedgerState;
	/** Sorted coffee. Defaults to unsorted, which is what most steps produce. */
	selected?: boolean;
	/** Signed: negative takes weight out of the bucket. */
	kilos: number;
	eventType: EventType;
	eventId: number;
	reversesId?: number;
};

/**
 * Appends entries, refusing any posting that would leave a bucket negative.
 *
 * That check is the ledger's one hard guarantee, and it is what stops a
 * mistyped weight from quietly making a lot hold minus three kilos. It runs
 * inside the caller's transaction, so a rejected posting takes the event with
 * it.
 */
export function postEntries(tx: Db, entries: readonly Entry[]): void {
	if (entries.length === 0) return;

	const lotIds = [...new Set(entries.map((entry) => entry.lotId))];
	const existing = tx.select().from(ledger).where(inArray(ledger.lotId, lotIds)).all();

	// Balances after this posting, bucket by bucket.
	const after = new Map<string, number>();
	for (const row of [...existing, ...entries]) {
		const key = `${row.lotId}·${row.state}·${row.selected ? 'sel' : 'sin'}`;
		after.set(key, (after.get(key) ?? 0) + row.kilos);
	}

	for (const [key, kilos] of after) {
		if (kilos < 0 && !isEmpty(kilos)) {
			const [lotId, state, selected] = key.split('·');
			throw new Error(
				`El lote ${lotId} no tiene suficiente café ${state}` +
					`${selected === 'sel' ? ' seleccionado' : ''}: quedaría en ${kilos.toFixed(2)} kg.`
			);
		}
	}

	tx.insert(ledger)
		.values(
			entries.map((entry) => ({
				orderId: entry.orderId,
				lotId: entry.lotId,
				state: entry.state,
				selected: entry.selected ?? false,
				kilos: entry.kilos,
				eventType: entry.eventType,
				eventId: entry.eventId,
				reversesId: entry.reversesId ?? null
			}))
		)
		.run();
}

/** The bucket a lot's arrival lands in, from the material it arrived as. */
function receptionState(rawMaterial: string): LedgerState {
	return rawMaterial === 'TOSTADO' ? 'TOSTADO' : 'VERDE';
}

/**
 * Posts a lot's arrival: its whole initial weight, in the form it arrived in.
 *
 * This is what removes every "nothing has happened yet" branch from the
 * projections. A freshly received lot is not a special case — it is a lot with
 * one entry.
 *
 * `eventId` is the lot's own id: reception is the one event with no event row,
 * since the lot *is* the record of its own arrival.
 */
export function postReception(
	tx: Db,
	lot: { id: number; orderId: number; rawMaterial: string; initialWeight: number }
): void {
	postEntries(tx, [
		{
			orderId: lot.orderId,
			lotId: lot.id,
			state: receptionState(lot.rawMaterial),
			kilos: lot.initialWeight,
			eventType: 'recepcion',
			eventId: lot.id
		}
	]);
}

/**
 * Reverses one entry by appending its opposite.
 *
 * Refused when the entry has already been reversed, and when the lot it
 * produced has since been moved on — unwinding a roast whose output was already
 * combined would leave the combined lot describing coffee that no longer
 * exists. The negative-balance check in `postEntries` catches the rest.
 */
export async function reverseEntry(entryId: number): Promise<void> {
	return db.transaction((tx) => {
		const [entry] = tx.select().from(ledger).where(eq(ledger.id, entryId)).limit(1).all();
		if (!entry) throw new Error('El renglón no existe.');

		const [already] = tx
			.select({ id: ledger.id })
			.from(ledger)
			.where(eq(ledger.reversesId, entryId))
			.limit(1)
			.all();
		if (already) throw new Error('Ese renglón ya fue reversado.');

		// Anything this event produced that has since moved on.
		const consequences = tx
			.select({ id: ledger.id })
			.from(ledger)
			.where(and(eq(ledger.eventType, 'movimiento'), eq(ledger.lotId, entry.lotId)))
			.all();
		if (entry.eventType !== 'movimiento' && consequences.length > 0) {
			throw new Error(
				'No se puede reversar: el café de este lote ya se movió a otro lote.'
			);
		}

		postEntries(tx, [
			{
				orderId: entry.orderId,
				lotId: entry.lotId,
				state: entry.state,
				selected: entry.selected,
				kilos: -entry.kilos,
				// Carries the same cause: a correction is part of the event it undoes,
				// not an event of its own.
				eventType: entry.eventType,
				eventId: entry.eventId,
				reversesId: entry.id
			}
		]);
	});
}

/** Everything posted against one lot, summarised. */
export async function lotLedger(lotId: number): Promise<LotLedger> {
	const rows = await db.select().from(ledger).where(eq(ledger.lotId, lotId));
	return summarise(rows as LedgerRow[]);
}

/**
 * The same, inside a transaction.
 *
 * An edit reverses its own entries and then re-posts them, and the new weights
 * have to be checked against what the lot holds *after* that reversal — a state
 * that only exists inside the transaction. Reading it from `db` would see the
 * balances as they were before, and refuse a batch the lot can perfectly well
 * supply once its old one is given back.
 */
export function lotLedgerIn(tx: Db, lotId: number): LotLedger {
	const rows = tx.select().from(ledger).where(eq(ledger.lotId, lotId)).all();
	return summarise(rows as LedgerRow[]);
}

/**
 * Every lot of one order, summarised — one query, not one per lot.
 *
 * The board reads this on a monitor all day, so the page cost has to be flat in
 * the number of lots.
 */
export async function orderLedgers(orderId: number): Promise<Map<number, LotLedger>> {
	const rows = await db.select().from(ledger).where(eq(ledger.orderId, orderId));
	return summariseByLot(rows as LedgerRow[]);
}

/** Every live lot in the database, summarised. One query for the whole board. */
export async function allLedgers(): Promise<Map<number, LotLedger>> {
	const rows = await db
		.select({
			id: ledger.id,
			lotId: ledger.lotId,
			state: ledger.state,
			selected: ledger.selected,
			kilos: ledger.kilos,
			eventType: ledger.eventType,
			eventId: ledger.eventId,
			reversesId: ledger.reversesId
		})
		.from(ledger)
		.innerJoin(lots, eq(ledger.lotId, lots.id))
		.where(isNull(lots.deletedAt));

	return summariseByLot(rows);
}

/** What became of each original lot's coffee, for one order. */
export async function orderSourceMerma(orderId: number): Promise<Map<number, SourceBalance>> {
	const rows = await db.select().from(ledger).where(eq(ledger.orderId, orderId));
	return sourceBalances(rows as LedgerRow[]);
}

/**
 * The same, for every order at once — the board shows lots from all of them.
 *
 * Grouped by order because the calculation follows coffee through movimientos,
 * and movimientos never cross orders.
 */
export async function allSourceMerma(): Promise<Map<number, SourceBalance>> {
	const rows = (await db.select().from(ledger)) as LedgerRow[] & { orderId: number }[];

	const byOrder = new Map<number, LedgerRow[]>();
	for (const row of rows) {
		const list = byOrder.get(row.orderId) ?? [];
		list.push(row);
		byOrder.set(row.orderId, list);
	}

	const result = new Map<number, SourceBalance>();
	for (const orderRows of byOrder.values()) {
		for (const [lotId, balance] of sourceBalances(orderRows)) result.set(lotId, balance);
	}
	return result;
}
