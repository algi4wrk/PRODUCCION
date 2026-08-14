/**
 * TRILLA — the first process step, and the pattern the other three will follow.
 *
 * One transaction writes the event, the ledger entries, and a movimiento per
 * separated screen. The operator fills in one form; the splits happen behind it.
 * That is the thing the source app could not do: with no loops and no
 * transactions, three screens meant a conditional automation adding a row at a
 * time, and the new lots could not carry anything the form had just measured.
 *
 * How the weights move:
 *
 *   −46,0 VERDE  lote A   trilla        el pergamino que entra
 *   +37,3 VERDE  lote A   trilla        almendra, mallas incluidas
 *   − 2,8 VERDE  lote A   movimiento ┐  la malla sale hacia su propio lote
 *   + 2,8 VERDE  lote D   movimiento ┘
 *
 * The `+37,3` counts the screens because the coffee has to pass *through* the
 * lot before it can leave it — a movimiento's legs must balance, and it cannot
 * take out weight the lot never held. What the two sides fail to account for,
 * 8,7 kg of cisco here, is merma: never entered, never stored, always derived.
 */

import { and, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from './db/index.ts';
import { ledger, lots, movements, orders, staff, trilla } from './db/schema.ts';
import { lotLedgerIn, postEntries } from './ledger.ts';
import { nextEventCode } from './eventCodes.ts';
import { recordMovimiento, undoMovimientoIn } from './movimientos.ts';

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
import { greenOf } from '../domain/ledger.ts';
import { validateParchmentInput, validateTrillaYield } from '../domain/validation.ts';
import type { EventFilter } from '../domain/eventFilter.ts';
import { conditionsFor } from './eventFilter.ts';
import type { Screen } from '../domain/vocabulary.ts';

/** The screens a trilla can separate, and the column each is stored in. */
export const SCREEN_COLUMNS = [
	{ screen: '14' as Screen, field: 'screen14' as const },
	{ screen: '15/16' as Screen, field: 'screen1516' as const },
	{ screen: '17/18' as Screen, field: 'screen1718' as const }
];

export type NewTrilla = {
	lotId: number;
	parchmentKilos: number;
	greenKilos: number;
	/** Keyed by screen; only those the lot's specification asks for. */
	screens: Partial<Record<Screen, number>>;
	staffId: number;
	notes?: string | null;
	date?: Date;
};

/**
 * Writes one hulling, inside a caller's transaction.
 *
 * Both entry points come through here — recording a new trilla and rewriting an
 * edited one — so the validation, the ledger entries and the screen lots have a
 * single definition. Validation runs here as well as in the form, because a form
 * is a convenience and this is the thing that must not be wrong.
 *
 * Reading the balances from `tx` is what makes editing work: an edit reverses
 * its own entries first, and the new weights are checked against the lot as it
 * stands after that.
 */
function writeTrilla(tx: Db, input: NewTrilla, code?: string): number {
	const [lot] = tx.select().from(lots).where(eq(lots.id, input.lotId)).limit(1).all();
	if (!lot) throw new Error('El lote no existe.');

	const available = greenOf(lotLedgerIn(tx, lot.id).balances);

	const parchmentError = validateParchmentInput(input.parchmentKilos, available);
	if (parchmentError) throw new Error(parchmentError);

	const screenKilos = Object.values(input.screens).filter((kilos) => kilos > 0);
	const yieldError = validateTrillaYield(input.parchmentKilos, input.greenKilos, screenKilos);
	if (yieldError) throw new Error(yieldError);

	const date = input.date ?? new Date();
	const [order] = tx.select().from(orders).where(eq(orders.id, lot.orderId)).limit(1).all();

	const [event] = tx
		.insert(trilla)
		.values({
			// An edit keeps the code it was issued: the row is rewritten, not
			// replaced, however much of it changed.
			code: code ?? nextEventCode(tx, trilla, trilla.orderId, lot.orderId, order.code, 'TR'),
			orderId: lot.orderId,
			lotId: lot.id,
			date,
			parchmentKilos: input.parchmentKilos,
			greenKilos: input.greenKilos,
			screen14: input.screens['14'] ?? null,
			screen1516: input.screens['15/16'] ?? null,
			screen1718: input.screens['17/18'] ?? null,
			staffId: input.staffId,
			notes: input.notes ?? null
		})
		.returning({ id: trilla.id })
		.all();

	// Almendra including the screens: they leave through movimientos below,
	// and a movimiento cannot take out weight the lot never held.
	const separated = screenKilos.reduce((sum, kilos) => sum + kilos, 0);

	postEntries(tx, [
		{
			orderId: lot.orderId,
			lotId: lot.id,
			state: 'VERDE',
			kilos: -input.parchmentKilos,
			eventType: 'trilla',
			eventId: event.id
		},
		{
			orderId: lot.orderId,
			lotId: lot.id,
			state: 'VERDE',
			kilos: input.greenKilos + separated,
			eventType: 'trilla',
			eventId: event.id
		}
	]);

	// One lot per separated screen, each emitted rather than typed.
	for (const { screen } of SCREEN_COLUMNS) {
		const kilos = input.screens[screen];
		if (!kilos || kilos <= 0) continue;

		recordMovimiento(tx, {
			orderId: lot.orderId,
			action: 'SEPARAR LOTE',
			staffId: input.staffId,
			date,
			legs: [{ lotId: lot.id, state: 'VERDE', kilos }],
			event: { type: 'trilla', id: event.id },
			// The screen lot is almendra, carries only the screen it was separated
			// on — not the parent's whole list — and says so in its name.
			lotOverrides: {
				rawMaterial: 'AV',
				screens: [screen],
				status: 'AV',
				kind: `MALLA ${screen}`
			}
		});
	}

	return event.id;
}

/** Records one hulling. */
export async function recordTrilla(input: NewTrilla): Promise<number> {
	return db.transaction((tx) => writeTrilla(tx, input));
}

/**
 * Rewrites a trilla, weights included.
 *
 * Allowed under exactly the condition that undoing is: nothing may have
 * happened since to any lot it touched. That is what makes rewriting safe —
 * with nothing standing on it, unwinding it and writing it again cannot
 * invalidate anything downstream, because there is nothing downstream.
 *
 * It is done as an undo followed by a write, in one transaction, so the ledger
 * keeps its append-only shape: the old entries are reversed rather than edited,
 * and the correction stays legible afterwards.
 */
export async function updateTrilla(id: number, input: NewTrilla): Promise<number> {
	return db.transaction((tx) => {
		const [event] = tx.select().from(trilla).where(eq(trilla.id, id)).limit(1).all();
		if (!event) throw new Error('El registro no existe.');
		if (event.deletedAt) throw new Error('Ese registro ya fue deshecho.');

		if (!isTrillaUndoable(tx, id)) {
			throw new Error(
				'No se puede editar: alguno de los lotes de esta trilla tiene registros posteriores. ' +
					'Deshaga primero el más reciente.'
			);
		}

		undoTrillaIn(tx, id);
		// The retired row keeps a code of its own, the way undone lots do, so the
		// rewritten trilla can carry the original.
		tx.update(trilla).set({ code: `${event.code}-ANULADO-${id}` }).where(eq(trilla.id, id)).run();

		return writeTrilla(tx, input, event.code);
	});
}

/**
 * Whether a trilla can still be undone.
 *
 * The same rule movimientos follow: only if nothing has happened since to any
 * lot it touched — the lot itself and every screen it separated. A malla lot
 * that has been combined into something else cannot be un-created; undo that
 * first and this becomes possible again.
 */
function isTrillaUndoable(tx: Db, eventId: number): boolean {
	const own = tx
		.select()
		.from(ledger)
		.where(and(eq(ledger.eventType, 'trilla'), eq(ledger.eventId, eventId)))
		.all();

	const emitted = tx
		.select()
		.from(movements)
		.where(and(eq(movements.eventType, 'trilla'), eq(movements.eventId, eventId)))
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

/**
 * Undoes a trilla: its weight goes back into the lot, and the lots it created
 * for each screen go with it.
 *
 * Order matters. The movimientos come apart first, which returns each screen's
 * weight to the parent and retires the lot it made; only then is the hulling
 * itself reversed. Doing it the other way round would leave the parent briefly
 * owing coffee it had already given away.
 */
export async function undoTrilla(id: number): Promise<void> {
	return db.transaction((tx) => {
		const [event] = tx.select().from(trilla).where(eq(trilla.id, id)).limit(1).all();
		if (!event) throw new Error('El registro no existe.');
		if (event.deletedAt) throw new Error('Ese registro ya fue deshecho.');

		if (!isTrillaUndoable(tx, id)) {
			throw new Error(
				'No se puede deshacer: alguno de los lotes de esta trilla tiene registros posteriores. ' +
					'Deshaga primero el más reciente.'
			);
		}

		undoTrillaIn(tx, id);
	});
}

/**
 * The undo itself, without the checks: the caller has already made them, and
 * `updateTrilla` needs to unwind an event it is about to write again.
 */
function undoTrillaIn(tx: Db, id: number): void {
	const emitted = tx
		.select({ id: movements.id })
		.from(movements)
		.where(
			and(
				eq(movements.eventType, 'trilla'),
				eq(movements.eventId, id),
				isNull(movements.deletedAt)
			)
		)
		.all();

	for (const movement of emitted) {
		undoMovimientoIn(tx, movement.id, { allowEmitted: true });
	}

	const own = tx
		.select()
		.from(ledger)
		.where(and(eq(ledger.eventType, 'trilla'), eq(ledger.eventId, id)))
		.all();

	postEntries(
		tx,
		own.map((entry) => ({
			orderId: entry.orderId,
			lotId: entry.lotId,
			state: entry.state,
			selected: entry.selected,
			kilos: -entry.kilos,
			eventType: 'trilla' as const,
			eventId: id,
			reversesId: entry.id
		}))
	);

	tx.update(trilla).set({ deletedAt: new Date() }).where(eq(trilla.id, id)).run();
}

/** A trilla as its section lists it. */
export type TrillaRow = {
	id: number;
	code: string;
	date: Date;
	/** The order this belongs to, for the views that span several. */
	orderId: number;
	orderCode: string;
	/** ID_LOTE of the lot acted on — what its link is built from. */
	lotCode: string;
	/** The lots this event separated, if any: one per malla, or the quakers. */
	createdLots: { label: string; code: string }[];
	lot: string;
	parchmentKilos: number;
	greenKilos: number;
	screens: { screen: Screen; kilos: number }[];
	mermaKilos: number;
	staffName: string | null;
	notes: string | null;
	/** False while any lot it touched has newer records standing on it. */
	canUndo: boolean;
	/**
	 * The event as its form holds it. Editing is rewriting the same record, so
	 * the form opens on exactly what was entered — not on the display strings the
	 * table shows.
	 */
	edit: {
		lotId: number;
		parchmentKilos: number;
		greenKilos: number;
		screen14: number | null;
		screen1516: number | null;
		screen1718: number | null;
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

/** Every trilla of one order, newest first — or of one lot within it. */
export async function listTrillas(filter: EventFilter): Promise<TrillaRow[]> {
	const rows = await db
		.select({
			event: trilla,
			staffName: staff.name,
			orderCode: orders.code,
			lotCode: lots.code,
			letter: lots.letter,
			variety: lots.variety
		})
		.from(trilla)
		.innerJoin(lots, eq(trilla.lotId, lots.id))
		.innerJoin(orders, eq(trilla.orderId, orders.id))
		.leftJoin(staff, eq(trilla.staffId, staff.id))
		.where(and(isNull(trilla.deletedAt), ...conditionsFor(filter, trilla)));

	const created = await createdLotsBy(
		'trilla',
		rows.map(({ event }) => event.id)
	);

	return rows
		.map(({ event, staffName, orderCode, lotCode, letter, variety }) => {
			const screens = SCREEN_COLUMNS.flatMap(({ screen, field }) =>
				event[field] ? [{ screen, kilos: event[field] as number }] : []
			);
			const separated = screens.reduce((sum, entry) => sum + entry.kilos, 0);

			return {
				id: event.id,
				code: event.code,
				date: event.date,
				orderId: event.orderId,
				orderCode,
				lotCode,
				createdLots: created.get(event.id) ?? [],
				lot: `${letter} - ${variety}`,
				parchmentKilos: event.parchmentKilos,
				greenKilos: event.greenKilos,
				screens,
				// The cisco: what went in, less everything that came out.
				mermaKilos: event.parchmentKilos - event.greenKilos - separated,
				staffName,
				notes: event.notes,
				canUndo: isTrillaUndoable(db, event.id),
				edit: {
					lotId: event.lotId,
					parchmentKilos: event.parchmentKilos,
					greenKilos: event.greenKilos,
					screen14: event.screen14,
					screen1516: event.screen1516,
					screen1718: event.screen1718,
					staffId: event.staffId,
					notes: event.notes
				}
			};
		})
		.sort((a, b) => b.date.getTime() - a.date.getTime());
}
