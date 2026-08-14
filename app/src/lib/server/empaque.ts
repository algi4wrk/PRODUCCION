/**
 * EMPAQUE — putting roasted coffee into bags.
 *
 *   −10,0  TOSTADO   sale del lote
 *   +10,0  EMPACADO  queda en bolsas
 *
 * The two legs are equal, which is the whole point: **packing is a form, not an
 * exit**. Bagged coffee is still the lot's coffee, so it still counts in the
 * total and produces no merma. Only trilla, selección and tostión post entries
 * that fail to balance, and that imbalance is what loss means.
 *
 * A lot is packed over as many events as it has presentations — 40 × 250 g and
 * 12 × 1 kg are two events — and holds roasted and packed coffee in between.
 * That is `EN PROCESO EMPAQUE`, and like every other "en proceso" it is what the
 * balances say rather than a flag anybody sets.
 *
 * No lot is created and no lineage changes, so nothing here writes a movimiento.
 */

import { and, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from './db/index.ts';
import { bags, empaque, ledger, lots, orders, references, staff } from './db/schema.ts';
import { lotLedgerIn, postEntries } from './ledger.ts';
import { nextEventCode } from './eventCodes.ts';
import { validatePackedQuantity } from '../domain/validation.ts';
import { referenceKilos } from '../domain/derived.ts';
import type { GrindType, PackingInspection } from '../domain/vocabulary.ts';
import type { EventFilter } from '../domain/eventFilter.ts';
import { conditionsFor } from './eventFilter.ts';

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type NewEmpaque = {
	lotId: number;
	/** The planned line this fills, when it fills one. */
	referenceId?: number | null;
	grams: number;
	quantity: number;
	grind: GrindType;
	bagId?: number | null;
	inspection: PackingInspection;
	staffId: number;
	notes?: string | null;
	date?: Date;
};

/**
 * Writes one packing, inside a caller's transaction.
 *
 * Shared by recording and by editing, so the bucket the coffee comes out of and
 * the cap on what fits have one definition. The balances come from `tx`: an
 * edit reverses its own entries first, and the new quantity is checked against
 * the lot as it stands after that.
 */
function writeEmpaque(tx: Db, input: NewEmpaque, code?: string): number {
	const [lot] = tx.select().from(lots).where(eq(lots.id, input.lotId)).limit(1).all();
	if (!lot) throw new Error('El lote no existe.');

	const ledgerOf = lotLedgerIn(tx, lot.id);
	const { tostado, tostadoSel } = ledgerOf.balances;

	// Which roasted coffee goes into the bags. A lot holding both sorted and
	// unsorted roasted coffee is part way through a selección, and packing then
	// would silently pick one of the two — the same refusal tostión makes.
	if (tostado > 0.0005 && tostadoSel > 0.0005) {
		throw new Error(
			'El lote tiene café tostado seleccionado y sin seleccionar. Termine la selección primero.'
		);
	}

	const fromSorted = tostadoSel > 0.0005;
	const available = fromSorted ? tostadoSel : tostado;

	const error = validatePackedQuantity(input.grams, input.quantity, available);
	if (error) throw new Error(error);

	const kilos = referenceKilos({ grams: input.grams, quantity: input.quantity });
	const date = input.date ?? new Date();

	{
		const [order] = tx.select().from(orders).where(eq(orders.id, lot.orderId)).limit(1).all();

		const [event] = tx
			.insert(empaque)
			.values({
				// An edit keeps the code it was issued: the row is rewritten, not
				// replaced, however much of it changed.
				code:
					code ?? nextEventCode(tx, empaque, empaque.orderId, lot.orderId, order.code, 'EM'),
				orderId: lot.orderId,
				lotId: lot.id,
				date,
				referenceId: input.referenceId ?? null,
				grams: input.grams,
				quantity: input.quantity,
				bagId: input.bagId ?? null,
				grind: input.grind,
				fromSorted,
				inspection: input.inspection,
				staffId: input.staffId,
				notes: input.notes ?? null
			})
			.returning({ id: empaque.id })
			.all();

		postEntries(tx, [
			{
				orderId: lot.orderId,
				lotId: lot.id,
				state: 'TOSTADO',
				selected: fromSorted,
				kilos: -kilos,
				eventType: 'empaque',
				eventId: event.id
			},
			{
				orderId: lot.orderId,
				lotId: lot.id,
				state: 'EMPACADO',
				// The sorted flag does not survive bagging: what is in the bag is a
				// finished presentation, and EMPACADO is one bucket.
				selected: false,
				kilos,
				eventType: 'empaque',
				eventId: event.id
			}
		]);

		return event.id;
	}
}

/** Records one packing. */
export async function recordEmpaque(input: NewEmpaque): Promise<number> {
	return db.transaction((tx) => writeEmpaque(tx, input));
}

/**
 * Rewrites a packing, quantities included.
 *
 * Allowed under exactly the condition undoing is: nothing may have happened to
 * the lot since.
 */
export async function updateEmpaque(id: number, input: NewEmpaque): Promise<number> {
	return db.transaction((tx) => {
		const [event] = tx.select().from(empaque).where(eq(empaque.id, id)).limit(1).all();
		if (!event) throw new Error('El registro no existe.');
		if (event.deletedAt) throw new Error('Ese registro ya fue deshecho.');

		if (!isEmpaqueUndoable(tx, id)) {
			throw new Error(
				'No se puede editar: este lote tiene registros posteriores. ' +
					'Deshaga primero el más reciente.'
			);
		}

		undoEmpaqueIn(tx, id);
		tx.update(empaque)
			.set({ code: `${event.code}-ANULADO-${id}` })
			.where(eq(empaque.id, id))
			.run();

		return writeEmpaque(tx, input, event.code);
	});
}

/** Whether an empaque can still be undone: only if nothing followed it. */
function isEmpaqueUndoable(tx: Db, eventId: number): boolean {
	const mine = tx
		.select()
		.from(ledger)
		.where(and(eq(ledger.eventType, 'empaque'), eq(ledger.eventId, eventId)))
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

/** Undoes one packing: the coffee comes back out of the bags. */
export async function undoEmpaque(id: number): Promise<void> {
	return db.transaction((tx) => {
		const [event] = tx.select().from(empaque).where(eq(empaque.id, id)).limit(1).all();
		if (!event) throw new Error('El registro no existe.');
		if (event.deletedAt) throw new Error('Ese registro ya fue deshecho.');

		if (!isEmpaqueUndoable(tx, id)) {
			throw new Error(
				'No se puede deshacer: este lote tiene registros posteriores. ' +
					'Deshaga primero el más reciente.'
			);
		}

		undoEmpaqueIn(tx, id);
	});
}

/**
 * The undo itself, without the checks: the caller has already made them, and
 * the edit path needs to unwind an event it is about to write again.
 */
function undoEmpaqueIn(tx: Db, id: number): void {
	const own = tx
		.select()
		.from(ledger)
		.where(and(eq(ledger.eventType, 'empaque'), eq(ledger.eventId, id)))
		.all();

	postEntries(
		tx,
		own.map((entry) => ({
			orderId: entry.orderId,
			lotId: entry.lotId,
			state: entry.state,
			selected: entry.selected,
			kilos: -entry.kilos,
			eventType: 'empaque' as const,
			eventId: id,
			reversesId: entry.id
		}))
	);

	tx.update(empaque).set({ deletedAt: new Date() }).where(eq(empaque.id, id)).run();
}

/** An empaque as its section lists it. */
export type EmpaqueRow = {
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
	grams: number;
	quantity: number;
	kilos: number;
	grind: string;
	bagName: string | null;
	inspection: string;
	staffName: string | null;
	notes: string | null;
	canUndo: boolean;
	/** The event as its form holds it, for editing. */
	edit: {
		lotId: number;
		referenceId: number | null;
		grams: number;
		quantity: number;
		grind: string;
		bagId: number | null;
		inspection: string;
		staffId: number;
		notes: string | null;
	};
};

/** Every empaque of one order, newest first — or of one lot within it. */
export async function listEmpaques(filter: EventFilter): Promise<EmpaqueRow[]> {
	const rows = await db
		.select({
			event: empaque,
			staffName: staff.name,
			orderCode: orders.code,
			bagCode: bags.code,
			bagDescription: bags.description,
			lotCode: lots.code,
			letter: lots.letter,
			variety: lots.variety,
			kind: lots.kind
		})
		.from(empaque)
		.innerJoin(lots, eq(empaque.lotId, lots.id))
		.innerJoin(orders, eq(empaque.orderId, orders.id))
		.leftJoin(staff, eq(empaque.staffId, staff.id))
		.leftJoin(bags, eq(empaque.bagId, bags.id))
		.where(and(isNull(empaque.deletedAt), ...conditionsFor(filter, empaque)));

	return rows
		.map(({ event, staffName, orderCode, lotCode, bagCode, bagDescription, letter, variety, kind }) => ({
			id: event.id,
			code: event.code,
			date: event.date,
			orderId: event.orderId,
			orderCode,
			lotCode,
			lot: `${letter} - ${variety}${kind ? ` ${kind}` : ''}`,
			grams: event.grams,
			quantity: event.quantity,
			kilos: referenceKilos({ grams: event.grams, quantity: event.quantity }),
			grind: event.grind,
			bagName: bagDescription ?? bagCode ?? null,
			inspection: event.inspection,
			staffName,
			notes: event.notes,
			canUndo: isEmpaqueUndoable(db, event.id),
			edit: {
				lotId: event.lotId,
				referenceId: event.referenceId,
				grams: event.grams,
				quantity: event.quantity,
				grind: event.grind,
				bagId: event.bagId,
				inspection: event.inspection,
				staffId: event.staffId,
				notes: event.notes
			}
		}))
		.sort((a, b) => b.date.getTime() - a.date.getTime());
}

/**
 * How far each planned line has been filled.
 *
 * This is what the sheet's REFS / REFS USADAS pair was reaching for. There it
 * was a list of references already spent, used once to guess which one to fill
 * next; here it is the progress of the whole plan, so the operator packing a lot
 * can see what the client asked for without leaving the form.
 *
 * Packed against no reference is counted separately by the caller — it is
 * coffee in bags either way.
 */
export type ReferenceProgress = {
	id: number;
	grams: number;
	quantity: number;
	grind: GrindType;
	variety: string;
	bagId: number | null;
	kilos: number;
	/** Bags of this line already packed, across every lot of the order. */
	packedQuantity: number;
	packedKilos: number;
	/** Bags still owed. Negative would mean overpacked, which is allowed. */
	pendingQuantity: number;
};

export async function referenceProgress(orderId: number): Promise<ReferenceProgress[]> {
	const [plan, packed] = await Promise.all([
		db
			.select()
			.from(references)
			.where(and(eq(references.orderId, orderId), isNull(references.deletedAt))),
		db
			.select({ referenceId: empaque.referenceId, quantity: empaque.quantity })
			.from(empaque)
			.where(and(eq(empaque.orderId, orderId), isNull(empaque.deletedAt)))
	]);

	// Bags packed per planned line.
	const packedByReference = new Map<number, number>();
	for (const row of packed) {
		if (row.referenceId === null) continue;
		packedByReference.set(
			row.referenceId,
			(packedByReference.get(row.referenceId) ?? 0) + row.quantity
		);
	}

	return plan.map((reference) => {
		const packedQuantity = packedByReference.get(reference.id) ?? 0;
		return {
			id: reference.id,
			grams: reference.grams,
			quantity: reference.quantity,
			grind: reference.grind,
			variety: reference.variety,
			bagId: reference.bagId,
			kilos: referenceKilos(reference),
			packedQuantity,
			packedKilos: referenceKilos({ grams: reference.grams, quantity: packedQuantity }),
			pendingQuantity: reference.quantity - packedQuantity
		};
	});
}
