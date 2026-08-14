/**
 * Field definitions for an order.
 *
 * Field order is the one the operator asked for: date (automatic, not shown as
 * an input) → tipo de orden → línea de producto → cliente → marca → peel stick,
 * with the nested lot and reference tables and the notes rendered by the page
 * around this list.
 */

import { ORDER_TYPES, PRODUCT_LINES } from '$lib/domain/vocabulary';
import { toOptions, type FieldDef, type FieldOption, type FormRow } from './types';

/** True when the order is for the roastery's own coffee rather than a client's. */
function isInternal(row: FormRow): boolean {
	return row.type === 'Nacional/Interno';
}

export function orderFields(clients: readonly FieldOption[]): FieldDef[] {
	return [
		{
			name: 'type',
			column: 'TIPO DE ORDEN',
			label: 'Tipo de orden',
			type: 'enum',
			required: true,
			options: toOptions(ORDER_TYPES)
		},
		{
			// Only internal orders carry a product line; for maquila the coffee
			// belongs to the client and the line is theirs to decide.
			name: 'productLine',
			column: 'LINEA DE PRODUCTO',
			label: 'Línea de producto',
			type: 'enum',
			options: toOptions(PRODUCT_LINES),
			required: isInternal,
			visible: isInternal
		},
		{
			// Cliente and marca are both full-width so marca always sits directly
			// below cliente. Without this they land side by side or diagonally
			// depending on whether línea de producto is showing.
			name: 'clientId',
			column: 'cliente_id',
			label: 'Cliente',
			type: 'ref',
			required: true,
			options: clients,
			createLabel: '+ Nuevo cliente',
			wide: true
		},
		{
			// Autofilled from the selected client and stored on the order, as the
			// workbook does today, so the label survives a later client rename.
			name: 'brand',
			column: 'MARCA',
			label: 'Marca',
			type: 'text',
			readonly: true,
			wide: true
		},
		{
			name: 'peelStick',
			column: 'PEEL STICK',
			label: 'Peel stick',
			type: 'yesno',
			hint: 'Servicio facturable.'
		},
		{
			name: 'notes',
			column: 'NOTAS',
			label: 'Notas',
			type: 'longtext',
			wide: true
		}
	];
}
