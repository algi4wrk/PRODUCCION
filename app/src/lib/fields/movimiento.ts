/**
 * Field definitions for a movimiento.
 *
 * The header fields only. The origin legs are a repeating list of lot + weight
 * pairs, which no single FieldDef can express — that part is
 * `MovimientoForm.svelte`, and it is the whole reason this form could not exist
 * in the source app.
 */

import { MOVEMENT_ACTIONS, ACTIONS_CREATING_LOT } from '$lib/domain/vocabulary';
import type { FieldDef, FieldOption, FormRow } from './types';

/** A lot the operator can pick, with what it is currently holding. */
export type LotOption = FieldOption & {
	availableKilos: number;
	status: string;
	/**
	 * What the lot is holding, bucket by bucket. One entry is the ordinary case;
	 * two mean the operator has to say which one is moving.
	 */
	portions?: {
		state: 'VERDE' | 'TOSTADO' | 'EMPACADO';
		selected: boolean;
		label: string;
		kilos: number;
	}[];
};

export type MovementContext = {
	lots: readonly LotOption[];
	staff: readonly FieldOption[];
};

/** True when the action creates its own destination lot rather than picking one. */
export function createsLot(action: unknown): boolean {
	return ACTIONS_CREATING_LOT.includes(action as never);
}

export function movementFields({ lots, staff }: MovementContext): FieldDef[] {
	return [
		{
			name: 'action',
			column: 'ACCION/PROCESO',
			label: 'Acción',
			type: 'enum',
			required: true,
			// The three options are one row of buttons; half a form makes them wrap.
			wide: true,
			options: MOVEMENT_ACTIONS.map((action) => ({
				value: action,
				label: action,
				hint:
					action === 'COMBINAR LOTE'
						? 'varios lotes origen, crea uno nuevo'
						: action === 'SEPARAR LOTE'
							? 'un lote origen, crea uno nuevo'
							: 'pasa peso a un lote que ya existe'
			}))
		},
		{
			// Only TRANSFERIR picks a destination. The other two create theirs, so
			// asking for one would be asking the operator to name a lot that does
			// not exist yet — which is what the workbook's LOTE CREADO formula was
			// working around.
			name: 'destinationLotId',
			column: 'LOTE DESTINO',
			label: 'Lote destino',
			type: 'ref',
			required: (row: FormRow) => !createsLot(row.action),
			visible: (row: FormRow) => !createsLot(row.action),
			options: lots,
			hint: 'El café llega a este lote.'
		},
		{
			name: 'staffId',
			column: 'responsable_id',
			label: 'Responsable',
			type: 'ref',
			required: true,
			options: staff,
			createLabel: '+ Nuevo responsable'
		}
	];
}
