/**
 * Field definitions for a farm.
 *
 * Farms are a real table because they carry location and grower details that
 * several lots share — unlike variedad, which is only ever a string.
 */

import type { FieldDef } from './types';

export function farmFields(): FieldDef[] {
	return [
		{
			name: 'name',
			column: 'NOMBRE FINCA',
			label: 'Nombre de la finca',
			type: 'text',
			required: true,
			wide: true
		},
		{
			name: 'farmer',
			column: 'AGRICULTOR',
			label: 'Agricultor',
			type: 'text',
			wide: true
		},
		{
			name: 'municipality',
			column: 'MUNICIPIO',
			label: 'Municipio',
			type: 'text'
		},
		{
			name: 'department',
			column: 'DEPARTAMENTO',
			label: 'Departamento',
			type: 'text'
		}
	];
}
