/**
 * Reading the ledger.
 *
 * Pure functions over a list of entries: given what has been posted, what does a
 * lot hold? Writing them is `src/lib/server/ledger.ts`; this file never touches
 * the database, which is what lets `verify.ts` import it under bare Node.
 *
 * The central simplification: a balance is a SUM of signed entries. Nothing
 * depends on the order rows were written in, so there is no "latest reading
 * wins" branch to get wrong, and a correction is just another row.
 */

import type { EventType, LedgerState } from './vocabulary.ts';

/** The entry fields these projections need. */
export type LedgerRow = {
	id: number;
	lotId: number;
	state: LedgerState;
	selected: boolean;
	kilos: number;
	eventType: EventType;
	eventId: number;
	/** Set when this entry undoes another one. */
	reversesId: number | null;
};

/**
 * What a lot holds, split five ways.
 *
 * The selection split is what makes `AV` and `AV SELECCIONADO` distinguishable,
 * and holding weight in both buckets at once is what "half sorted" means — a
 * state the old single status string could not express.
 */
export type LotBalances = {
	verde: number;
	verdeSel: number;
	tostado: number;
	tostadoSel: number;
	empacado: number;
};

/** Everything the status and weight projections read. */
export type LotLedger = {
	balances: LotBalances;
	/** Which process steps have touched this lot. */
	events: Set<EventType>;
	/** The movimiento that emptied this lot, if one did. */
	consumedBy: number | null;
	/**
	 * Weight that arrived from, and left for, another lot.
	 *
	 * Merma needs these: coffee that moved to a child lot has not been lost, and
	 * a lot born on the floor received weight it was never "given" in the
	 * PESO INICIAL sense. Without them a split reads as loss on the parent and as
	 * negative loss on the child.
	 */
	movedIn: number;
	movedOut: number;
};

const ZERO: LotBalances = { verde: 0, verdeSel: 0, tostado: 0, tostadoSel: 0, empacado: 0 };

/** An empty ledger — a lot with nothing posted against it yet. */
export const NO_LEDGER: LotLedger = {
	balances: ZERO,
	events: new Set(),
	consumedBy: null,
	movedIn: 0,
	movedOut: 0
};

/**
 * Sub-gram noise from repeated addition of floats. Weights are recorded to two
 * decimals, so anything under half a gram is arithmetic, not coffee.
 */
const EPSILON = 0.0005;

/** True when a balance is zero for practical purposes. */
export function isEmpty(kilos: number): boolean {
	return Math.abs(kilos) < EPSILON;
}

/** Which bucket an entry lands in. */
function bucketOf(row: LedgerRow): keyof LotBalances {
	if (row.state === 'EMPACADO') return 'empacado';
	if (row.state === 'TOSTADO') return row.selected ? 'tostadoSel' : 'tostado';
	return row.selected ? 'verdeSel' : 'verde';
}

/**
 * Folds one lot's entries into balances plus the two facts that are not
 * weights: which steps have run, and whether a movimiento took the last of it.
 */
export function summarise(rows: readonly LedgerRow[]): LotLedger {
	const balances: LotBalances = { ...ZERO };
	const events = new Set<EventType>();
	let lastMovementOut: number | null = null;
	let movedIn = 0;
	let movedOut = 0;

	/**
	 * Entries that have been undone. A reversal and the entry it reverses cancel
	 * out — including as *evidence*: an undone trilla must stop counting as
	 * "this lot has been hulled", or the lot would keep reporting AV with its
	 * pergamino back in the balance.
	 */
	const reversed = new Set(rows.filter((row) => row.reversesId != null).map((row) => row.reversesId));
	const isLive = (row: LedgerRow) => row.reversesId == null && !reversed.has(row.id);

	for (const row of rows) {
		// Weights always count: the sum of an entry and its reversal is zero, so
		// including both is what makes the balance right.
		balances[bucketOf(row)] += row.kilos;
		if (isLive(row)) events.add(row.eventType);

		if (row.eventType === 'movimiento' && isLive(row)) {
			if (row.kilos < 0) {
				movedOut += -row.kilos;
				// A movimiento that took weight out is a candidate for having emptied
				// the lot; whether it did is decided below, once every row is counted.
				lastMovementOut = row.eventId;
			} else {
				movedIn += row.kilos;
			}
		}
	}

	const consumed = isEmpty(totalOf(balances)) && lastMovementOut !== null;

	return {
		balances,
		events,
		consumedBy: consumed ? lastMovementOut : null,
		movedIn,
		movedOut
	};
}

/** Groups a whole order's entries by lot, so one query serves a page. */
export function summariseByLot(rows: readonly LedgerRow[]): Map<number, LotLedger> {
	const byLot = new Map<number, LedgerRow[]>();
	for (const row of rows) {
		const list = byLot.get(row.lotId);
		if (list) list.push(row);
		else byLot.set(row.lotId, [row]);
	}

	const result = new Map<number, LotLedger>();
	for (const [lotId, lotRows] of byLot) result.set(lotId, summarise(lotRows));
	return result;
}

/** Green coffee in either bucket. */
export function greenOf(balances: LotBalances): number {
	return balances.verde + balances.verdeSel;
}

/** Roasted coffee in either bucket. */
export function roastedOf(balances: LotBalances): number {
	return balances.tostado + balances.tostadoSel;
}

/** Everything the lot holds, packed included — packing is a form, not an exit. */
export function totalOf(balances: LotBalances): number {
	return greenOf(balances) + roastedOf(balances) + balances.empacado;
}
