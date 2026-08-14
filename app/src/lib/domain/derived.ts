/**
 * Values computed at render time, never stored.
 *
 * In the AppSheet workbook every one of these was a physical column, which is
 * how LOTES reached 55 columns with 37 of them computed. Storing a derived
 * value means it can disagree with its inputs; computing it means it cannot.
 */

import type { Lot, Order, Reference } from '../server/db/schema.ts';

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

/** Formats a weight for display: two decimals, Spanish separators. */
export function formatKilos(kilos: number): string {
	return kilos.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
