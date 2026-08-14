/**
 * Lot state projections — what the floor board reads.
 *
 * Ported from the LOTES computed columns: ESTADO ACTUAL, PASO SIGUIENTE,
 * PESO ACTUAL VERDE, PESO ACTUAL TST, PESO TOTAL, MERMA, % MERMA and
 * ETIQUETA DETALLADA.
 *
 * Every function here takes the lot's ledger as an argument. A freshly received
 * lot is not a special case: its reception entry puts its whole weight in the
 * bucket matching the material it arrived as, so the same SUM answers for a lot
 * that nothing has happened to and one that has been through four steps.
 *
 * That is the point of keeping these as projections rather than stored columns.
 * ESTADO ACTUAL is no longer read from the database at all — `lotStatus` derives
 * it here, which is what stops a stored copy and the ledger from disagreeing.
 */

import type { RawMaterial, SelectionStage, Screen } from './vocabulary';
import {
	greenOf,
	isEmpty,
	roastedOf,
	totalOf,
	NO_LEDGER,
	type LotLedger
} from './ledger.ts';

/**
 * The lot state vocabulary from the workbook.
 *
 * Note how much this string is carrying: material form (CPS/AV/TOSTADO),
 * whether work is under way (EN PROCESO …), and a quality flag (SELECCIONADO).
 * That conflation is why the original PASO SIGUIENTE needed a twelve-branch
 * conditional. It is now a projection over balances — see `lotStatus` — and the
 * three dimensions live apart in the ledger.
 *
 * EN PROCESO SELECCION is new. The workbook had no name for a half-sorted lot
 * because it could not represent one: sorted and unsorted weight are the same
 * column there.
 */
export const LOT_STATES = [
	'CPS',
	'AV',
	'AV SELECCIONADO',
	'EN PROCESO SELECCION',
	'EN PROCESO TOSTION',
	'EN PROCESO TST/SEL',
	'TOSTADO',
	'TST SELECCIONADO',
	'MOLIDO CON QUAKER',
	'EN PROCESO EMPAQUE',
	'EMPACADO',
	'COMBINADO'
] as const;
export type LotState = (typeof LOT_STATES)[number];

/** States that mean the lot is finished and should leave the floor board. */
const CLOSED_STATES: readonly string[] = ['EMPACADO', 'COMBINADO'];

/** The lot fields these projections need. */
export type ProjectableLot = {
	letter: string;
	/** By-product marking: "MALLA 14", "QUAKER". Null for coffee as received. */
	kind?: string | null;
	variety: string;
	status: string;
	rawMaterial: RawMaterial;
	initialWeight: number;
	selectionStages: SelectionStage[];
	screens: Screen[] | null;
	addQuaker: boolean | null;
	storeInWarehouse: boolean;
};

/**
 * The lot's ledger, as summarised by `domain/ledger.ts`. Named `LotEvents` no
 * longer: what these functions need is not a list of readings but the balances
 * those readings produce.
 */
export type { LotLedger } from './ledger.ts';

/** True while a lot still belongs on the floor board. */
export function isActiveLot(status: string): boolean {
	return !CLOSED_STATES.includes(status);
}

/**
 * The lot's state, derived from what it holds. Replaces the stored ESTADO
 * ACTUAL, which conflated three independent things into one string.
 *
 * Reads on the two *group* totals first — all green, all roasted — and only
 * splits on the selection flag inside a group. Testing the raw buckets in a flat
 * list would be wrong: a lot holding 10 kg sorted green and 5 kg roasted would
 * fail a `verde > 0 && tostado > 0` test and report TOSTADO, hiding ten kilos.
 *
 * The two kinds of "en proceso" therefore measure different things. Mid-tostión
 * is weight in both *forms* at once; mid-selección is weight in both buckets of
 * one form. A lot that is both reports tostión, the later step.
 */
