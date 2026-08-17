/**
 * The floor board query.
 *
 * One read of every live order with its lots, assembled into the shape the wall
 * display renders: active orders in queue order, each with its active lots
 * beneath it.
 *
 * Deliberately one query plus one grouping pass rather than a query per order —
 * this page refreshes on a monitor all day.
 */

import { and, eq, isNull, ne } from 'drizzle-orm';
import { db } from './db/index.ts';
import { clients, lots, orders, references } from './db/schema.ts';
import { sortForQueue, orderLabel } from '../domain/derived.ts';
import { isActiveLot, lotStatus, type ProjectableLot } from '../domain/lotState.ts';
import { NO_LEDGER, type LotLedger } from '../domain/ledger.ts';
import { allLedgers, allSourceMerma } from './ledger.ts';
import { sourceMermaFraction, type SourceBalance } from '../domain/sourceMerma.ts';
import { lineageByLot } from './movimientos.ts';

export type BoardLot = ProjectableLot & {
	id: number;
	code: string;
	process: string;
	roastType: string;
	humidity: number;
	/** This lot's own ledger, so every weight column is a projection over it. */
	ledger: LotLedger;
	/** Lineage, from movimientos. Lot letters, since a lot is read inside its order. */
	originLots: string;
	createdLots: string;
	/** Only original lots have one; see `sourceMerma`. */
	merma: { lostKilos: number; fraction: number } | null;
};

export type BoardOrder = {
	id: number;
	code: string;
	label: string;
	date: Date;
	priority: boolean;
	status: string;
	/** Whether the order has a packaging plan — decides "EN GRANEL" as a next step. */
	hasReferences: boolean;
	lots: BoardLot[];
};

/**
 * Orders that belong on the floor board.
 *
 * Excludes TERMINADA and PAUSADA for the same reason the queue does: neither is
 * being worked on, and the board answers "what needs doing".
 */
/** A source balance in the shape a row wants, or null for a derived lot. */
function mermaOf(balance: SourceBalance | undefined) {
	return balance
		? { lostKilos: balance.lostKilos, fraction: sourceMermaFraction(balance) }
		: null;
}

export async function loadBoard(): Promise<BoardOrder[]> {
	const orderRows = await db
		.select({ order: orders, clientName: clients.name })
		.from(orders)
		.innerJoin(clients, eq(orders.clientId, clients.id))
		.where(
			and(
				isNull(orders.deletedAt),
				ne(orders.status, 'TERMINADA'),
				ne(orders.status, 'PAUSADA')
			)
		);

	const lotRows = await db.select().from(lots).where(isNull(lots.deletedAt));

	// One query each for balances and lineage, rather than one per lot: this page
	// re-reads itself on a wall monitor all day.
	const [ledgers, lineage, merma] = await Promise.all([
		allLedgers(),
		lineageByLot(),
		allSourceMerma()
	]);
	const letterOf = new Map(lotRows.map((lot) => [lot.id, lot.letter]));
	const letters = (ids: number[] | undefined) =>
		[...new Set(ids ?? [])].map((id) => letterOf.get(id) ?? '?').join(', ');

	const referenceRows = await db
		.select({ orderId: references.orderId })
		.from(references)
		.where(isNull(references.deletedAt));

	const ordersWithReferences = new Set(referenceRows.map((row) => row.orderId));

	const lotsByOrder = new Map<number, BoardLot[]>();
	for (const lot of lotRows) {
		const ledger = ledgers.get(lot.id) ?? NO_LEDGER;
		// Status is derived now, so what leaves the board is decided by what the
		// lot holds — not by a column somebody has to remember to update.
		const status = lotStatus(lot, ledger);
		if (!isActiveLot(status)) continue;

		const list = lotsByOrder.get(lot.orderId) ?? [];
		list.push({
			id: lot.id,
			code: lot.code,
			letter: lot.letter,
			variety: lot.variety,
			status,
			// What the lot is, when it is a by-product: MALLA 14, QUAKER. Without
			// this the board calls a quaker lot plain roasted coffee.
			kind: lot.kind,
			ledger,
			rawMaterial: lot.rawMaterial,
			initialWeight: lot.initialWeight,
			selectionStages: lot.selectionStages,
			screens: lot.screens,
			addQuaker: lot.addQuaker,
			storeInWarehouse: lot.storeInWarehouse,
			process: lot.process,
			roastType: lot.roastType,
			humidity: lot.humidity,
			originLots: letters(lineage.get(lot.id)?.origins),
			createdLots: letters(lineage.get(lot.id)?.created),
			merma: mermaOf(merma.get(lot.id))
		});
		lotsByOrder.set(lot.orderId, list);
	}

	const board = orderRows.map(({ order, clientName }) => ({
		id: order.id,
		code: order.code,
		label: orderLabel(order, clientName),
		date: order.date,
		priority: order.priority,
		status: order.status,
		hasReferences: ordersWithReferences.has(order.id),
		/*
		 * Alphabetical, with anything already packed at the foot of its order.
		 * A finished lot is worth seeing — the order it belongs to is still being
		 * worked — but it needs nothing, so it should not sit between two lots
		 * that do.
		 */
		lots: (lotsByOrder.get(order.id) ?? []).sort(
			(a, b) =>
				Number(a.status === 'EMPACADO') - Number(b.status === 'EMPACADO') ||
				a.letter.localeCompare(b.letter)
		)
	}));

	// Same ordering as the queue: priority first, then oldest.
	return sortForQueue(board);
}
