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
import { SELECTION_METHODS, SELECTION_METHOD_LABELS } from '$lib/domain/vocabulary';
import type { FieldDef, FieldOption, FormRow } from './types';

/** A lot that can be sorted at this stage. */
export type SeleccionLotOption = FieldOption & {
	/** Unsorted coffee the lot is holding — the cap on what can be sorted. */
	availableKilos: number;
	/** Whether the client wants this lot's quakers kept rather than discarded. */
	keepsQuakers: boolean;
	/** The method the client asked for at this stage, if they asked for one. */
	method?: string;
};

export type SeleccionContext = {
	lots: readonly SeleccionLotOption[];
	staff: readonly FieldOption[];
	/** Which sorting this is. Decides what the removed weight is called. */
	stage: 'VERDE' | 'TOSTADO';
};

export function selectedLot(lots: readonly SeleccionLotOption[], row: FormRow) {
	return lots.find((lot) => lot.value === String(row.lotId ?? ''));
}

export function seleccionFields({ lots, staff, stage }: SeleccionContext): FieldDef[] {
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
			 * Quakers and defects are the same act of picking: quakers are simply the
			 * roasted ones. So the form asks once, the stage decides what it is
			 * called, and the lot's AGREGAR QUAKER decides where it goes — into a lot
			 * of its own, or into merma.
			 *
			 * Entered rather than derived. The difference between what went in and
			 * what came out sorted is the right default and usually the right number,
			 * but the two are weighed separately and a gram can go missing between
			 * the scales; forcing them to agree would put that gram somewhere it did
			 * not happen. What the three weights fail to account for is merma, which
			 * is exactly what merma means.
			 */
			name: 'removedKilos',
			column: 'PESO DEFECTOS (kg)',
			label: stage === 'TOSTADO' ? 'Quakers' : 'Defectos',
			type: 'decimal',
			required: true,
			unit: 'kg',
			validate: (value, row) => {
				const removed = Number(value);
				const total = Number(row.totalKilos || 0);
				const net = Number(row.netKilos || 0);
				if (!Number.isFinite(removed) || removed < 0) return 'Ingrese el peso retirado.';
				if (net + removed - total > 0.0005) {
					return `Lo seleccionado y lo retirado (${formatKilos(net + removed)} kg) superan lo que entra (${formatKilos(total)} kg).`;
				}
				return null;
			},
			hint:
				stage === 'TOSTADO'
					? 'Van a su propio lote si el cliente los pidió; si no, son merma.'
					: 'Se descuentan como merma.'
		},
		{
			/**
			 * Where the quakers go, decided here rather than only in the lot's
			 * specification.
			 *
			 * It opens on what the client asked for — AGREGAR QUAKER on the lot — so
			 * the usual case is reading it, not answering it. But the call is made at
			 * the table with the quakers in front of you, and a batch bad enough to
			 * throw away gets decided then; as a button, the form does not have to be
			 * abandoned to go and edit the lot first.
			 *
			 * Only on the roasted side: green coffee has no quakers, and its defects
			 * are merma and nothing else.
			 */
			name: 'keepQuaker',
			column: 'AGREGAR QUAKER',
			label: 'Guardar quaker',
			type: 'yesno',
			visible: () => stage === 'TOSTADO',
			hint: 'Sí: salen a su propio lote. No: son merma.'
		},
		{
			/**
			 * How this pass was sorted.
			 *
			 * Opens on what the client asked for — METODO SELECCION on the lot, for
			 * this stage — and stays changeable, because the machine can break down
			 * and the work still has to be recorded as it was actually done.
			 *
			 * Nothing downstream calculates from it: sorted coffee is sorted coffee
			 * either way. It is here because the two are priced differently.
			 */
			name: 'method',
			column: 'METODO',
			label: 'Método',
			type: 'enum',
			required: true,
			options: SELECTION_METHODS.map((method) => ({
				value: method,
				label: SELECTION_METHOD_LABELS[method]
			}))
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
	return {
		lotId: '',
		method: '',
		totalKilos: null,
		netKilos: null,
		removedKilos: null,
		keepQuaker: false,
		staffId: '',
		notes: ''
	};
}
