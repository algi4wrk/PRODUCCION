/**
 * TOSTION — roasting, one batch at a time.
 *
 *   −18,0  VERDE    entra al tostador
 *   +14,4  TOSTADO  sale del tostador
 *
 * The 3,6 kg between them is water driven off: merma, derived like every other
 * loss. Nothing else moves, and no lot is created — roasting changes what the
 * coffee *is*, not whose it is.
 *
 * A lot bigger than the roaster is roasted over several events, and between
 * them it holds green and roasted at once. That is `EN PROCESO TOSTION`, and it
 * is not a flag anybody sets: it is what the two balances say.
 *
 * Roasted coffee always comes out unsorted, even when sorted green went in.
 * Sorting after the roast is its own step, and quakers only appear once the
 * coffee is roasted.
 */

import { and, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from './db/index.ts';
import { ledger, lots, orders, staff, tostion } from './db/schema.ts';
import { lotLedgerIn, postEntries } from './ledger.ts';
import { nextEventCode } from './eventCodes.ts';
import { validateTostion } from '../domain/validation.ts';
import type { RoastType } from '../domain/vocabulary.ts';
import type { EventFilter } from '../domain/eventFilter.ts';
import { conditionsFor } from './eventFilter.ts';

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type NewTostion = {
	lotId: number;
	roastType: RoastType;
	batchKilos: number;
	roastedKilos: number;
	staffId: number;
	notes?: string | null;
	date?: Date;
};

/**
 * Writes one batch, inside a caller's transaction.
 *
 * Shared by recording and by editing, so which bucket the green comes out of
 * and the yield rule have one definition. The balances come from `tx`: an edit
 * reverses its own entries first, and the new batch is checked against the lot
 * as it stands after that.
 */
function writeTostion(tx: Db, input: NewTostion, code?: string): number {
	const [lot] = tx.select().from(lots).where(eq(lots.id, input.lotId)).limit(1).all();
	if (!lot) throw new Error('El lote no existe.');

	const ledgerOf = lotLedgerIn(tx, lot.id);
	const { verde, verdeSel } = ledgerOf.balances;

	// Which green goes in. A lot holding both sorted and unsorted green is part
	// way through a selección, and roasting then would silently pick one.
	if (verde > 0.0005 && verdeSel > 0.0005) {
		throw new Error(
			'El lote tiene café verde seleccionado y sin seleccionar. Termine la selección primero.'
		);
	}

	const fromSorted = verdeSel > 0.0005;
	const green = fromSorted ? verdeSel : verde;

	const error = validateTostion(green, input.batchKilos, input.roastedKilos);
	if (error) throw new Error(error);

	const date = input.date ?? new Date();

	{
		const [order] = tx.select().from(orders).where(eq(orders.id, lot.orderId)).limit(1).all();

		const [event] = tx
			.insert(tostion)
			.values({
				// An edit keeps the code it was issued: the row is rewritten, not
				// replaced, however much of it changed.
				code:
					code ?? nextEventCode(tx, tostion, tostion.orderId, lot.orderId, order.code, 'TO'),
				orderId: lot.orderId,
				lotId: lot.id,
				date,
				roastType: input.roastType,
				greenKilos: green,
				batchKilos: input.batchKilos,
				roastedKilos: input.roastedKilos,
				fromSorted,
				staffId: input.staffId,
				notes: input.notes ?? null
			})
			.returning({ id: tostion.id })
			.all();

		postEntries(tx, [
			{
				orderId: lot.orderId,
				lotId: lot.id,
				state: 'VERDE',
				selected: fromSorted,
				kilos: -input.batchKilos,
				eventType: 'tostion',
				eventId: event.id
			},
			{
				orderId: lot.orderId,
				lotId: lot.id,
				state: 'TOSTADO',
				// Out of the roaster it is unsorted again, whatever went in.
				selected: false,
				kilos: input.roastedKilos,
				eventType: 'tostion',
				eventId: event.id
			}
		]);

		return event.id;
	}
}

/** Records one roasting batch. */
export async function recordTostion(input: NewTostion): Promise<number> {
	return db.transaction((tx) => writeTostion(tx, input));
}

/**
 * Rewrites a batch, weights included.
 *
 * Allowed under exactly the condition undoing is: nothing may have happened to
 * the lot since. With nothing standing on it, unwinding the batch and writing
 * it again cannot invalidate anything downstream.
 */
export async function updateTostion(id: number, input: NewTostion): Promise<number> {
	return db.transaction((tx) => {
		const [event] = tx.select().from(tostion).where(eq(tostion.id, id)).limit(1).all();
		if (!event) throw new Error('El registro no existe.');
		if (event.deletedAt) throw new Error('Ese registro ya fue deshecho.');

		if (!isTostionUndoable(tx, id)) {
			throw new Error(
				'No se puede editar: este lote tiene registros posteriores. ' +
					'Deshaga primero el más reciente.'
			);
		}

		undoTostionIn(tx, id);
		tx.update(tostion)
			.set({ code: `${event.code}-ANULADO-${id}` })
			.where(eq(tostion.id, id))
			.run();

		return writeTostion(tx, input, event.code);
	});
}

/** Whether a tostión can still be undone: only if nothing followed it. */
function isTostionUndoable(tx: Db, eventId: number): boolean {
	const mine = tx
		.select()
		.from(ledger)
		.where(and(eq(ledger.eventType, 'tostion'), eq(ledger.eventId, eventId)))
		.all();
	if (mine.length === 0) return false;

	const involved = [...new Set(mine.map((entry) => entry.lotId))];
	const lastId = Math.max(...mine.map((entry) => entry.id));
	const mineIds = new Set(mine.map((entry) => entry.id));

	const newer = tx
		.select({ id: ledger.id, reversesId: ledger.reversesId })
		.from(ledger)
		.where(and(inArray(ledger.lotId, involved), gt(ledger.id, lastId)))
		.all();

	const reversed = new Set(
		tx
			.select({ id: ledger.reversesId })
			.from(ledger)
			.where(isNotNull(ledger.reversesId))
			.all()
			.map((row) => row.id)
	);

	return !newer.some(
		(entry) => entry.reversesId === null && !reversed.has(entry.id) && !mineIds.has(entry.id)
	);
}

/** Undoes one batch: the roasted coffee goes back to green. */
export async function undoTostion(id: number): Promise<void> {
	return db.transaction((tx) => {
		const [event] = tx.select().from(tostion).where(eq(tostion.id, id)).limit(1).all();
		if (!event) throw new Error('El registro no existe.');
		if (event.deletedAt) throw new Error('Ese registro ya fue deshecho.');

		if (!isTostionUndoable(tx, id)) {
			throw new Error(
				'No se puede deshacer: este lote tiene registros posteriores. ' +
					'Deshaga primero el más reciente.'
			);
		}

		undoTostionIn(tx, id);
	});
}

/**
 * The undo itself, without the checks: the caller has already made them, and
 * the edit path needs to unwind an event it is about to write again.
 */
function undoTostionIn(tx: Db, id: number): void {
	const own = tx
		.select()
		.from(ledger)
		.where(and(eq(ledger.eventType, 'tostion'), eq(ledger.eventId, id)))
		.all();

	postEntries(
		tx,
		own.map((entry) => ({
			orderId: entry.orderId,
			lotId: entry.lotId,
			state: entry.state,
			selected: entry.selected,
			kilos: -entry.kilos,
			eventType: 'tostion' as const,
			eventId: id,
			reversesId: entry.id
		}))
	);

	tx.update(tostion).set({ deletedAt: new Date() }).where(eq(tostion.id, id)).run();
}

/** A tostión as its section lists it. */
export type TostionRow = {
	id: number;
	/** ID_EVENTO, which the detail view names the record by. */
	code: string;
	date: Date;
	/** The order this belongs to, for the views that span several. */
	orderId: number;
	orderCode: string;
	/** ID_LOTE of the lot acted on — what its link is built from. */
	lotCode: string;
	lot: string;
	roastType: string;
	batchKilos: number;
	roastedKilos: number;
	mermaKilos: number;
	staffName: string | null;
	notes: string | null;
	canUndo: boolean;
	/** The event as its form holds it, for editing. */
	edit: {
		lotId: number;
		roastType: string;
		batchKilos: number;
		roastedKilos: number;
		staffId: number;
		notes: string | null;
	};
};

/** Every tostión of one order, newest first — or of one lot within it. */
export async function listTostiones(filter: EventFilter): Promise<TostionRow[]> {
	const rows = await db
		.select({
			event: tostion,
			staffName: staff.name,
			orderCode: orders.code,
			lotCode: lots.code,
			letter: lots.letter,
			variety: lots.variety,
			kind: lots.kind
		})
		.from(tostion)
		.innerJoin(lots, eq(tostion.lotId, lots.id))
		.innerJoin(orders, eq(tostion.orderId, orders.id))
		.leftJoin(staff, eq(tostion.staffId, staff.id))
		.where(and(isNull(tostion.deletedAt), ...conditionsFor(filter, tostion)));

	return rows
		.map(({ event, staffName, orderCode, lotCode, letter, variety, kind }) => ({
			id: event.id,
			code: event.code,
			date: event.date,
			orderId: event.orderId,
			orderCode,
			lotCode,
			lot: `${letter} - ${variety}${kind ? ` ${kind}` : ''}`,
			roastType: event.roastType,
			batchKilos: event.batchKilos,
			roastedKilos: event.roastedKilos,
			// Water driven off.
			mermaKilos: event.batchKilos - event.roastedKilos,
			staffName,
			notes: event.notes,
			canUndo: isTostionUndoable(db, event.id),
			edit: {
				lotId: event.lotId,
				roastType: event.roastType,
				batchKilos: event.batchKilos,
				roastedKilos: event.roastedKilos,
				staffId: event.staffId,
				notes: event.notes
			}
		}))
		.sort((a, b) => b.date.getTime() - a.date.getTime());
}
