/**
 * One lot as a row of strings.
 *
 * The floor board and the order page's Materia prima table show the same lots,
 * so they show the same columns — from here, rather than from two lists that
 * happen to agree today. Everything is a projection over the lot's ledger; the
 * display never computes a weight.
 */

import { formatKilos, formatPercent } from './derived.ts';
import { NO_LEDGER, type LotLedger } from './ledger.ts';
import {
	currentGreenKilos,
	currentRoastedKilos,
	lotLabel,
	lotStatus,
	nextStep,
	stepTone,
	type ProjectableLot
} from './lotState.ts';
import { formatSelectionStages } from './vocabulary.ts';

/** The columns, in order. `numeric` only makes digits tabular; everything is left aligned. */
export const LOT_ROW_COLUMNS = [
	{ key: 'lote', label: 'Lote' },
	{ key: 'step', label: 'Paso siguiente' },
	{ key: 'greenKilos', label: 'Peso verde', numeric: true },
	{ key: 'roastedKilos', label: 'Peso tostado', numeric: true },
	{ key: 'selection', label: 'Selección' },
	{ key: 'roastType', label: 'Tostión' },
	{ key: 'rawMaterial', label: 'Materia prima' },
	{ key: 'initialWeight', label: 'Peso inicial', numeric: true },
	{ key: 'process', label: 'Beneficio' },
	{ key: 'humidity', label: 'Humedad', numeric: true },
	{ key: 'merma', label: 'Merma', numeric: true },
	{ key: 'mermaPercent', label: '% merma', numeric: true },
	{ key: 'originLots', label: 'Lotes origen' },
	{ key: 'createdLots', label: 'Lotes creados' }
] as const;

/** What a lot needs beyond its own fields to be described. */
export type LotRowContext = {
	ledger?: LotLedger;
	/**
	 * What became of this lot's *own* coffee, wherever it has since travelled.
	 * Only original lots have one — a lot born on the floor received nothing from
	 * the client, so it has no merma of its own to report.
	 */
	merma?: { lostKilos: number; fraction: number } | null;
	/** Whether the order has a packaging plan — decides "EN GRANEL" as a next step. */
	hasReferences: boolean;
	/** Lot letters, since a lot is only ever read inside its own order. */
	originLots?: string;
	createdLots?: string;
};

/** Every value a lot row carries, named — a table cannot ask for a key that is not here. */
export type LotRowValues = {
	lote: string;
	step: string;
	stepTone: string;
	/** The derived state, so a table can draw its mark without deriving it again. */
	status: string;
	greenKilos: string;
	roastedKilos: string;
	selection: string;
	roastType: string;
	rawMaterial: string;
	initialWeight: string;
	process: string;
	humidity: string;
	merma: string;
	mermaPercent: string;
	originLots: string;
	createdLots: string;
};

export function lotRow(
	lot: ProjectableLot & { process: string; roastType: string; humidity: number },
	context: LotRowContext
): LotRowValues {
	const ledger = context.ledger ?? NO_LEDGER;
	const status = lotStatus(lot, ledger);
	const step = nextStep(lot, { hasReferences: context.hasReferences, ledger });

	return {
		lote: lotLabel({ ...lot, status }),
		status,
		step,
		stepTone: stepTone(step),
		greenKilos: formatKilos(currentGreenKilos(lot, ledger)),
		roastedKilos: formatKilos(currentRoastedKilos(lot, ledger)),
		selection: formatSelectionStages(lot.selectionStages),
		roastType: lot.roastType,
		rawMaterial: lot.rawMaterial,
		initialWeight: formatKilos(lot.initialWeight),
		// Reception facts the board has no room for, shown on the order page.
		process: lot.process,
		humidity: formatPercent(lot.humidity),
		// Blank on derived lots: their losses belong to whichever original lot the
		// coffee came from, and showing both would count the same kilo twice.
		merma: context.merma ? formatKilos(context.merma.lostKilos) : '—',
		mermaPercent: context.merma ? formatPercent(context.merma.fraction) : '—',
		originLots: context.originLots || '—',
		createdLots: context.createdLots || '—'
	};
}

/** Picks a subset of the columns, in the order given. */
export function column(keys: readonly string[]) {
	return keys.map((key) => {
		const found = LOT_ROW_COLUMNS.find((candidate) => candidate.key === key);
		if (!found) throw new Error(`No existe la columna ${key}.`);
		return found;
	});
}