export function lotStatus(
	lot: Pick<ProjectableLot, 'rawMaterial'>,
	ledger: LotLedger = NO_LEDGER
): LotState {
	const { balances } = ledger;
	const green = greenOf(balances);
	const roasted = roastedOf(balances);
	const packed = balances.empacado;

	// A movimiento took the last of it: the coffee lives on under another id.
	if (ledger.consumedBy !== null) return 'COMBINADO';
	if (isEmpty(green) && isEmpty(roasted) && isEmpty(packed)) return 'COMBINADO';

	if (!isEmpty(packed)) {
		return isEmpty(green) && isEmpty(roasted) ? 'EMPACADO' : 'EN PROCESO EMPAQUE';
	}

	// Both forms at once means a roast is part way through.
	if (!isEmpty(green) && !isEmpty(roasted)) return 'EN PROCESO TOSTION';

	if (!isEmpty(roasted)) {
		if (!isEmpty(balances.tostado) && !isEmpty(balances.tostadoSel)) return 'EN PROCESO TST/SEL';
		if (!isEmpty(balances.tostadoSel)) return 'TST SELECCIONADO';
		return 'TOSTADO';
	}

	if (!isEmpty(balances.verde) && !isEmpty(balances.verdeSel)) return 'EN PROCESO SELECCION';
	if (!isEmpty(balances.verdeSel)) return 'AV SELECCIONADO';

	// Unsorted green: pergamino until trilla has run, almendra after — or on
	// arrival, if it arrived as almendra.
	return lot.rawMaterial === 'CPS' && !ledger.events.has('trilla') ? 'CPS' : 'AV';
}

/**
 * The human-readable lot label: letter, variety and state.
 *
 * Ports ETIQUETA DETALLADA — "C - Castillo - EN PROCESO TOSTION". The full
 * ID_LOTE is a database key, not something to read across a room.
 *
 * A lot that is a by-product says what it is: "D - Castillo - AV MALLA 14",
 * "E - Castillo - TOSTADO QUAKER". That comes from `CLASE`, written by the step
 * that separated it — the workbook inferred the same thing from a blank
 * MATERIA PRIMA INICIAL, which it could afford because that column was optional.
 */
export function lotLabel(
	lot: Pick<ProjectableLot, 'letter' | 'variety' | 'status'> & { kind?: string | null }
): string {
	return `${lot.letter} - ${lot.variety} - ${lot.status}${lot.kind ? ` ${lot.kind}` : ''}`;
}

/**
 * Green coffee the lot currently holds. Ports PESO ACTUAL VERDE.
 *
 * Order matters and follows the original: a tostión reading wins over a trilla
 * reading, which wins over the received weight, because each is a later and
 * more direct measurement of the same coffee.
 */
export function currentGreenKilos(
	lot: ProjectableLot,
	ledger: LotLedger = NO_LEDGER
): number {
	// Sorted and unsorted green are both green; the split only matters to status.
	return greenOf(ledger.balances);
}

/**
 * Roasted coffee the lot currently holds. Ports PESO ACTUAL TST.
 * Quakers are subtracted because they are separated out of the lot.
 */
export function currentRoastedKilos(
	lot: ProjectableLot,
	ledger: LotLedger = NO_LEDGER
): number {
	return roastedOf(ledger.balances);
}

/**
 * Everything the lot holds, in whatever form. Ports PESO TOTAL.
 *
 * Packed coffee counts: an empaque moves weight from TOSTADO to EMPACADO on the
 * same lot rather than taking it away, because the coffee is still there, in
 * bags.
 */
export function totalKilos(lot: ProjectableLot, ledger: LotLedger = NO_LEDGER): number {
	return totalOf(ledger.balances);
}

/**
 * Weight lost. Ports MERMA.
 *
 * What came in, minus what is still here in any form. Nothing records merma:
 * trilla, selección and tostión are exactly the steps where coffee physically
 * disappears, and they post entries that do not balance. The difference is the
 * loss.
 *
 * "Came in" counts weight received from the client *and* weight moved in from
 * another lot; "still here" is the balance plus whatever moved on to another
 * lot. Without those two terms a split reads as loss on the parent, and a lot
 * born on the floor — whose PESO INICIAL is zero, because nothing was received
 * from the client — reports negative merma for the weight it was given.
 */
