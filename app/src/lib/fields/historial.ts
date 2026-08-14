/**
 * The HISTORIAL filter, declared like every other form in the app.
 *
 * One field decides *what* is listed and the rest decide *which* — and because
 * they are `FieldDef`s, the panel is rendered by the same `Form` that renders a
 * trilla, with the same pickers and the same "+ Nuevo" behaviour suppressed.
 *
 * Estado stays visible on the event views on purpose: filtering trillas by an
 * order's status is a real question ("everything hulled for orders still in
 * process"), and hiding the field would make it look unanswerable.
 */

import { HISTORY_VIEWS } from '$lib/domain/historial';
import { ORDER_STATUSES } from '$lib/domain/vocabulary';
import { toOptions, type FieldDef, type FieldOption, type FormRow } from './types';

export type HistorialContext = {
	orders: readonly FieldOption[];
	clients: readonly FieldOption[];
};

export function historialFields({ orders, clients }: HistorialContext): FieldDef[] {
	return [
		{
			name: 'vista',
			column: '—',
			label: 'Ver',
			type: 'enum',
			required: true,
			wide: true,
			options: HISTORY_VIEWS.map((view) => ({ value: view.value, label: view.label }))
		},
		{
			name: 'cliente',
			column: 'cliente_id',
			label: 'Cliente',
			type: 'ref',
			options: clients
		},
		{
			name: 'orden',
			column: 'ID_ORDEN',
			label: 'Orden',
			type: 'ref',
			options: orders
		},
		{ name: 'desde', column: 'FECHA', label: 'Desde', type: 'date' },
		{ name: 'hasta', column: 'FECHA', label: 'Hasta', type: 'date' },
		{
			// Last, and wide: a row of pills is a poor neighbour for a text field,
			// and putting it here leaves the two dates side by side above it —
			// a range split across rows reads as two unrelated fields.
			name: 'estado',
			column: 'ESTADO ACTUAL',
			label: 'Estado de la orden',
			type: 'enum',
			wide: true,
			options: toOptions(ORDER_STATUSES)
		}
	];
}

/** An empty filter: every order, newest first. */
export function blankHistorial(): FormRow {
	return { vista: 'ordenes', cliente: '', orden: '', estado: '', desde: '', hasta: '' };
}
