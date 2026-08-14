/**
 * Field definitions for a trilla.
 *
 * Ported from the workbook's TRILLA sheet: its Valid If on ID_LOTE decides
 * which lots may be hulled, its Show? on each MALLA decides which screens are
 * asked for, and its Initial values decide what the form opens with.
 *
 * Two deliberate departures, both because the ledger knows better than the
 * sheet did:
 *
 *   PESO PERGAMINO was capped at PESO INICIAL, the weight received. That is
 *   wrong once a lot has been split — it would let a hulling consume coffee
 *   that has already left. The cap is the lot's current balance.
 *
 *   The lot list was filtered on ESTADO ACTUAL = "CPS", a stored string. It is
 *   now filtered on the derived status, which cannot disagree with the weights.
 */

import { formatKilos } from '$lib/domain/derived';
import { validateParchmentInput } from '$lib/domain/validation';
import type { FieldDef, FieldOption, FormRow } from './types';

/** A lot that can be hulled, with what the form needs to fill itself in. */
export type TrillaLotOption = FieldOption & {
	/** Pergamino the lot is holding — the cap on what a trilla may consume. */
	availableKilos: number;
	/** The estimate for this lot's beneficio, which the form opens with. */
	estimatedGreenKilos: number;
	/** Screens the client asked to have separated. */
	screens: string[];
};

export type TrillaContext = {
	lots: readonly TrillaLotOption[];
	staff: readonly FieldOption[];
};

/** The screens, in the order the workbook lists them. */
export const TRILLA_SCREENS = [
	{ screen: '14', name: 'screen14', label: 'Malla 14' },
	{ screen: '15/16', name: 'screen1516', label: 'Malla 15/16' },
	{ screen: '17/18', name: 'screen1718', label: 'Malla 17/18' }
] as const;

/** The lot chosen in the form, if any. */
export function selectedLot(lots: readonly TrillaLotOption[], row: FormRow) {
	return lots.find((lot) => lot.value === String(row.lotId ?? ''));
}

export function trillaFields({ lots, staff }: TrillaContext): FieldDef[] {
	const lotOf = (row: FormRow) => selectedLot(lots, row);

	return [
		{
			name: 'lotId',
			column: 'ID_LOTE',
			label: 'Lote',
			type: 'ref',
			required: true,
			wide: true,
			// Ports the Valid If: pergamino only, this order only, and never a lot
			// the client asked to store rather than process. The list itself says
			// which lots qualify, so no note has to.
			options: lots
		},
		{
			name: 'parchmentKilos',
			column: 'PESO PERGAMINO',
			label: 'Peso pergamino',
			type: 'decimal',
			required: true,
			unit: 'kg',
			validate: (value, row) =>
				validateParchmentInput(Number(value), lotOf(row)?.availableKilos ?? 0)
		},
		{
			name: 'greenKilos',
			column: 'PESO ALMENDRA',
			label: 'Peso almendra',
			type: 'decimal',
			required: true,
			unit: 'kg',
			hint: 'Sin contar las mallas separadas.',
			validate: (value) =>
				Number(value) > 0 ? null : 'Ingrese el peso de la almendra.'
		},
		// One field per screen, each shown only when the lot's specification asks
		// for it — the workbook's Show?: IN("14", [ID_LOTE].[MALLAS A SEPARAR]).
		...TRILLA_SCREENS.map(({ screen, name, label }) => ({
			name,
			column: `MALLA ${screen}`,
			label,
			type: 'decimal' as const,
			unit: 'kg',
			required: (row: FormRow) => lotOf(row)?.screens.includes(screen) ?? false,
			visible: (row: FormRow) => lotOf(row)?.screens.includes(screen) ?? false,
			validate: (value: unknown) =>
				Number(value) > 0 ? null : 'Ingrese el peso separado en esta malla.'
		})),
		{
			// Not a field in the sheet: cisco is what the two sides do not account
			// for. Shown as it is typed so the operator can see the yield land where
			// they expect before saving.
			name: 'merma',
			column: '—',
			label: 'Merma (cisco)',
			type: 'computed',
			compute: (row) => {
				const out =
					Number(row.greenKilos || 0) +
					TRILLA_SCREENS.reduce((sum, { name }) => sum + Number(row[name] || 0), 0);
				return `${formatKilos(Number(row.parchmentKilos || 0) - out)} kg`;
			},
			computeNote: (row) => {
				const parchment = Number(row.parchmentKilos || 0);
				if (parchment <= 0) return '';
				const out =
					Number(row.greenKilos || 0) +
					TRILLA_SCREENS.reduce((sum, { name }) => sum + Number(row[name] || 0), 0);
				return `${((1 - out / parchment) * 100).toFixed(1)} % del pergamino`;
			}
		},
		{
			name: 'staffId',
			column: 'RESPONSABLE',
			label: 'Responsable',
			type: 'ref',
			required: true,
			options: staff,
			createLabel: '+ Nuevo responsable'
		},
		{
			name: 'notes',
			column: 'OBSERVACIONES',
			label: 'Observaciones',
			type: 'longtext',
			wide: true
		}
	];
}

/** A blank trilla row. Weights are filled in when a lot is chosen. */
export function blankTrilla(): FormRow {
	return {
		lotId: '',
		parchmentKilos: null,
		greenKilos: null,
		screen14: null,
		screen1516: null,
		screen1718: null,
		staffId: '',
		notes: ''
	};
}
