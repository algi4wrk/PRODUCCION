/**
 * Values computed at render time, never stored.
 *
 * In the AppSheet workbook every one of these was a physical column, which is
 * how LOTES reached 55 columns with 37 of them computed. Storing a derived
 * value means it can disagree with its inputs; computing it means it cannot.
 */

import type { Lot, Order, Reference } from '../server/db/schema.ts';
import { greenOf, roastedOf, NO_LEDGER, type LotLedger } from './ledger.ts';
import type { EventType } from './vocabulary.ts';

/** Kilos a reference line represents: grams × quantity ÷ 1000. */
export function referenceKilos(reference: Pick<Reference, 'grams' | 'quantity'>): number {
	return (reference.grams * reference.quantity) / 1000;
}

/** Total kilos planned across an order's packaging references. */
export function plannedKilos(references: Pick<Reference, 'grams' | 'quantity'>[]): number {
	return references.reduce((total, reference) => total + referenceKilos(reference), 0);
}

/** Total kilos received across an order's lots, as weighed at reception. */
export function receivedKilos(lots: Pick<Lot, 'initialWeight'>[]): number {
	return lots.reduce((total, lot) => total + lot.initialWeight, 0);
}

/**
 * Which process sections an order's page should render.
 *
 * These conditions are ported directly from the `Show?` expressions on the
 * ORDENES `PROCESO *` columns: the lot *specifications* decide which sections
 * exist, and the events fill them. Selección appears twice because sorting can
 * be requested before roasting, after it, or both.
 */
export function visibleSections(lots: Pick<Lot, 'rawMaterial' | 'selectionStages' | 'roastType'>[]) {
	return {
		trilla: lots.some((lot) => lot.rawMaterial === 'CPS'),
		seleccionVerde: lots.some((lot) => lot.selectionStages.includes('VERDE')),
		tostion: lots.some((lot) => lot.roastType !== 'Ninguno'),
		seleccionTostado: lots.some((lot) => lot.selectionStages.includes('TOSTADO')),
		empaque: true
	};
}

export type VisibleSections = ReturnType<typeof visibleSections>;

/**
 * The same sections, decided for one lot rather than for an order.
 *
 * An order is a plan, so its sections are its specification: a section that has
 * nothing in it yet is saying "this coffee still needs hulling". A lot is not a
 * plan — it is coffee in a state — and the specification it carries was written
 * for the lot it came from. A lot born already roasted inherits TIPO DE TOSTION
 * from its parent and would show a Tostión section forever, reading as a job
 * nobody is ever going to do.
 *
 * So a lot shows a step when either
 *
 *   · **something was recorded** for it — history is always worth seeing; or
 *   · **the step is still ahead of it** — its specification asks for it and it
 *     is still holding coffee that step could consume.
 *
 * Coffee only moves one way — pergamino → almendra → tostado → empacado — so
 * "still ahead" is just: does the lot hold anything at or before what that step
 * takes in.
 */
export function lotSections(
	lot: Pick<Lot, 'rawMaterial' | 'selectionStages' | 'roastType'> & { kind?: string | null },
	ledger: LotLedger = NO_LEDGER
) {
	const done = (step: EventType) => ledger.events.has(step);
	const green = greenOf(ledger.balances);
	const roasted = roastedOf(ledger.balances);

	// Pergamino is green in the ledger like almendra is, so what tells them apart
	// is whether a trilla has run — the same question `lotStatus` asks.
	const parchment = lot.rawMaterial === 'CPS' && !done('trilla') && green > 0;

	return {
		trilla: done('trilla') || parchment,
		seleccionVerde: done('seleccion') || (lot.selectionStages.includes('VERDE') && green > 0),
		tostion: done('tostion') || (lot.roastType !== 'Ninguno' && green > 0),
		// Quakers are what a selección threw out; sorting them again is refused, so
		// the section would only offer a form that cannot be filled.
		seleccionTostado:
			done('seleccion') ||
			(lot.selectionStages.includes('TOSTADO') && roasted > 0 && lot.kind !== 'QUAKER'),
		empaque: done('empaque') || green + roasted > 0
	};
}

/**
 * Orders sorted for the queue: priority first, then oldest first.
 *
 * The AppSheet app stored a QUEUE number on every row and recomputed it by
 * counting older in-process orders — O(n²) on every render. Position is simply
 * the index in a sorted list.
 */
export function sortForQueue<T extends Pick<Order, 'priority' | 'date'>>(orders: T[]): T[] {
	return [...orders].sort((a, b) => {
		if (a.priority !== b.priority) return a.priority ? -1 : 1;
		return a.date.getTime() - b.date.getTime();
	});
}

/**
 * The display label for an order, ported from the ORDENES LABEL formula.
 * Prefers the brand, falls back to the client name.
 */
export function orderLabel(order: Pick<Order, 'brand'>, clientName: string): string {
	return order.brand?.trim() ? `${order.brand} - ${clientName}` : clientName;
}

/**
 * A weight for display: one decimal, and a second only when there is one.
 *
 * Weights are recorded to two decimals, but most of them end in a zero, and a
 * column of `46,00` spends ink on nothing. The first decimal always shows so the
 * digits line up; the second appears only when the scale actually said so.
 */
export function formatKilos(kilos: number): string {
	return kilos.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

/** Formats a stored fraction (0.104) as a percentage string (10,4 %). */
export function formatPercent(fraction: number): string {
	return `${(fraction * 100).toLocaleString('es-CO', { maximumFractionDigits: 2 })} %`;
}

/**
 * Formats a timestamp in the Colombian convention.
 *
 * `es-CO` renders the meridiem as "p. m." with a space inside it; the space is
 * removed so timestamps stay compact in table cells.
 */
export function formatDate(date: Date): string {
	return date
		.toLocaleString('es-CO', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		})
		.replace(/ | /g, ' ')
		.replace(/\b([ap])\.\s*m\./gi, '$1.m.');
}
