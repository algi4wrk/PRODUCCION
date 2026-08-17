/**
 * Field definitions for a lot.
 *
 * A lot mixes two kinds of information, and the form groups them accordingly:
 *
 *   Reception  — what physically arrived and was weighed. Observed fact.
 *   Especificación — what the client asked to have done to it. Intent.
 *
 * Keeping those apart is what lets status be derived later: the specification
 * says which process sections exist, the events say what has happened.
 */

import {
	RAW_MATERIALS,
	PROCESS_TYPES,
	ROAST_TYPES,
	SELECTION_STAGES,
	SELECTION_STAGE_LABELS,
	SELECTION_METHODS,
	SELECTION_METHOD_LABELS,
	SCREENS,
	type SelectionMethod,
	type SelectionMethods
} from '$lib/domain/vocabulary';
import {
	validateScreens,
	validateSelectionStages,
	requiresQuakerDecision
} from '$lib/domain/validation';
import { toOptions, type FieldDef, type FieldOption, type FormRow } from './types';
import {
	estimatedGreenKilos,
	estimatedRoastedKilos,
	lossPercent,
	ROAST_YIELD,
	TRILLA_YIELD,
	type EstimableLot
} from '$lib/domain/estimates';
import { formatKilos } from '$lib/domain/derived';

/** Reads the estimate inputs out of a half-filled form row. */
function asEstimable(row: FormRow): EstimableLot {
	return {
		rawMaterial: row.rawMaterial as never,
		initialWeight: Number(row.initialWeight) || 0,
		process: row.process as never
	};
}

/** Pergamino is the only material that goes through trilla, so only it has screens. */
function isPergamino(row: FormRow): boolean {
	return row.rawMaterial === 'CPS';
}

/** Quakers are only visible once roasted, so the question only applies then. */
function sortsAfterRoasting(row: FormRow): boolean {
	return requiresQuakerDecision((row.selectionStages as never) ?? []);
}

/** Whether the client asked for sorting before the roast. */
function sortsGreen(row: FormRow): boolean {
	return (((row.selectionStages as string[]) ?? []) as string[]).includes('VERDE');
}

