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
	/** What came out sorted. */
	netKilos: number;
	/**
	 * What was picked out — defects, or quakers once the coffee is roasted.
	 *
	 * Weighed, not inferred: the default is the difference and usually right, but
	 * the three weights come off separate scales and what they fail to account
	 * for is merma. Omitted, it falls back to the difference.
	 */
	removedKilos?: number;
	/**
	 * Whether the quakers are kept. Defaults to the lot's AGREGAR QUAKER — the
	 * client's standing instruction — and the form may override it for this one
	 * sorting, because the call is made with the quakers on the table.
	 */
	keepQuaker?: boolean;
	/**
	 * How this pass was sorted. Omitted, it falls back to what the lot's
	 * specification asks for at this stage — and stays null if it asks for
	 * nothing, since a method nobody stated is not one to invent.
	 */
	method?: string | null;
	staffId: number;
	notes?: string | null;
	date?: Date;
};

/** Which form of coffee a lot is holding, and therefore which bucket sorting moves. */
export function stageOf(status: string): {
	// Narrower than SelectionStage: NINGUNO says a lot is not sorted, so it can
	// never name the stage a sorting happened at.
	stage: Exclude<SelectionStage, 'NINGUNO'>;
	state: LedgerState;
} {
	return status === 'TOSTADO' ||
		status === 'EN PROCESO TOSTION' ||
		status === 'EN PROCESO SEL-TST' ||
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

	if (lot.kind === 'QUAKER') {
		throw new Error('Los quakers ya fueron separados: no se vuelven a seleccionar.');
	}

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
	const removed =
		input.removedKilos === undefined
			? Math.round((input.totalKilos - input.netKilos) * 100) / 100
			: Math.round(input.removedKilos * 100) / 100;

	if (removed < 0 || input.netKilos + removed - input.totalKilos > 0.0005) {
		throw new Error(
			`Lo seleccionado y lo retirado (${(input.netKilos + removed).toFixed(2)} kg) ` +
				`superan lo que entra (${input.totalKilos.toFixed(2)} kg).`
		);
	}
	const keepsQuakers =
		(input.keepQuaker ?? lot.addQuaker === true) && stage === 'TOSTADO' && removed > 0.0005;
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
				// The client's instruction unless the table says otherwise; null when
				// neither names one, which is what lots recorded before this read.
				method: (input.method || lot.selectionMethods?.[stage] || null) as never,
				totalKilos: input.totalKilos,
				netKilos: input.netKilos,
				removedKilos: removed,
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
				/*
				 * A quaker lot is not sorted again — it *is* what a selección threw
				 * out — so it is born saying so rather than inheriting PROCESO
				 * SELECCION from the lot it came out of. Inherited, the spec asked
				 * for a sorting the form refuses to offer, and the board named it as
				 * the lot's next step.
				 *
				 * AGREGAR QUAKER goes with it: it decides where a selección's quakers
				 * go, and this lot is having none.
				 */
				lotOverrides: {
					kind: 'QUAKER',
					selectionStages: ['NINGUNO'],
					selectionMethods: null,
					addQuaker: false
				}
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
	/** The lot this selección separated the quakers into, when it did. */
	createdLots: { label: string; code: string }[];
	stage: SelectionStage;
	/** How it was sorted; null for records made before the field existed. */
	method: string | null;
	lot: string;
	totalKilos: number;
	netKilos: number;
	quakerKilos: number | null;
	/** What was picked out, as weighed. */
	removedKilos: number;
	defectKilos: number;
	staffName: string | null;
	notes: string | null;
	canUndo: boolean;
	/** The event as its form holds it, for editing. */
	edit: {
		lotId: number;
		method: string | null;
		totalKilos: number;
		netKilos: number;
		removedKilos: number;
		staffId: number;
		notes: string | null;
	};
};


/**
 * The lots each event separated, keyed by event id.
 *
 * A step that splits a lot does it through a movimiento, so this reads the
 * lineage rather than guessing from the weights — and it is one query for the
 * whole list, not one per row.
 */
async function createdLotsBy(
	eventType: 'trilla' | 'seleccion',
	ids: number[]
): Promise<Map<number, { label: string; code: string }[]>> {
	const created = new Map<number, { label: string; code: string }[]>();
	if (ids.length === 0) return created;

	const rows = await db
		.select({
			eventId: movements.eventId,
			code: lots.code,
			letter: lots.letter,
			variety: lots.variety,
			kind: lots.kind
		})
		.from(movements)
		.innerJoin(lots, eq(movements.destinationLotId, lots.id))
		.where(
			and(
				eq(movements.eventType, eventType),
				inArray(movements.eventId, ids),
				isNull(movements.deletedAt),
				isNull(lots.deletedAt)
			)
		);

	for (const row of rows) {
		const list = created.get(row.eventId!) ?? [];
		list.push({
			label: `${row.letter} - ${row.variety}${row.kind ? ` ${row.kind}` : ''}`,
			code: row.code
		});
		created.set(row.eventId!, list);
	}
	return created;
}

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

	const created = await createdLotsBy(
		'seleccion',
		rows.map(({ event }) => event.id)
	);

	return rows
		.map(({ event, staffName, orderCode, lotCode, letter, variety, kind }) => ({
			id: event.id,
			code: event.code,
			date: event.date,
			orderId: event.orderId,
			orderCode,
			lotCode,
			createdLots: created.get(event.id) ?? [],
			stage: event.stage,
			method: event.method,
			lot: `${letter} - ${variety}${kind ? ` ${kind}` : ''}`,
			totalKilos: event.totalKilos,
			netKilos: event.netKilos,
			quakerKilos: event.quakerKilos,
			// What was picked out, as weighed. Older rows predate the column and
			// fall back to the difference, which is what they were.
			removedKilos: event.removedKilos ?? event.totalKilos - event.netKilos,
			defectKilos:
				(event.removedKilos ?? event.totalKilos - event.netKilos) - (event.quakerKilos ?? 0),
			staffName,
			notes: event.notes,
			canUndo: isSeleccionUndoable(db, event.id),
			edit: {
				lotId: event.lotId,
				method: event.method,
				totalKilos: event.totalKilos,
				netKilos: event.netKilos,
				removedKilos: event.removedKilos ?? event.totalKilos - event.netKilos,
				staffId: event.staffId,
				notes: event.notes
			}
		}))
		.sort((a, b) => b.date.getTime() - a.date.getTime());
}
