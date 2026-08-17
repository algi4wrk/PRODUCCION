/**
 * Lot queries.
 *
 * A lot is only ever read inside its order — that is what lets the letter alone
 * name it — so this fetches the order alongside it rather than expecting the
 * caller to make a second trip.
 */

import { and, eq, inArray, isNotNull, isNull, notInArray, or } from 'drizzle-orm';
import { db } from './db/index.ts';
import { clients, farms, ledger, lots, movements, orders, references } from './db/schema.ts';
import { logChange } from './audit.ts';
import { orderLabel } from '../domain/derived.ts';
import { nextLetter } from '../domain/codes.ts';
import { ACTIONS_CREATING_LOT, type SelectionMethods } from '../domain/vocabulary.ts';
import { lotLedger } from './ledger.ts';

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The next free letter for a lot in this order.
 *
 * Letters are not reused, because a code may already be written on a bag and
 * must never come to mean different coffee. The one exception is a lot that was
 * undone: its movimiento was reversed, so it held coffee for seconds and was
 * never labelled. Those give their letter back rather than leaving a gap.
 *
 * The row itself stays — the compensating ledger entries point at it, and the
 * ledger is append-only.
 */
export function nextLotLetter(tx: Db, orderId: number): string {
	// Lots that only ever existed because of a movimiento that has since been
	// undone. A transfer's destination is *not* one of these: it existed before
	// the movimiento and still does, so its letter stays taken.
	const undone = tx
		.select({ id: movements.destinationLotId })
		.from(movements)
		.where(
			and(
				isNotNull(movements.deletedAt),
				inArray(movements.action, [...ACTIONS_CREATING_LOT])
			)
		)
		.all()
		.map((row) => row.id);

	const rows = tx
		.select({ letter: lots.letter })
		.from(lots)
		.where(
			undone.length > 0
				? and(
						eq(lots.orderId, orderId),
						or(isNull(lots.deletedAt), notInArray(lots.id, undone))
					)
				: eq(lots.orderId, orderId)
		)
		.all();

	return nextLetter(rows.map((row) => row.letter));
}

/**
 * One lot with the context needed to render it: its farm's name, and the order
 * it belongs to.
 *
 * `hasReferences` comes along because PASO SIGUIENTE needs it — a lot with no
 * packaging plan behind it finishes EN GRANEL rather than at empaque.
 */
/**
 * The lot id behind a URL segment: ID_LOTE, or a bare number for old links.
 * See `orderIdFor` — same reasoning, same shape.
 */
export async function lotIdFor(param: string): Promise<number | null> {
	if (/^\d+$/.test(param)) return Number(param);

	const [lot] = await db.select({ id: lots.id }).from(lots).where(eq(lots.code, param)).limit(1);
	return lot?.id ?? null;
}

export async function getLot(id: number) {
	const [row] = await db
		.select({
			lot: lots,
			farmName: farms.name,
			order: orders,
			clientName: clients.name
		})
		.from(lots)
		.innerJoin(orders, eq(lots.orderId, orders.id))
		.innerJoin(clients, eq(orders.clientId, clients.id))
		.leftJoin(farms, eq(lots.farmId, farms.id))
		.where(and(eq(lots.id, id), isNull(lots.deletedAt), isNull(orders.deletedAt)))
		.limit(1);

	if (!row) return null;

	const orderReferences = await db
		.select({ id: references.id })
		.from(references)
		.where(and(eq(references.orderId, row.order.id), isNull(references.deletedAt)));

	// Its ledger, so every weight the page shows is a projection over one read.
	const ledger = await lotLedger(row.lot.id);

	return {
		...row.lot,
		ledger,
		farmName: row.farmName,
		order: {
			id: row.order.id,
			code: row.order.code,
			label: orderLabel(row.order, row.clientName),
			clientName: row.clientName,
			status: row.order.status,
			hasReferences: orderReferences.length > 0
		}
	};
}

export type LotDetail = NonNullable<Awaited<ReturnType<typeof getLot>>>;

/**
 * The fields a lot's description may be corrected in.
 *
 * Weight is not among them, here or anywhere: a wrong weight is corrected by a
 * compensating entry, not by editing the number somebody already worked from.
 * PESO INICIAL is likewise a reception fact.
 */
export type LotEdit = {
	variety: string;
	farmId: number | null;
	process: string;
	humidity: number;
	selectionStages: string[];
	/** The method per stage, as METODO SELECCION stores it. */
	selectionMethods: SelectionMethods | null;
	roastType: string;
	screens: string[] | null;
	addQuaker: boolean | null;
	storeInWarehouse: boolean;
};

/** Corrects a lot's description, writing one audit row per field that changed. */
export async function updateLot(id: number, input: LotEdit): Promise<void> {
	const [before] = await db.select().from(lots).where(eq(lots.id, id)).limit(1);
	if (!before) throw new Error('El lote no existe.');

	await db
		.update(lots)
		.set({
			variety: input.variety,
			farmId: input.farmId,
			process: input.process as never,
			humidity: input.humidity,
			selectionStages: input.selectionStages as never,
			selectionMethods: input.selectionMethods,
			roastType: input.roastType as never,
			screens: input.screens as never,
			addQuaker: input.addQuaker,
			storeInWarehouse: input.storeInWarehouse
		})
		.where(eq(lots.id, id));

	const after = { ...before, ...input };
	for (const field of Object.keys(input) as (keyof LotEdit)[]) {
		const from = JSON.stringify(before[field as keyof typeof before] ?? null);
		const to = JSON.stringify(after[field] ?? null);
		if (from !== to) await logChange('lotes', id, field, from, to);
	}
}

/**
 * Soft-deletes a lot, and refuses once anything has happened to it.
 *
 * A lot that has been hulled, sorted or moved is part of other records; making
 * it vanish would leave those describing coffee that no longer exists. Undo the
 * events first — which is the same order every other undo follows.
 */
export async function deleteLot(id: number): Promise<void> {
	const entries = await db.select().from(ledger).where(eq(ledger.lotId, id));

	// Its own arrival is the one entry a lot is allowed to have.
	const beyondReception = entries.filter((entry) => entry.eventType !== 'recepcion');
	if (beyondReception.length > 0) {
		throw new Error(
			'No se puede eliminar: el lote ya tiene registros. Deshágalos primero.'
		);
	}

	await db.update(lots).set({ deletedAt: new Date() }).where(eq(lots.id, id));
}