export function lotFields(
	farms: readonly FieldOption[],
	varieties: readonly FieldOption[]
): FieldDef[] {
	return [
		{
			group: 'Detalles',
			name: 'rawMaterial',
			column: 'MATERIA PRIMA INICIAL',
			label: 'Materia prima inicial',
			type: 'enum',
			required: true,
			options: toOptions(RAW_MATERIALS),
			hint: 'CPS: pergamino seco · AV: almendra verde'
		},
		{
			group: 'Detalles',
			name: 'initialWeight',
			column: 'PESO INICIAL (kg)',
			label: 'Peso inicial',
			type: 'decimal',
			required: true,
			unit: 'kg',
			validate: (value) =>
				Number(value) > 0 ? null : 'El peso debe ser mayor que cero.'
		},
		{
			// Variedad is a plain string, not a table, so it is typed or picked
			// rather than administered. Suggestions come from varieties already
			// recorded, so a new one entered here appears in every later lot.
			group: 'Detalles',
			name: 'variety',
			column: 'VARIEDAD',
			label: 'Variedad',
			type: 'combo',
			required: true,
			options: varieties,
			newValueLabel: 'Se agregará como variedad nueva.'
		},
		{
			group: 'Detalles',
			name: 'farmId',
			column: 'finca_id',
			label: 'Finca',
			type: 'ref',
			required: true,
			options: farms,
			createLabel: '+ Nueva finca'
		},
		{
			group: 'Detalles',
			name: 'humidity',
			column: 'HUMEDAD',
			label: 'Humedad',
			type: 'percent',
			required: true,
			validate: (value) => {
				const percent = Number(value);
				if (percent <= 0 || percent >= 100) return 'Ingrese un porcentaje entre 0 y 100.';
				return null;
			}
		},
		{
			group: 'Detalles',
			name: 'process',
			column: 'BENEFICIO',
			label: 'Beneficio',
			type: 'enum',
			required: true,
			options: toOptions(PROCESS_TYPES)
		},
		{
			// Ports ESTIMADO TRILLA (20%), whose Show? was [MATERIA PRIMA
			// INICIAL]="CPS" — only pergamino goes through trilla.
			group: 'Detalles',
			name: 'estimatedGreen',
			column: 'ESTIMADO TRILLA (20%)',
			label: 'Estimado tras trilla',
			type: 'computed',
			visible: isPergamino,
			compute: (row) => `${formatKilos(estimatedGreenKilos(asEstimable(row)))} kg`,
			// The factor depends on the beneficio — 20 %, 22,5 % or 30 % — so the
			// result alone does not say which one was applied.
			computeNote: (row) => {
				const factor = TRILLA_YIELD[row.process as never];
				return factor ? `merma ${lossPercent(factor)}` : '';
			}
		},
		{
			// Ports ESTIMADO TOSTADO (20%), always shown. This is the figure the
			// packaging plan is measured against.
			group: 'Detalles',
			name: 'estimatedRoasted',
			column: 'ESTIMADO TOSTADO (20%)',
			label: 'Estimado tostado',
			type: 'computed',
			compute: (row) => `${formatKilos(estimatedRoastedKilos(asEstimable(row)))} kg`,
			// Roasted lots are already past the roast, so no loss applies to them.
			computeNote: (row) =>
				row.rawMaterial === 'TOSTADO' ? 'ya tostado' : `merma ${lossPercent(ROAST_YIELD)}`
		},
		{
			group: 'Procesos',
			name: 'selectionStages',
			column: 'PROCESO SELECCION',
			label: 'Proceso de selección',
			type: 'enumlist',
			required: true,
			options: SELECTION_STAGES.map((stage) => ({
				value: stage,
				label: SELECTION_STAGE_LABELS[stage]
			})),
			exclusive: ['NINGUNO'],
			validate: (value) => validateSelectionStages(value as never),
			hint: 'En qué etapas se debe seleccionar el café.',
			// The methods hang under it, so the pair reads as one question about
			// selección rather than three fields sharing a row.
			wide: true
		},
		/*
		 * One method per requested stage — the client can ask for the machine on
		 * the green side and hand-picking after the roast, and the two are priced
		 * differently.
		 *
		 * Two flat fields rather than one map field: the form machinery works in
		 * scalars, and a stage that was never asked for has no method to give. They
		 * are folded into METODO SELECCION at the boundary — see
		 * `selectionMethodsOf`.
		 *
		 * `attach` puts them under the stages they qualify instead of beside them:
		 * each only exists because that stage was chosen, and each is named after
		 * it, so a row of three questions would be one question read three times.
		 */
		{
			group: 'Procesos',
			name: 'methodVerde',
			column: 'METODO SELECCION',
			label: 'Método — Verde',
			type: 'enum',
			options: SELECTION_METHODS.map((method) => ({
				value: method,
				label: SELECTION_METHOD_LABELS[method]
			})),
			required: sortsGreen,
			visible: sortsGreen,
			attach: true
		},
		{
			group: 'Procesos',
			name: 'methodTostado',
			column: 'METODO SELECCION',
			label: 'Método — Tostado',
			type: 'enum',
			options: SELECTION_METHODS.map((method) => ({
				value: method,
				label: SELECTION_METHOD_LABELS[method]
			})),
			required: sortsAfterRoasting,
			visible: sortsAfterRoasting,
			attach: true
		},
		{
			group: 'Procesos',
			name: 'roastType',
			column: 'TIPO DE TOSTION',
			label: 'Tipo de tostión',
			type: 'enum',
			required: true,
			options: toOptions(ROAST_TYPES)
		},
		{
			group: 'Procesos',
			name: 'screens',
			column: 'MALLAS A SEPARAR',
			label: 'Mallas a separar',
			type: 'enumlist',
			options: toOptions(SCREENS),
			exclusive: ['Ninguna'],
			required: isPergamino,
			visible: isPergamino,
			validate: (value, row) => validateScreens(value as never, String(row.rawMaterial ?? ''))
		},
		{
			// Only meaningful when the coffee is sorted after roasting — quakers are
			// a roasted defect, so there are none to keep before that.
			group: 'Procesos',
			name: 'addQuaker',
			column: 'AGREGAR QUAKER',
			label: 'Usar quakers',
			type: 'yesno',
			required: sortsAfterRoasting,
			visible: sortsAfterRoasting,
			hint: 'Sí: se separan en su propio lote para reutilizarlos. No: son merma.'
		},
		{
			/*
			 * Hidden for now, everywhere, at the client's request.
			 *
			 * Not deleted: the column exists, the rules that read it are live — a lot
			 * bound for bodega is offered to no process step — and lots already
			 * carrying it keep what they carry. Hidden fields are never validated
			 * either, so nothing it would have asked for can block a save. Delete
			 * this `visible` line to bring it back.
			 */
			group: 'Procesos',
			name: 'storeInWarehouse',
			column: 'GUARDAR EN BODEGA',
			label: 'Guardar en bodega',
			type: 'yesno',
			visible: () => false
		}
	];
}

/**
 * A blank lot row. Lives here rather than in a page so the creation form and
 * the order page's "+ Nuevo lote" start from the same defaults.
 */
export function blankLot(): FormRow {
	return {
		rawMaterial: 'CPS',
		initialWeight: null,
		variety: '',
		farmId: '',
		process: 'Lavado',
		humidity: null,
		selectionStages: [],
		methodVerde: '',
		methodTostado: '',
		roastType: 'Ninguno',
		screens: [],
		addQuaker: false,
		storeInWarehouse: false
	};
}

/**
 * Folds the two method fields into the map the column stores.
 *
 * Only stages the client actually asked for contribute: a method for a stage
 * that is not being sorted describes work nobody ordered. Returns null when
 * neither stage has one, so the column stays empty rather than holding `{}`.
 */
export function selectionMethodsOf(row: FormRow): SelectionMethods | null {
	const stages = ((row.selectionStages as string[]) ?? []) as string[];
	const methods: SelectionMethods = {};
	if (stages.includes('VERDE') && row.methodVerde) {
		methods.VERDE = row.methodVerde as SelectionMethod;
	}
	if (stages.includes('TOSTADO') && row.methodTostado) {
		methods.TOSTADO = row.methodTostado as SelectionMethod;
	}
	return Object.keys(methods).length > 0 ? methods : null;
}

/** The inverse: the stored map, as the two fields the form edits. */
export function selectionMethodFields(methods: SelectionMethods | null | undefined): FormRow {
	return {
		methodVerde: methods?.VERDE ?? '',
		methodTostado: methods?.TOSTADO ?? ''
	};
}

/** The columns shown when a lot is listed inside the order form. */
export const LOT_SUMMARY_COLUMNS = [
	{ key: 'letter', label: 'Lote' },
	{ key: 'rawMaterial', label: 'Materia prima' },
	{ key: 'initialWeight', label: 'Peso', unit: 'kg' },
	{ key: 'variety', label: 'Variedad' },
	{ key: 'roastType', label: 'Tostión' },
	{ key: 'selectionStages', label: 'Selección' }
] as const;
