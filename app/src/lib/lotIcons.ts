/**
 * A small mark for each lot state, so the floor can read the board by shape and
 * colour before reading any words.
 *
 * The vocabulary is the one already used on the floor: pergamino is an egg —
 * the bean still in its shell — almendra is a leaf, roasted is a flame, and
 * anything part way through is an arc that has not closed. Packing is a box,
 * open while it is being filled and shut once the coffee can leave.
 *
 * The colours match the step colours on the board: green for selección, orange
 * for tostión, sky for empaque.
 */

import type { IconName } from './icons';

export type LotMark = { icon: IconName; class: string };

const MARKS: Record<string, LotMark> = {
	// Still in parchment: nothing has been done to it yet.
	CPS: { icon: 'egg', class: 'text-amber-500' },

	// Almendra, in every form it takes before roasting.
	AV: { icon: 'leaf', class: 'text-emerald-600 dark:text-emerald-400' },
	'AV SELECCIONADO': { icon: 'leaf', class: 'text-emerald-700 dark:text-emerald-300' },
	'EN PROCESO SELECCION': { icon: 'loader', class: 'text-emerald-600 dark:text-emerald-400' },

	// Roasting, and roasted.
	'EN PROCESO TOSTION': { icon: 'loader', class: 'text-orange-500' },
	TOSTADO: { icon: 'flame', class: 'text-orange-500' },

	// Sorted after the roast.
	'EN PROCESO TST/SEL': { icon: 'loader', class: 'text-violet-500' },
	'TST SELECCIONADO': { icon: 'gem', class: 'text-violet-500' },
	'MOLIDO CON QUAKER': { icon: 'grind', class: 'text-violet-500' },

	// Packing: open while being filled, shut when the order can leave.
	'EN PROCESO EMPAQUE': { icon: 'boxOpen', class: 'text-sky-500' },
	EMPACADO: { icon: 'box', class: 'text-sky-600 dark:text-sky-400' },

	// Folded into another lot; it lives on under that one's name.
	COMBINADO: { icon: 'merge', class: 'text-muted' }
};

/** The mark for a lot state, or null for one that has none. */
export function lotMark(status: string): LotMark | null {
	return MARKS[status] ?? null;
}
