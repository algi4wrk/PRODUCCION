/**
 * Field definitions for an empaque.
 *
 * Ported from the workbook's EMPAQUE sheet, which is REFERENCIAS with the
 * estimate replaced by what actually happened:
 *
 *   PESO (g), BOLSA_ID and MOLIENDA all had `Initial value = [ID_REF].[…]` —
 *   the presentation is copied from the line of the plan being filled, and then
 *   stays editable, because what the client asked for and what the lot yielded
 *   are allowed to differ.
 *
 *   CANTIDAD's Initial value was the whole remaining weight divided by the
 *   presentation size: pack everything you can. Offered as a hint and as the
 *   value the reference panel fills in, never enforced.
 *
 *   PESO EMPAQUE (kg) = gramos × cantidad ÷ 1000, `Valid If <= PESO ACTUAL`.
 *   Shown as it is typed rather than asked for, like REFERENCIAS.PESO KILO.
 *
 *   PESO FINAL = PESO ACTUAL − PESO EMPAQUE, what the lot still has to pack.
 *
 * ID_REF itself is not a field here. Its App formula picked the first unspent
 * reference, which is a guess; the form shows the whole plan instead and lets
 * the operator say which line they are filling — see `EmpaqueForm`.
 */

import { formatKilos, referenceKilos } from '$lib/domain/derived';
import { validateBagSize, validatePackedQuantity } from '$lib/domain/validation';
import {
	CLIENT_BAG_CODE,
	GRIND_TYPES,
	PACKING_INSPECTIONS,
	REFERENCE_GRAMS
} from '$lib/domain/vocabulary';
import { toOptions, type FieldDef, type FieldOption, type FormRow } from './types';
import type { BagOption } from './reference';

/** A lot that can be packed. */
export type EmpaqueLotOption = FieldOption & {
	/** Roasted coffee the lot is holding — the cap on what can be bagged. */
	availableKilos: number;
	variety: string;
};

export type EmpaqueContext = {
	lots: readonly EmpaqueLotOption[];
	bags: readonly BagOption[];
	staff: readonly FieldOption[];
};

export function selectedLot(lots: readonly EmpaqueLotOption[], row: FormRow) {
	return lots.find((lot) => lot.value === String(row.lotId ?? ''));
}

/** Kilos this event will bag, as the form currently stands. */
export function packedKilos(row: FormRow): number {
	return referenceKilos({
		grams: Number(row.grams) || 0,
		quantity: Number(row.quantity) || 0
	});
}

export function empaqueFields({ lots, bags, staff }: EmpaqueContext): FieldDef[] {
	const lotOf = (row: FormRow) => selectedLot(lots, row);
	const availableOf = (row: FormRow) => lotOf(row)?.availableKilos ?? 0;

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
			// Editable for the same reason a reference's size is: the catalogue
			// lists the common presentations, not the only ones.
			name: 'grams',
			column: 'PESO (g)',
			label: 'Tamaño (g)',
			type: 'combo',
			required: true,
			options: REFERENCE_GRAMS.map((grams) => ({
				value: String(grams),
				label: String(grams),
				hint: grams === 1 ? 'granel, por gramo' : undefined
			})),
			newValueLabel: 'Tamaño personalizado.',
			validate: (value) => {
				const grams = Number(value);
				if (!Number.isFinite(grams) || grams <= 0) return 'Ingrese un tamaño en gramos.';
				if (!Number.isInteger(grams)) return 'El tamaño debe ser un número entero de gramos.';
				return null;
			}
		},
		{
			name: 'quantity',
			column: 'CANTIDAD',
			label: 'Cantidad',
			type: 'number',
			required: true,
			unit: 'bolsas',
			// The same rule the server applies, checked here on save.
			validate: (value, row) =>
				validatePackedQuantity(Number(row.grams), Number(value), availableOf(row)),
			hint: 'Empaque lo que salga; el plan es un estimado.'
		},
		{
			// Ports PESO EMPAQUE (kg): gramos × cantidad ÷ 1000, shown as it is typed.
			name: 'kilos',
			column: 'PESO EMPAQUE (kg)',
			label: 'Peso empacado',
			type: 'computed',
			compute: (row) => `${formatKilos(packedKilos(row))} kg`
		},
		{
			// Ports PESO FINAL: what the lot still has left to pack afterwards.
			name: 'remaining',
			column: 'PESO FINAL',
			label: 'Tostado restante',
			type: 'computed',
			compute: (row) => `${formatKilos(availableOf(row) - packedKilos(row))} kg`,
			computeNote: (row) => {
				const left = availableOf(row) - packedKilos(row);
				if (!row.lotId) return '';
				return left > 0.0005 ? 'queda por empacar' : 'el lote queda empacado';
			}
		},
		{
			/**
			 * The same filter the reference form applies: bags that fit the chosen
			 * size, plus the client's own packaging, whose size is unknown. A bag
			 * already selected stays listed even when it stops matching, so the
			 * field never looks empty while holding a value.
			 */
			name: 'bagId',
			column: 'bolsa_id',
			label: 'Bolsa',
			type: 'ref',
			options: (row) => {
				const grams = Number(row.grams);
				if (!Number.isFinite(grams) || grams <= 0) return bags;

				const selected = String(row.bagId ?? '');
				return bags.filter(
					(bag) =>
						bag.sizeGrams === grams || bag.code === CLIENT_BAG_CODE || bag.value === selected
				);
			},
			validate: (value, row) => {
				const bag = bags.find((option) => option.value === String(value));
				if (!bag) return null;
				return validateBagSize(bag.code, bag.sizeGrams, Number(row.grams));
			}
		},
		{
			name: 'grind',
			column: 'MOLIENDA',
			label: 'Molienda',
			type: 'enum',
			required: true,
			options: toOptions(GRIND_TYPES)
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
			// Ports INSPECCION EMPAQUE, with both outcomes named rather than the
			// sheet's one-sided Yes/No.
			name: 'inspection',
			column: 'INSPECCION EMPAQUE',
			label: 'Inspección de empaque',
			type: 'enum',
			required: true,
			options: toOptions(PACKING_INSPECTIONS)
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

/** A blank empaque row. The lot and the chosen reference fill the rest. */
export function blankEmpaque(): FormRow {
	return {
		lotId: '',
		referenceId: '',
		grams: '',
		quantity: null,
		grind: 'GRANO',
		bagId: '',
		/*
		 * Empty on purpose. An inspection that opens on "Aceptado" is one nobody
		 * has to perform: the form would record a pass for every batch where the
		 * operator simply moved on. Required and blank, it is a decision each
		 * time — which is the only thing that makes the answer worth storing.
		 */
		inspection: '',
		staffId: '',
		notes: ''
	};
}