export function mermaKilos(lot: ProjectableLot, ledger: LotLedger = NO_LEDGER): number {
	const received = lot.initialWeight + ledger.movedIn;
	const accounted = totalKilos(lot, ledger) + ledger.movedOut;
	return received - accounted;
}

/** Loss as a fraction of what was received. Ports % MERMA. */
export function mermaFraction(lot: ProjectableLot, ledger: LotLedger = NO_LEDGER): number {
	if (lot.initialWeight === 0) return 0;
	return mermaKilos(lot, ledger) / lot.initialWeight;
}

/**
 * What this lot needs next. Ports PASO SIGUIENTE.
 *
 * Branch order is the original's and matters: bodega overrides everything,
 * because coffee going to storage is not waiting on a process.
 */
export function nextStep(
	lot: ProjectableLot,
	options: { hasReferences: boolean; ledger?: LotLedger } = { hasReferences: true }
): string {
	const ledger = options.ledger ?? NO_LEDGER;

	if (lot.storeInWarehouse) return 'GUARDAR';

	switch (lotStatus(lot, ledger)) {
		case 'CPS': {
			const screens = (lot.screens ?? []).filter((screen) => screen !== 'Ninguna');
			return screens.length > 0
				? `TRILLAR Y SEPARAR MALLA(S) ${screens.join(', ')}`
				: 'TRILLA';
		}

		case 'AV':
			// Green sorting was requested and has not happened yet.
			return lot.selectionStages.includes('VERDE') ? 'SELECCION VERDE' : 'TOSTION';

		case 'AV SELECCIONADO':
			return 'TOSTION';

		case 'EN PROCESO SELECCION':
			return 'TERMINAR SELECCION VERDE';

		case 'EN PROCESO TOSTION':
			return 'TERMINAR TOSTION';

		case 'EN PROCESO TST/SEL':
			return 'TERMINAR SELECCION/TOSTION';

		case 'TOSTADO': {
			if (lot.selectionStages.includes('TOSTADO')) return 'SELECCION TOSTADO';
			if (lot.addQuaker) return 'MOLER CON QUAKER/EMPACAR';
			// No packaging plan means the client takes it loose.
			if (!options.hasReferences) return 'EN GRANEL';
			return 'MOLIENDA/EMPAQUE';
		}

		case 'TST SELECCIONADO':
			return 'MOLIENDA/EMPAQUE';

		case 'MOLIDO CON QUAKER':
			return 'EMPAQUE';

		case 'EN PROCESO EMPAQUE': {
			// What is left loose: everything the lot holds that is not yet in bags.
			const pending = totalKilos(lot, ledger) - ledger.balances.empacado;
			return `TERMINAR EMPAQUE (${pending.toFixed(2)} kg)`;
		}

		case 'EMPACADO':
			return 'TERMINADO';

		case 'COMBINADO':
			return 'COMBINADO';

		default:
			return '—';
	}
}

/**
 * Groups next steps into buckets so the board can colour them.
 *
 * The buckets match the lot-state marks: green is almendra and its sorting,
 * orange is the roast, violet is sorting after it, sky is packing. A step and
 * the state it leads to therefore read as the same colour, which is what makes
 * the board legible from across the room.
 */
export function stepTone(
	step: string
): 'trilla' | 'seleccionVerde' | 'tostion' | 'seleccionTostado' | 'empaque' | 'bodega' | 'neutral' {
	if (step === 'GUARDAR') return 'bodega';
	if (step.startsWith('TRILLA')) return 'trilla';

	// Sorting after the roast, including the one step that does both at once.
	if (step.includes('SELECCION TOSTADO') || step.includes('SELECCION/TOSTION')) {
		return 'seleccionTostado';
	}
	if (step.includes('SELECCION')) return 'seleccionVerde';

	if (step.includes('TOSTION')) return 'tostion';
	// "MOLER CON QUAKER/EMPACAR" lands here too: whatever is ground and whatever
	// is bagged is on its way out the door.
	if (
		step.includes('EMPAQUE') ||
		step.includes('EMPACAR') ||
		step.includes('MOLIENDA') ||
		step.includes('MOLER') ||
		step.includes('GRANEL')
	) {
		return 'empaque';
	}
	return 'neutral';
}
