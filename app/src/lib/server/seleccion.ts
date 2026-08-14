/**
 * SELECCION — sorting, on either side of the roast.
 *
 * What the coffee is does not change; what changes is that it has been sorted.
 * So the weight moves between buckets of the same form rather than between
 * forms, which is what makes `AV` and `AV SELECCIONADO` different states of one
 * lot, and holding both at once mean "half sorted".
 *
 *   −25,0  TOSTADO               entra sin seleccionar
 *   +23,0  TOSTADO SELECCIONADO  lo bueno, se queda en el lote
 *   + 1,0  TOSTADO               los quakers, todavía en el lote
 *     movimiento SEPARAR: −1,0 del lote → +1,0 al lote de quakers
 *
 * The kilo unaccounted for is defects, and defects are merma: never entered,
 * never stored, derived like every other loss.
 *
 * Quakers are separated only when the lot's AGREGAR QUAKER says the client
 * wants them. That is what lets the floor recombine them with an unsorted
 * remainder into a lesser-quality lot — an ordinary COMBINAR afterwards, since
 * both sides are unsorted coffee of the same form.
 */

import { and, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from './db/index.ts';
import { ledger, lots, movements, orders, seleccion, staff } from './db/schema.ts';
import { lotLedgerIn, postEntries } from './ledger.ts';
import { nextEventCode } from './eventCodes.ts';
import { recordMovimiento, undoMovimientoIn } from './movimientos.ts';
import { validateSeleccionYield } from '../domain/validation.ts';
import type { EventFilter } from '../domain/eventFilter.ts';
import { conditionsFor } from './eventFilter.ts';
import { lotStatus } from '../domain/lotState.ts';
import type { LedgerState, SelectionStage } from '../domain/vocabulary.ts';

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type NewSeleccion = {
	lotId: number;
	/** What went in. Defaults to everything the lot holds unsorted. */
	totalKilos: number;
	/** What came out sorted. The rest was picked out. */
	netKilos: number;
	staffId: number;
	notes?: string | null;
	date?: Date;
};

/** Which form of coffee a lot is holding, and therefore which bucket sorting moves. */
export function stageOf(status: string): { stage: SelectionStage; state: LedgerState } {
	return status === 'TOSTADO' ||
		status === 'EN PROCESO TOSTION' ||
		status === 'EN PROCESO TST/SEL' ||
		status === 'TST SELECCIONADO'
		? { stage: 'TOSTADO', state: 'TOSTADO' }
		: { stage: 'VERDE', state: 'VERDE' };
}

/**
 * Writes one sorting, inside a caller's transaction.
 *
 * Shared by recording and by editing, so the stage, the yield rule and the
 * quaker lot have one definition. The balances come from `tx`, which is what
 * lets an edit check its new weights against the lot as it stands once its own
 * entries have been reversed.
 */
function writeSeleccion(tx: Db, input: NewSeleccion, code?: string): number {
	const [lot] = tx.select().from(lots).where(eq(lots.id, input.lotId)).limit(1).all();
	if (!lot) throw new Error('El lote no existe.');

	const ledgerOf = lotLedgerIn(tx, lot.id);
	const { stage, state } = stageOf(lotStatus(lot, ledgerOf));

	// Only unsorted coffee can be sorted; the sorted bucket is already done.
	const unsorted =
		state === 'TOSTADO' ? ledgerOf.balances.tostado : ledgerOf.balances.verde;

	if (input.totalKilos - unsorted > 0.0005) {
		throw new Error(`El lote solo tiene ${unsorted.toFixed(2)} kg sin seleccionar.`);
	}

	const error = validateSeleccionYield(input.totalKilos, input.netKilos, 0);
	if (error) throw new Error(error);

	/**
	 * What was picked out. Quakers and defects are the same act — quakers are the
	 * roasted ones — so this is one number, and the client's standing instruction
	 * decides what becomes of it: a lot of its own, or merma.
	 */
	// Two decimals, like every weight in this system: the subtraction leaves
	// float noise that would otherwise be stored and shown.
	const removed = Math.round((input.totalKilos - input.netKilos) * 100) / 100;
	const keepsQuakers = lot.addQuaker === true && stage === 'TOSTADO' && removed > 0.0005;
	const quakerKilos = keepsQuakers ? removed : 0;

	const date = input.date ?? new Date();

	{
		const [order] = tx.select().from(orders).where(eq(orders.id, lot.orderId)).limit(1).all();

		const [event] = tx
			.insert(seleccion)
			.values({
				// An edit keeps the code it was issued: the row is rewritten, not
				// replaced, however much of it changed.
				code:
					code ??
					nextEventCode(tx, seleccion, seleccion.orderId, lot.orderId, order.code, 'SE'),
				orderId: lot.orderId,
				lotId: lot.id,
				date,
				stage,
				totalKilos: input.totalKilos,
				netKilos: input.netKilos,
				quakerKilos: keepsQuakers ? quakerKilos : null,
				staffId: input.staffId,
				notes: input.notes ?? null
			})
			.returning({ id: seleccion.id })
			.all();

		postEntries(tx, [
			{
				orderId: lot.orderId,
				lotId: lot.id,
				state,
				selected: false,
				kilos: -input.totalKilos,
				eventType: 'seleccion',
				eventId: event.id
			},
			{
				orderId: lot.orderId,
				lotId: lot.id,
				state,
				selected: true,
				kilos: input.netKilos,
				eventType: 'seleccion',
				eventId: event.id
			},
			// The quakers come back unsorted, then leave through a movimiento — the
			// coffee has to pass through the lot before it can leave it.
			...(quakerKilos > 0
				? [
						{
							orderId: lot.orderId,
							lotId: lot.id,
							state,
							selected: false,
							kilos: quakerKilos,
							eventType: 'seleccion' as const,
							eventId: event.id
						}
					]
				: [])
		]);

		if (quakerKilos > 0) {
			/**
			 * One quaker lot per origin, not one per selección.
			 *
			 * A lot roasted and sorted in several batches would otherwise sprout a
			 * quaker lot each time, and they would all have to be combined by hand
			 * before they could be used. The first sorting creates it; every one
			 * after pours into it.
			 */
			const existing = tx
				.select({ id: movements.destinationLotId })
				.from(movements)
				.innerJoin(lots, eq(movements.destinationLotId, lots.id))
				.where(
					and(
						eq(movements.eventType, 'seleccion'),
						isNull(movements.deletedAt),
						isNull(lots.deletedAt),
						eq(lots.kind, 'QUAKER'),
						sql`json_extract(${movements.originLotIds}, '$[0]') = ${lot.id}`
					)
				)
				.all();

			recordMovimiento(tx, {
				orderId: lot.orderId,
				action: existing.length > 0 ? 'TRANSFERIR PESO' : 'SEPARAR LOTE',
				destinationLotId: existing[0]?.id,
				staffId: input.staffId,
				date,
				legs: [{ lotId: lot.id, state, selected: false, kilos: quakerKilos }],
				event: { type: 'seleccion', id: event.id },
				lotOverrides: { kind: 'QUAKER' }
			});
		}

		return event.id;
	}
}

/** Records one sorting. */
export async function recordSeleccion(input: NewSeleccion): Promise<number> {
	return db.transaction((tx) => writeSeleccion(tx, input));
}

/**
 * Rewrites a selección, weights included.
 *
 * Allowed under exactly the condition that undoing is — nothing may have
 * happened since to the lot or to the quaker lot it separated. With nothing
 * standing on it, unwinding it and writing it again cannot invalidate anything
 * downstream, because there is nothing downstream.
 */
export async function updateSeleccion(id: number, input: NewSeleccion): Promise<number> {
	return db.transaction((tx) => {
		const [event] = tx.select().from(seleccion).where(eq(seleccion.id, id)).limit(1).all();
		if (!event) throw new Error('El registro no existe.');
		if (event.deletedAt) throw new Error('Ese registro ya fue deshecho.');

		if (!isSeleccionUndoable(tx, id)) {
			throw new Error(
				'No se puede editar: este lote tiene registros posteriores. ' +
					'Deshaga primero el más reciente.'
			);
		}

		undoSeleccionIn(tx, id);
		tx.update(seleccion)
			.set({ code: `${event.code}-ANULADO-${id}` })
			.where(eq(seleccion.id, id))
			.run();

		return writeSeleccion(tx, input, event.code);
	});
}

/**
 * Whether a selección can still be undone: only if nothing has happened since
 * to the lot or to the quaker lot it separated. The same rule trilla follows.
 */
function isSeleccionUndoable(tx: Db, eventId: number): boolean {
	const own = tx
		.select()
		.from(ledger)
		.where(and(eq(ledger.eventType, 'seleccion'), eq(ledger.eventId, eventId)))
		.all();

	const emitted = tx
		.select()
		.from(movements)
		.where(and(eq(movements.eventType, 'seleccion'), eq(movements.eventId, eventId)))
		.all();

	const emittedEntries = emitted.length
		? tx
				.select()
				.from(ledger)
				.where(
					and(
						eq(ledger.eventType, 'movimiento'),
						inArray(
							ledger.eventId,
							emitted.map((movement) => movement.id)
						)
					)
				)
				.all()
		: [];

	const mine = [...own, ...emittedEntries];
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

/** Undoes a selección, taking its quaker lot with it. */
export async function undoSeleccion(id: number): Promise<void> {
	return db.transaction((tx) => {
		const [event] = tx.select().from(seleccion).where(eq(seleccion.id, id)).limit(1).all();
		if (!event) throw new Error('El registro no existe.');
		if (event.deletedAt) throw new Error('Ese registro ya fue deshecho.');

		if (!isSeleccionUndoable(tx, id)) {
			throw new Error(
				'No se puede deshacer: alguno de estos lotes tiene registros posteriores. ' +
					'Deshaga primero el más reciente.'
			);
		}

		undoSeleccionIn(tx, id);
	});
}

/**
 * The undo itself, without the checks: the caller has already made them, and
 * the edit path needs to unwind an event it is about to write again.
 */
function undoSeleccionIn(tx: Db, id: number): void {
	const emitted = tx
		.select({ id: movements.id })
		.from(movements)
		.where(
			and(
				eq(movements.eventType, 'seleccion'),
				eq(movements.eventId, id),
				isNull(movements.deletedAt)
			)
		)
		.all();

	// The quaker lot goes first, for the same reason trilla's screens do: the
	// lot cannot give back weight it has already handed on.
	for (const movement of emitted) {
		undoMovimientoIn(tx, movement.id, { allowEmitted: true });
	}

	const own = tx
		.select()
		.from(ledger)
		.where(and(eq(ledger.eventType, 'seleccion'), eq(ledger.eventId, id)))
		.all();

	postEntries(
		tx,
		own.map((entry) => ({
			orderId: entry.orderId,
			lotId: entry.lotId,
			state: entry.state,
			selected: entry.selected,
			kilos: -entry.kilos,
			eventType: 'seleccion' as const,
			eventId: id,
			reversesId: entry.id
		}))
	);

	tx.update(seleccion).set({ deletedAt: new Date() }).where(eq(seleccion.id, id)).run();
}

/** A selección as its section lists it. */
export type SeleccionRow = {
	id: number;
	/** ID_EVENTO, which the detail view names the record by. */
	code: string;
	date: Date;
	/** The order this belongs to, for the views that span several. */
	orderId: number;
	orderCode: string;
	/** ID_LOTE of the lot acted on — what its link is built from. */
	lotCode: string;
	stage: SelectionStage;
	lot: string;
	totalKilos: number;
	netKilos: number;
	quakerKilos: number | null;
	defectKilos: number;
	staffName: string | null;
	notes: string | null;
	canUndo: boolean;
	/** The event as its form holds it, for editing. */
	edit: {
		lotId: number;
		totalKilos: number;
		netKilos: number;
		staffId: number;
		notes: string | null;
	};
};

/** Every selección of one order at one stage, newest first. */
export async function listSelecciones(
	filter: EventFilter,
	stage: SelectionStage
): Promise<SeleccionRow[]> {
	const rows = await db
		.select({
			event: seleccion,
			staffName: staff.name,
			orderCode: orders.code,
			lotCode: lots.code,
			letter: lots.letter,
			variety: lots.variety,
			kind: lots.kind
		})
		.from(seleccion)
		.innerJoin(lots, eq(seleccion.lotId, lots.id))
		.innerJoin(orders, eq(seleccion.orderId, orders.id))
		.leftJoin(staff, eq(seleccion.staffId, staff.id))
		.where(
			and(
				eq(seleccion.stage, stage),
				isNull(seleccion.deletedAt),
				...conditionsFor(filter, seleccion)
			)
		);

	return rows
		.map(({ event, staffName, orderCode, lotCode, letter, variety, kind }) => ({
			id: event.id,
			code: event.code,
			date: event.date,
			orderId: event.orderId,
			orderCode,
			lotCode,
			stage: event.stage,
			lot: `${letter} - ${variety}${kind ? ` ${kind}` : ''}`,
			totalKilos: event.totalKilos,
			netKilos: event.netKilos,
			quakerKilos: event.quakerKilos,
			// The remainder: what was picked out and thrown away.
			defectKilos: event.totalKilos - event.netKilos - (event.quakerKilos ?? 0),
			staffName,
			notes: event.notes,
			canUndo: isSeleccionUndoable(db, event.id),
			edit: {
				lotId: event.lotId,
				totalKilos: event.totalKilos,
				netKilos: event.netKilos,
				staffId: event.staffId,
				notes: event.notes
			}
		}))
		.sort((a, b) => b.date.getTime() - a.date.getTime());
}
