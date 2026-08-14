/**
 * Field definitions for a member of staff.
 *
 * PERSONAL is a real table because every process event points at one: who ran
 * the trilla, who sorted, who roasted. A name typed free-hand on each event
 * could not answer "what did Jhon do today".
 */

import type { FieldDef, FormRow } from './types';

export function staffFields(): FieldDef[] {
	return [
		{
			name: 'name',
			column: 'NOMBRE',
			label: 'Nombre',
			type: 'text',
			required: true,
			wide: true
		},
		{
			name: 'position',
			column: 'POSICION',
			label: 'Posición',
			type: 'text',
			wide: true,
			hint: 'Opcional: tostador, selección, empaque…'
		}
	];
}

export function blankStaff(): FormRow {
	return { name: '', position: '' };
}
