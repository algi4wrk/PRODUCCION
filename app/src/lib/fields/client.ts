/**
 * Field definitions for a client.
 *
 * Client and brand live in one row, mirroring the current MARCA sheet: a client
 * has at most one brand, and clients like Gonzalo Garcia have none at all —
 * which is why the brand is optional and the order code falls back to the
 * person's name.
 */

import type { FieldDef } from './types';

export function clientFields(): FieldDef[] {
	return [
		{
			name: 'name',
			column: 'CLIENTE',
			label: 'Cliente',
			type: 'text',
			required: true,
			wide: true
		},
		{
			name: 'brand',
			column: 'NOMBRE MARCA',
			label: 'Marca',
			type: 'text',
			wide: true,
			hint: 'Opcional. Si no hay marca, el código usa el nombre del cliente.'
		},
		{
			name: 'owner',
			column: 'PROPIETARIO',
			label: 'Propietario',
			type: 'text'
		},
		{
			name: 'country',
			column: 'PAIS DE REGISTRO',
			label: 'País de registro',
			type: 'text'
		}
	];
}
