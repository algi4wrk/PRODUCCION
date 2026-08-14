/**
 * Yield estimates — how much coffee an order will actually have to deliver.
 *
 * Coffee loses weight at two steps. Trilla removes the parchment, and how much
 * depends on the beneficio: a natural still carries its dried fruit, so it
 * loses far more than a lavado. Roasting then drives off moisture, costing
 * roughly a further fifth.
 *
 * These are planning figures, not measurements. They exist so the packaging
 * plan can be checked against what the order can realistically produce, before
 * anyone has milled or roasted anything. Once REGISTRO exists the real weights
 * replace them.
 *
 * Ported from the LOTES computed columns `ESTIMADO TRILLA (20%)` and
 * `ESTIMADO TOSTADO (20%)`.
 */

import type { ProcessType, RawMaterial } from './vocabulary';

/**
 * Share of pergamino weight surviving trilla, by beneficio.
 *
 * Lavado 80 % · Honey 77,5 % · Natural 70 %.
 */
export const TRILLA_YIELD: Record<ProcessType, number> = {
	Lavado: 0.8,
	Honey: 0.775,
	Natural: 0.7
};

/** Share of green weight surviving the roast. */
export const ROAST_YIELD = 0.8;

/** The lot fields an estimate needs. */
export type EstimableLot = {
	rawMaterial: RawMaterial;
	initialWeight: number;
	process: ProcessType;
};

/**
 * Almendra verde expected from a lot after trilla.
 *
 * Only pergamino goes through trilla; a lot that arrived as almendra or roasted
 * is already past that step and keeps its weight.
 */
export function estimatedGreenKilos(lot: EstimableLot): number {
	if (lot.rawMaterial !== 'CPS') return lot.initialWeight;
	return lot.initialWeight * (TRILLA_YIELD[lot.process] ?? 0);
}

/**
 * Roasted coffee expected from a lot — the figure the packaging plan is
 * measured against, since references are what the client receives.
 *
 * NOTE: this differs deliberately from the source workbook for one case. There,
 * `ESTIMADO TOSTADO` applies the 20 % roast loss to every lot that is not CPS,
 * including lots that arrive already TOSTADO — charging a roast loss twice for
 * coffee that has already been roasted, and under-estimating it by a fifth.
 * No lot in the exported data arrives as TOSTADO, so the case is untested
 * there. Revert by dropping the first branch if the original was intended.
 */
export function estimatedRoastedKilos(lot: EstimableLot): number {
	if (lot.rawMaterial === 'TOSTADO') return lot.initialWeight;
	return estimatedGreenKilos(lot) * ROAST_YIELD;
}

/** Roasted coffee expected from a whole order. */
export function estimatedOrderKilos(lots: EstimableLot[]): number {
	return lots.reduce((total, lot) => total + estimatedRoastedKilos(lot), 0);
}

/**
 * Kilos still free to allocate: the order's roasted estimate minus what the
 * packaging references already claim. Ports `REFERENCIAS.ESTIMADO (kg)`.
 */
export function availableKilos(
	lots: EstimableLot[],
	allocatedKilos: number
): number {
	return estimatedOrderKilos(lots) - allocatedKilos;
}

/**
 * Display tolerance, in kilos. Weights are shown to two decimals, so anything
 * under 5 g cannot be rendered anyway and would surface as a misleading
 * "-0,00 kg" in red.
 */
export const DISPLAY_EPSILON = 0.005;

/**
 * How far a packaging plan may exceed the estimate before it is rejected.
 *
 * Not zero, and the real data says why: JHO-M729A estimates 41,088 kg and its
 * reference is written as 41,09 kg — 2 g over, because someone rounded to the
 * two decimals the app displays. A zero-tolerance rule would reject an order
 * that shipped.
 *
 * 10 g is exactly the rounding allowance that implies, and nothing more: it
 * covers the display precision and still rejects anything a person would call
 * an overcommitment.
 */
export const PLAN_TOLERANCE = 0.01;

/** Kilos left to allocate, with undisplayable differences snapped to zero. */
export function remainingKilos(estimated: number, planned: number): number {
	const remaining = estimated - planned;
	return Math.abs(remaining) < DISPLAY_EPSILON ? 0 : remaining;
}

/**
 * The loss a yield factor implies, as a percentage string — 0.775 becomes
 * "22,5 %". Shown beside an estimate so the figure being applied is visible,
 * since the trilla factor changes with the beneficio and the three levels are
 * otherwise indistinguishable in the result.
 */
export function lossPercent(yieldFactor: number): string {
	const loss = (1 - yieldFactor) * 100;
	return `${loss.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;
}

/** How many bags of a given size fit in the remaining weight. */
export function maxUnits(availableKilos: number, grams: number): number {
	if (!Number.isFinite(grams) || grams <= 0) return 0;
	return Math.max(0, Math.floor((availableKilos * 1000) / grams));
}
