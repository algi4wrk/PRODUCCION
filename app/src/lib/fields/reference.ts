/**
 * Field definitions for a packaging reference.
 *
 * A reference is an *estimate* of what the client expects to receive. EMPAQUE
 * events later execute against it, which is why it is recorded at order
 * creation rather than at the end.
 *
 * PESO KILO is not a field: it is grams × quantity ÷ 1000, shown as it is typed.
 */

import { GRIND_TYPES, REFERENCE_GRAMS, VARIETIES, CLIENT_BAG_CODE } from '$lib/domain/vocabulary';
import { validateBagSize, validateReferenceVariety } from '$lib/domain/validation';
import { maxUnits, remainingKilos } from '$lib/domain/estimates';
import { formatKilos, referenceKilos } from '$lib/domain/derived';
import { toOptions, type FieldDef, type FieldOption, type FormRow } from './types';

/** A bag option carries its capacity so the size rule can be checked client-side. */
export type BagOption = FieldOption & { sizeGrams: number | null; code: string };

export type ReferenceContext = {
	bags: readonly BagOption[];
	/** Varieties present in the order's lots — a reference cannot promise others. */
	lotVarieties: readonly string[];
	/**
	 * Kilos still free to allocate: the order's roasted estimate minus what the
	 * other references already claim. Ports `REFERENCIAS.ESTIMADO (kg)`.
	 * Zero means there are no lots yet, and the check is skipped.
	 */
	availableKilos: number;
};

export function referenceFields({
	bags,
	lotVarieties,
	availableKilos
}: ReferenceContext): FieldDef[] {
	return [
		{
			// Editable: the listed sizes are the common ones, not the only ones —
			// a client can ask for a presentation the catalogue has never seen.
			// Labels are bare numbers so a typed size reads back the same way.
			name: 'grams',
			column: 'REFERENCIAS (g)',
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
			},
			hint: 'Use 1 para café entregado a granel.'
		},
		{
			/**
			 * Bounded by what the order can still yield. Ports the AppSheet rule
			 * `cantidad × gramos ÷ 1000 ≤ ESTIMADO (kg)`, and the hint reports how
			 * many units fit — the figure its `Initial value` used to guess.
			 */
			name: 'quantity',
			column: 'Cantidad',
			label: 'Cantidad',
			type: 'number',
			required: true,
			validate: (value, row) => {
				const quantity = Number(value);
				if (quantity <= 0) return 'La cantidad debe ser mayor que cero.';
				if (!Number.isInteger(quantity)) return 'La cantidad debe ser un número entero.';

				const grams = Number(row.grams);
				if (availableKilos <= 0 || !Number.isFinite(grams) || grams <= 0) return null;

				const kilos = (quantity * grams) / 1000;
				if (kilos > availableKilos) {
					return `${formatKilos(kilos)} kg supera los ${formatKilos(availableKilos)} kg disponibles (caben ${maxUnits(availableKilos, grams)}).`;
				}
				return null;
			},
			hint:
				availableKilos > 0
					? `Quedan ${formatKilos(availableKilos)} kg estimados por asignar.`
					: undefined
		},
		{
			// Ports PESO KILO: cantidad × gramos ÷ 1000, shown live as it is typed.
			name: 'kilos',
			column: 'PESO KILO',
			label: 'Peso de esta línea',
			type: 'computed',
			compute: (row) =>
				`${formatKilos(referenceKilos({ grams: Number(row.grams) || 0, quantity: Number(row.quantity) || 0 }))} kg`
		},
		{
			// Ports ESTIMADO (kg): what is left of the order's roasted estimate
			// once this line is taken out too, so the operator sees the budget
			// shrink as they type rather than only on rejection.
			name: 'remaining',
			column: 'ESTIMADO (kg)',
			label: 'Disponible después',
			type: 'computed',
			compute: (row) => {
				const kilos = referenceKilos({
					grams: Number(row.grams) || 0,
					quantity: Number(row.quantity) || 0
				});
				return `${formatKilos(remainingKilos(availableKilos, kilos))} kg`;
			}
		},
		{
			name: 'grind',
			column: 'Tipo de Molienda',
			label: 'Molienda',
			type: 'enum',
			required: true,
			options: toOptions(GRIND_TYPES)
		},
		{
			// Restricted to what the order actually contains, plus OTRO as the
			// deliberate escape hatch. Falls back to the full list while the order
			// has no lots yet.
			name: 'variety',
			column: 'VARIEDAD',
			label: 'Variedad',
			type: 'enum',
			required: true,
			options: () =>
				lotVarieties.length > 0
					? toOptions([...lotVarieties, 'OTRO'])
					: toOptions(VARIETIES),
			validate: (value) => validateReferenceVariety(String(value), [...lotVarieties])
		},
		{
			/**
			 * Filtered to bags that actually fit the chosen size, plus the
			 * client's own packaging, whose size is unknown. Ports the AppSheet
			 * Valid If, but as a filter rather than an error: a bag that cannot
			 * hold this presentation should not be offerable in the first place.
			 *
			 * A bag already selected stays listed even when it stops matching —
			 * change the size after picking a bag and the field would otherwise
			 * look empty while still holding a value. The `validate` rule then
			 * explains why it is wrong.
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
						bag.sizeGrams === grams ||
						bag.code === CLIENT_BAG_CODE ||
						bag.value === selected
				);
			},
			validate: (value, row) => {
				const bag = bags.find((option) => option.value === String(value));
				if (!bag) return null;
				return validateBagSize(bag.code, bag.sizeGrams, Number(row.grams));
			},
			hint: 'Solo se muestran bolsas del tamaño elegido.'
		}
	];
}

/** The columns shown when references are listed. */
/**
 * A blank reference row. Shared by the creation form and the order page's
 * "+ Nueva referencia", so both start from the same defaults.
 */
export function blankReference(defaultVariety = ''): FormRow {
	return { grams: '', quantity: null, grind: 'GRANO', variety: defaultVariety, bagId: '' };
}

export const REFERENCE_SUMMARY_COLUMNS = [
	{ key: 'grams', label: 'Tamaño' },
	{ key: 'quantity', label: 'Cantidad' },
	{ key: 'grind', label: 'Molienda' },
	{ key: 'variety', label: 'Variedad' },
	{ key: 'bag', label: 'Bolsa' },
	{ key: 'kilos', label: 'Peso', unit: 'kg' }
] as const;
