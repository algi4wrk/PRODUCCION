/**
 * Merma per *original* lot — the coffee the client actually sent.
 *
 * A lot's own merma answers "what disappeared while this lot held it", which is
 * the right question on the floor and the wrong one for a client. Once a lot has
 * been split, combined and split again, what the client wants to know is: of the
 * 46 kg I sent, how much is gone?
 *
 * Answering that by walking the lineage upward does not survive contact with
 * reality. A lot can have two parents, a grandchild can be combined with coffee
 * from a different origin, and a TRANSFERIR can pour weight back into an
 * ancestor — a genuine cycle, which recursion does not come back from.
 *
 * So this does not walk the graph at all. It follows the mass forward through
 * the ledger, in the order things happened:
 *
 *   · every lot carries a mixture — how many of its kilos came from which
 *     original lot;
 *   · a movimiento moves mixture from one lot to another, untouched;
 *   · a process step that ends up lighter took that weight from whatever
 *     mixture was in the lot at that moment, in proportion.
 *
 * That last rule is the only assumption in the whole calculation, and it is a
 * physical fact rather than a modelling choice: once two lots are mixed, nobody
 * can say whose beans were picked out.
 *
 * The result conserves exactly — for every original lot,
 * `recibido = perdido + lo que queda en pie` — so the order's total merma is
 * the sum over originals with nothing counted twice.
 */

import type { LedgerRow } from './ledger.ts';

export type SourceBalance = {
	/** Kilos received from the client. */
	receivedKilos: number;
	/** Kilos of this lot's coffee that have disappeared, anywhere downstream. */
	lostKilos: number;
	/** Kilos still held, across every lot they have since travelled to. */
	standingKilos: number;
};

/** How much of a lot's current weight came from each original lot. */
type Mixture = Map<number, number>;

/** Takes kilos out of a lot proportionally, and reports what came out. */
function drawFrom(mixtures: Map<number, Mixture>, lotId: number, kilos: number): Mixture {
	const mixture = mixtures.get(lotId);
	const drawn: Mixture = new Map();
	if (!mixture) return drawn;

	const held = [...mixture.values()].reduce((sum, value) => sum + value, 0);
	if (held <= 0) return drawn;

	// Never draw more than is there: rounding in the ledger can ask for a gram
	// more than the mixture holds, and a negative share would corrupt every
	// figure downstream of it.
	const taken = Math.min(kilos, held);

	for (const [source, value] of mixture) {
		const share = (value / held) * taken;
		drawn.set(source, share);
		mixture.set(source, value - share);
	}
	return drawn;
}

function addTo(mixtures: Map<number, Mixture>, lotId: number, drawn: Mixture): void {
	const mixture = mixtures.get(lotId) ?? new Map();
	for (const [source, value] of drawn) mixture.set(source, (mixture.get(source) ?? 0) + value);
	mixtures.set(lotId, mixture);
}

/**
 * Runs the ledger forward and reports, per original lot, what became of it.
 *
 * `rows` must be one order's entries. Order does not have to be given: entries
 * are sorted by id here, which is the order they were written in — the ledger
 * is append-only, so a higher id simply is later.
 */
export function sourceBalances(rows: readonly LedgerRow[]): Map<number, SourceBalance> {
	// Undone events drop out entirely: a reversal and the entry it reverses
	// cancel, so the event never happened as far as the mixtures are concerned.
	const reversed = new Set(rows.filter((row) => row.reversesId != null).map((row) => row.reversesId));
	const live = rows
		.filter((row) => row.reversesId == null && !reversed.has(row.id))
		.sort((a, b) => a.id - b.id);

	// One group per event, kept in the order the events happened.
	const events = new Map<string, LedgerRow[]>();
	for (const row of live) {
		const key = `${row.eventType}·${row.eventId}`;
		events.set(key, [...(events.get(key) ?? []), row]);
	}

	const mixtures = new Map<number, Mixture>();
	const received = new Map<number, number>();
	const lost = new Map<number, number>();

	for (const entries of events.values()) {
		const [{ eventType }] = entries;

		if (eventType === 'recepcion') {
			// A lot's arrival makes it an origin: its coffee is its own.
			for (const entry of entries) {
				addTo(mixtures, entry.lotId, new Map([[entry.lotId, entry.kilos]]));
				received.set(entry.lotId, (received.get(entry.lotId) ?? 0) + entry.kilos);
			}
			continue;
		}

		if (eventType === 'movimiento') {
			const destination = entries.find((entry) => entry.kilos > 0);
			if (!destination) continue;
			for (const entry of entries.filter((entry) => entry.kilos < 0)) {
				addTo(mixtures, destination.lotId, drawFrom(mixtures, entry.lotId, -entry.kilos));
			}
			continue;
		}

		// A process step. Whatever it failed to account for was lost, and it came
		// out of the mixture the lot was holding at the time.
		for (const lotId of new Set(entries.map((entry) => entry.lotId))) {
			const net = entries
				.filter((entry) => entry.lotId === lotId)
				.reduce((sum, entry) => sum + entry.kilos, 0);
			if (net >= -0.0005) continue;

			for (const [source, kilos] of drawFrom(mixtures, lotId, -net)) {
				lost.set(source, (lost.get(source) ?? 0) + kilos);
			}
		}
	}

	const standing = new Map<number, number>();
	for (const mixture of mixtures.values()) {
		for (const [source, kilos] of mixture) {
			standing.set(source, (standing.get(source) ?? 0) + kilos);
		}
	}

	const result = new Map<number, SourceBalance>();
	for (const [lotId, receivedKilos] of received) {
		result.set(lotId, {
			receivedKilos,
			lostKilos: lost.get(lotId) ?? 0,
			standingKilos: standing.get(lotId) ?? 0
		});
	}
	return result;
}

/** Merma as a share of what was received. */
export function sourceMermaFraction(balance: SourceBalance): number {
	return balance.receivedKilos === 0 ? 0 : balance.lostKilos / balance.receivedKilos;
}
