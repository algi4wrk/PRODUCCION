/**
 * Field definitions for a selección.
 *
 * Ported from the workbook's SELECCION sheet, with its three conflated jobs
 * pulled apart:
 *
 *   LOTES ADICIONALES let one selección cover several lots and quietly combined
 *   them into a new one. That is a combo — combine first, then sort the result.
 *
 *   SEPARAR LOTE? / PESO LOTE NUEVO split a portion off so quakers could be
 *   recombined into it. That is a split, and it is a movimiento.
 *
 *   PESO DEFECTOS was a required field whose Initial value was the remainder.
 *   It still is the remainder, so it is shown rather than asked for.
 *
 * What is left is the sorting itself: what went in, what came out sorted, and
 * what was set aside as quakers.
 */

import { formatKilos } from '$lib/domain/derived';
import { validateSeleccionYield } from '$lib/domain/validation';
import type { FieldDef, FieldOption, FormRow } from './types';

/** A lot that can be sorted at this stage. */
export type SeleccionLotOption = FieldOption & {
	/** Unsorted coffee the lot is holding — the cap on what can be sorted. */
	availableKilos: number;
	/** Whether the client wants this lot's quakers kept rather than discarded. */
	keepsQuakers: boolean;
};

export type SeleccionContext = {
	lots: readonly SeleccionLotOption[];
	staff: readonly FieldOption[];
};

export function selectedLot(lots: readonly SeleccionLotOption[], row: FormRow) {
	return lots.find((lot) => lot.value === String(row.lotId ?? ''));
}

export function seleccionFields({ lots, staff }: SeleccionContext): FieldDef[] {
	const lotOf = (row: FormRow) => selectedLot(lots, row);

	/** What did not come out sorted: defects, or quakers if they are kept. */
	const removedOf = (row: FormRow) =>
		Number(row.totalKilos || 0) - Number(row.netKilos || 0);

	return [
		{
			name: 'lotId',
			column: 'ID_LOTE',
			label: 'Lote',
			type: 'ref',
			required: true,
			wide: true,
			options: lots
		},
		{
			name: 'totalKilos',
			column: 'PESO TOTAL',
			label: 'Peso a seleccionar',
			type: 'decimal',
			required: true,
			unit: 'kg',
			validate: (value, row) => {
				const available = lotOf(row)?.availableKilos ?? 0;
				if (Number(value) <= 0) return 'Ingrese el peso que entra a selección.';
				if (Number(value) - available > 0.0005) {
					return `El lote solo tiene ${formatKilos(available)} kg sin seleccionar.`;
				}
				return null;
			}
		},
		{
			name: 'netKilos',
			column: 'PESO NETO (kg)',
			label: 'Peso seleccionado',
			type: 'decimal',
			required: true,
			unit: 'kg',
			validate: (value, row) =>
				validateSeleccionYield(Number(row.totalKilos || 0), Number(value), 0)
		},
		{
			/**
			 * What was picked out — one number, whatever becomes of it.
			 *
			 * Quakers and defects are the same act of picking: quakers are simply
			 * the roasted ones. So the form asks once and the lot's AGREGAR QUAKER
			 * decides where it goes — into a lot of its own, or into merma. Asking
			 * twice would invite the two numbers to disagree.
			 */
			name: 'removedKilos',
			column: 'PESO DEFECTOS (kg)',
			label: 'Retirado',
			type: 'computed',
			compute: (row) => `${formatKilos(removedOf(row))} kg`,
			computeNote: (row) => {
				const total = Number(row.totalKilos || 0);
				if (total <= 0) return '';
				const share = `${((removedOf(row) / total) * 100).toFixed(1)} % de lo que entra`;
				return lotOf(row)?.keepsQuakers
					? `${share} · quakers, van a su propio lote`
					: `${share} · merma`;
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

/** A blank selección row. Weights fill in when a lot is chosen. */
export function blankSeleccion(): FormRow {
	return { lotId: '', totalKilos: null, netKilos: null, staffId: '', notes: '' };
}
