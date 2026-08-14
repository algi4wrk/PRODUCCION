/**
 * Validation rules, ported from the AppSheet `Valid If` expressions.
 *
 * Every function returns a Spanish message when the value is invalid, or null
 * when it passes — messages are user-facing, so they stay in Spanish while the
 * code around them is English.
 */

import {
	CLIENT_BAG_CODE,
	ROASTER_BATCH_KILOS,
	type SelectionStage,
	type Screen
} from './vocabulary.ts';
import { PLAN_TOLERANCE } from './estimates.ts';
import { formatKilos } from './derived.ts';

/**
 * PROCESO SELECCION: "NINGUNO" means no sorting at all, so it cannot be
 * combined with VERDE or TOSTADO.
 */
export function validateSelectionStages(stages: SelectionStage[]): string | null {
	if (stages.length === 0) return 'Seleccione al menos una opción.';
	if (stages.includes('NINGUNO') && stages.length > 1) {
		return '"NINGUNO" no puede combinarse con otras etapas de selección.';
	}
	return null;
}

/**
 * MALLAS A SEPARAR: only meaningful for pergamino, and "Ninguna" excludes the
 * rest for the same reason as above.
 */
export function validateScreens(screens: Screen[] | null, rawMaterial: string): string | null {
	const isPergamino = rawMaterial === 'CPS';
	if (!isPergamino) return null;
	if (!screens || screens.length === 0) {
		return 'Indique las mallas a separar para café pergamino.';
	}
	if (screens.includes('Ninguna') && screens.length > 1) {
		return '"Ninguna" no puede combinarse con otras mallas.';
	}
	return null;
}

/**
 * AGREGAR QUAKER only applies when the client asked for sorting after roasting,
 * since quakers are only visible once the coffee is roasted.
 */
export function requiresQuakerDecision(stages: SelectionStage[]): boolean {
	return stages.includes('TOSTADO');
}

/**
 * BOLSA_ID: the bag's capacity must match the reference presentation, unless
 * the client supplies their own packaging, in which case size is unknown.
 */
export function validateBagSize(
	bagCode: string | null,
	bagSizeGrams: number | null,
	referenceGrams: number
): string | null {
	if (!bagCode) return null;
	if (bagCode === CLIENT_BAG_CODE) return null;
	if (bagSizeGrams !== referenceGrams) {
		return `La bolsa es de ${bagSizeGrams ?? '—'} g y la referencia es de ${referenceGrams} g.`;
	}
	return null;
}

/**
 * VARIEDAD on a reference must be a variety actually present in the order's
 * lots — you cannot promise a client a coffee the order does not contain.
 * "OTRO" is the deliberate escape hatch.
 */
export function validateReferenceVariety(
	variety: string,
	lotVarieties: string[]
): string | null {
	if (variety === 'OTRO') return null;
	if (!lotVarieties.includes(variety)) {
		return `La variedad "${variety}" no está en los lotes de esta orden.`;
	}
	return null;
}

/**
 * The packaging plan cannot promise more coffee than the order will yield.
 *
 * Measured against the *roasted estimate*, not the raw weight received: 46 kg
 * of pergamino honey becomes roughly 28,5 kg of roasted coffee, so comparing
 * against 46 would let an order promise almost twice what it can deliver.
 */
export function validatePlannedWeight(
	plannedKilos: number,
	estimatedKilos: number
): string | null {
	if (estimatedKilos <= 0) return null; // no lots yet, nothing to check against
	// Tolerate rounding: see PLAN_TOLERANCE. A plan that exactly consumes the
	// estimate, or overshoots it by grams, must not be rejected.
	if (plannedKilos - estimatedKilos > PLAN_TOLERANCE) {
		const excess = plannedKilos - estimatedKilos;
		return `El empaque planeado (${formatKilos(plannedKilos)} kg) supera el estimado tostado (${formatKilos(estimatedKilos)} kg) por ${formatKilos(excess)} kg.`;
	}
	return null;
}

/**
 * How many origin lots an action may draw from.
 *
 * The workbook allowed several only when combining:
 *
 *   IF(AND(IN([ACCION/PROCESO], LIST('SEPARAR LOTE','TRANSFERIR PESO')),
 *          COUNT([_THIS]) <> 1), FALSE, TRUE)
 *
 * Transferring is no longer held to that. Pouring three part-lots into one that
 * already exists is the same act performed three times, and making the operator
 * record it three times only invites two of them to be forgotten. What it is
 * *not* is a combo: no new identity appears, because the destination already had
 * one.
 *
 * Separating still takes exactly one origin — a split has one parent by
 * definition — and combining still takes at least two, since a combo of one
 * would mint a new lot id for coffee that still has a single parent.
 */
export function validateOriginCount(action: string, originCount: number): string | null {
	if (originCount === 0) return 'Seleccione al menos un lote origen.';

	if (action === 'COMBINAR LOTE') {
		return originCount < 2 ? 'Combinar necesita al menos dos lotes origen.' : null;
	}

	if (action === 'SEPARAR LOTE') {
		return originCount !== 1 ? 'Separar admite un solo lote origen.' : null;
	}

	return null;
}

/**
 * A leg may not take more than the origin lot is holding.
 *
 * The ledger refuses a negative balance anyway; this is the same rule stated
 * where the operator can see it, before the form is submitted.
 */
export function validateLegWeight(kilos: number, availableKilos: number): string | null {
	if (!Number.isFinite(kilos) || kilos <= 0) return 'Ingrese un peso mayor que cero.';
	if (kilos - availableKilos > 0.0005) {
		return `El lote solo tiene ${formatKilos(availableKilos)} kg disponibles.`;
	}
	return null;
}

