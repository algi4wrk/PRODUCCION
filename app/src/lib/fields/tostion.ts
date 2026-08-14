/**
 * Field definitions for a tostión.
 *
 * Ported from the workbook's TOSTION sheet:
 *
 *   ID_LOTE's Valid If — almendra, this order, not bound for bodega, and *not*
 *   a lot still owing a green selección. That last clause is the interesting
 *   one: it stops coffee being roasted before it has been sorted.
 *
 *   TUESTE's Initial value is the lot's TIPO DE TOSTION. Its own enum listed
 *   only Medio and Bajo, which is not the vocabulary the lots use — the full
 *   list is offered instead, since what was run can differ from what was asked.
 *
 *   PESO DEL BACHE's Initial value hid the roaster's capacity in a MIN().
 *   PESO VRD FINAL, the green left over, is shown as it is typed.
 */

import { formatKilos } from '$lib/domain/derived';
import { validateBatch, validateRoasted } from '$lib/domain/validation';
import { ROASTER_BATCH_KILOS, ROAST_TYPES } from '$lib/domain/vocabulary';
import { toOptions, type FieldDef, type FieldOption, type FormRow } from './types';

/** A lot that can go into the roaster. */
export type TostionLotOption = FieldOption & {
	/** Green the lot is holding — the cap on the batch. */
	availableKilos: number;
	/** The profile the client asked for, which the form opens with. */
	roastType: string;
};

export type TostionContext = {
	lots: readonly TostionLotOption[];
	staff: readonly FieldOption[];
};

export function selectedLot(lots: readonly TostionLotOption[], row: FormRow) {
	return lots.find((lot) => lot.value === String(row.lotId ?? ''));
}

export function tostionFields({ lots, staff }: TostionContext): FieldDef[] {
	const lotOf = (row: FormRow) => selectedLot(lots, row);

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
			name: 'roastType',
			column: 'TUESTE',
			label: 'Tueste',
			type: 'enum',
			required: true,
			wide: true,
			options: toOptions(ROAST_TYPES.filter((type) => type !== 'Ninguno')),
			hint: 'Se propone el que pidió el cliente; cámbielo si se tostó distinto.'
		},
		{
			name: 'batchKilos',
			column: 'PESO DEL BACHE (kg)',
			label: 'Peso del bache',
			type: 'decimal',
			required: true,
			unit: 'kg',
			hint: `El tostador recibe ${formatKilos(ROASTER_BATCH_KILOS)} kg por bache.`,
			// The same rule the server applies, so the cap shows while typing.
			validate: (value, row) => validateBatch(lotOf(row)?.availableKilos ?? 0, Number(value))
		},
		{
			name: 'roastedKilos',
			column: 'PESO TOSTADO (kg)',
			label: 'Peso tostado',
			type: 'decimal',
			required: true,
			unit: 'kg',
			validate: (value, row) => validateRoasted(Number(row.batchKilos || 0), Number(value))
		},
		{
			// The roast loss, which nobody enters: it is the water driven off.
			name: 'merma',
			column: '—',
			label: 'Merma del tueste',
			type: 'computed',
			compute: (row) =>
				`${formatKilos(Number(row.batchKilos || 0) - Number(row.roastedKilos || 0))} kg`,
			computeNote: (row) => {
				const batch = Number(row.batchKilos || 0);
				if (batch <= 0) return '';
				const loss = batch - Number(row.roastedKilos || 0);
				return `${((loss / batch) * 100).toFixed(1)} % del bache`;
			}
		},
		{
			// Ports PESO VRD FINAL: what the lot still holds green afterwards, and
			// therefore whether it needs another batch.
			name: 'remaining',
			column: 'PESO VRD FINAL',
			label: 'Verde restante',
			type: 'computed',
			compute: (row) => {
				const available = lotOf(row)?.availableKilos ?? 0;
				return `${formatKilos(available - Number(row.batchKilos || 0))} kg`;
			},
			computeNote: (row) => {
				const left = (lotOf(row)?.availableKilos ?? 0) - Number(row.batchKilos || 0);
				return left > 0.0005 ? 'queda para otro bache' : 'el lote queda sin verde';
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

/** A blank tostión row. The lot decides the rest. */
export function blankTostion(): FormRow {
	return {
		lotId: '',
		roastType: '',
		batchKilos: null,
		roastedKilos: null,
		staffId: '',
		notes: ''
	};
}