/**
 * TRILLA weights.
 *
 * Ports the workbook's Valid If on MALLA 14, which guards the whole set:
 *
 *   [PESO ALMENDRA] + [MALLA 14] + [MALLA 15/16] + [MALLA 17/18] <= [PESO PERGAMINO]
 *
 * Nothing can come out of a hulling that did not go in. What is left over is
 * cisco — the husk — and that is merma, which is why it is never entered: it is
 * whatever the two sides do not account for.
 */
export function validateTrillaYield(
	parchmentKilos: number,
	greenKilos: number,
	screenKilos: readonly number[]
): string | null {
	const out = greenKilos + screenKilos.reduce((sum, kilos) => sum + kilos, 0);
	if (out - parchmentKilos > 0.0005) {
		return `Lo que sale (${formatKilos(out)} kg) no puede superar el pergamino que entra (${formatKilos(parchmentKilos)} kg).`;
	}
	return null;
}

/**
 * How much pergamino a trilla may consume.
 *
 * The workbook compared against PESO INICIAL, the weight the lot was received
 * with. That is wrong once a lot has been split: it would let a trilla consume
 * coffee that has already gone somewhere else. The ledger balance is the honest
 * limit, and for an untouched lot the two are the same number.
 */
export function validateParchmentInput(kilos: number, availableKilos: number): string | null {
	if (!Number.isFinite(kilos) || kilos <= 0) return 'Ingrese el peso del pergamino.';
	if (kilos - availableKilos > 0.0005) {
		return `El lote solo tiene ${formatKilos(availableKilos)} kg de pergamino.`;
	}
	return null;
}

/**
 * SELECCION weights.
 *
 * Ports the workbook's two Valid Ifs, which between them said the same thing
 * twice: what comes out sorted, plus what is set aside as quakers, cannot
 * exceed what went in. The remainder is defects, and defects are merma —
 * which is why the form shows that number rather than asking for it.
 */
export function validateSeleccionYield(
	totalKilos: number,
	netKilos: number,
	quakerKilos: number
): string | null {
	if (!Number.isFinite(netKilos) || netKilos <= 0) return 'Ingrese el peso seleccionado.';
	const out = netKilos + quakerKilos;
	if (out - totalKilos > 0.0005) {
		return `Lo que sale (${formatKilos(out)} kg) no puede superar lo que entra (${formatKilos(totalKilos)} kg).`;
	}
	return null;
}

/**
 * TOSTION weights.
 *
 * Ports the sheet's two Valid Ifs:
 *
 *   [PESO DEL BACHE (kg)] <= [PESO LOTE VERDE]
 *   [PESO TOSTADO (kg)]   <= [PESO DEL BACHE (kg)]
 *
 * A batch cannot be larger than the green the lot is holding, and cannot come
 * out heavier than it went in — roasting drives off water, it never adds any.
 * The difference is the roast loss, which is merma.
 */
export function validateBatch(greenKilos: number, batchKilos: number): string | null {
	if (!Number.isFinite(batchKilos) || batchKilos <= 0) return 'Ingrese el peso del bache.';
	// The machine's limit, enforced rather than merely proposed: a batch larger
	// than the roaster did not happen.
	if (batchKilos - ROASTER_BATCH_KILOS > 0.0005) {
		return `El tostador recibe ${formatKilos(ROASTER_BATCH_KILOS)} kg por bache; divida el lote en varios.`;
	}
	if (batchKilos - greenKilos > 0.0005) {
		return `El lote solo tiene ${formatKilos(greenKilos)} kg de café verde.`;
	}
	return null;
}

/** What comes out cannot outweigh what went in: roasting drives off water. */
export function validateRoasted(batchKilos: number, roastedKilos: number): string | null {
	if (!Number.isFinite(roastedKilos) || roastedKilos <= 0) return 'Ingrese el peso tostado.';
	if (roastedKilos - batchKilos > 0.0005) {
		return `El café tostado (${formatKilos(roastedKilos)} kg) no puede pesar más que el bache (${formatKilos(batchKilos)} kg).`;
	}
	return null;
}

/** Both halves, for the server. */
export function validateTostion(
	greenKilos: number,
	batchKilos: number,
	roastedKilos: number
): string | null {
	return validateBatch(greenKilos, batchKilos) ?? validateRoasted(batchKilos, roastedKilos);
}

/**
 * EMPAQUE: `[PESO EMPAQUE (kg)] <= [PESO ACTUAL (kg)]`.
 *
 * The sheet computed PESO ACTUAL as the lot's weight minus everything already
 * packed from it; here that is simply what the lot still holds roasted, since
 * packing moved the rest into the EMPACADO bucket.
 *
 * Bags are whole things, so the quantity is checked rather than the weight: a
 * message about 4,3 bags is more useful than one about 1,075 kg.
 */
export function validatePackedQuantity(
	grams: number,
	quantity: number,
	availableKilos: number
): string | null {
	if (!Number.isFinite(quantity) || quantity <= 0) return 'Ingrese la cantidad de bolsas.';
	if (!Number.isInteger(quantity)) return 'La cantidad debe ser un número entero de bolsas.';
	if (!Number.isFinite(grams) || grams <= 0) return 'Elija el tamaño de la presentación.';

	const kilos = (quantity * grams) / 1000;
	if (kilos - availableKilos > 0.0005) {
		const fit = Math.floor((availableKilos * 1000) / grams);
		return (
			`${formatKilos(kilos)} kg supera los ${formatKilos(availableKilos)} kg ` +
			`tostados del lote (caben ${fit}).`
		);
	}
	return null;
}
