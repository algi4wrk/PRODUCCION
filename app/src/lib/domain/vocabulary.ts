/**
 * The controlled vocabularies of the domain, ported from the AppSheet column
 * definitions. These are the exact strings stored in the database.
 *
 * Two values are cleaned during migration because the originals carry trailing
 * whitespace that breaks string comparison: "Exportacion " and
 * "Media/Media - City ".
 */

/** ORDENES.TIPO DE ORDEN. The first letter feeds the ID_ORDEN generator. */
export const ORDER_TYPES = ['Maquila', 'Exportacion', 'Nacional/Interno'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

/** ORDENES.LINEA DE PRODUCTO. Only applies to internal orders. */
export const PRODUCT_LINES = ['Tradición', 'Premium', 'Especial', 'Blend'] as const;
export type ProductLine = (typeof PRODUCT_LINES)[number];

/**
 * ORDENES.ESTADO ACTUAL. Fully manual, driven by buttons — nothing computes it.
 * PRIORIDAD used to live in this list; it is now a separate boolean, because an
 * order can be in process *and* urgent.
 */
export const ORDER_STATUSES = ['EN PROCESO', 'PAUSADA', 'TERMINADA'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * LOTES.MATERIA PRIMA INICIAL — the physical form the coffee arrived in.
 * CPS = café pergamino seco, AV = almendra verde.
 */
export const RAW_MATERIALS = ['CPS', 'AV', 'TOSTADO'] as const;
export type RawMaterial = (typeof RAW_MATERIALS)[number];

/**
 * LOTES.PROCESO SELECCION — a specification, not a state. Says at which stages
 * the client wants sorting done. NINGUNO must be the only value when present.
 */
export const SELECTION_STAGES = ['VERDE', 'TOSTADO', 'NINGUNO'] as const;
export type SelectionStage = (typeof SELECTION_STAGES)[number];

/**
 * Display labels for the selection stages. The stored values stay uppercase to
 * match the existing data; only what the operator reads changes, since shouting
 * three words in a form adds nothing.
 */
export const SELECTION_STAGE_LABELS: Record<SelectionStage, string> = {
	VERDE: 'Verde',
	TOSTADO: 'Tostado',
	NINGUNO: 'Ninguno'
};

/** Renders stored stages for display: ["VERDE","TOSTADO"] -> "Verde, Tostado". */
export function formatSelectionStages(stages: readonly string[]): string {
	return stages
		.map((stage) => SELECTION_STAGE_LABELS[stage as SelectionStage] ?? stage)
		.join(', ');
}

/** LOTES.TIPO DE TOSTION — the requested roast profile. */
export const ROAST_TYPES = [
	'Ninguno',
	'Media Baja - American',
	'Media/Media - City',
	'Media Alta - Full City',
	'Alta Moderada - Vienna'
] as const;
export type RoastType = (typeof ROAST_TYPES)[number];

/** LOTES.BENEFICIO — how the coffee was processed at the farm. */
export const PROCESS_TYPES = ['Lavado', 'Natural', 'Honey'] as const;
export type ProcessType = (typeof PROCESS_TYPES)[number];

/**
 * LOTES.MALLAS A SEPARAR — screen sizes to separate during trilla. Only
 * meaningful for CPS. "Ninguna" must be the only value when present.
 */
export const SCREENS = ['14', '15/16', '17/18', 'Ninguna'] as const;
export type Screen = (typeof SCREENS)[number];

/**
 * EMPAQUE.INSPECCION EMPAQUE — the packing check.
 *
 * The sheet modelled this as a Yes/No whose only display value was "Rechazado",
 * which leaves the other half of the answer unnamed. Both outcomes are named
 * here: the operator is recording a decision, not ticking a defect.
 */
export const PACKING_INSPECTIONS = ['Aceptado', 'Rechazado'] as const;
export type PackingInspection = (typeof PACKING_INSPECTIONS)[number];

/** REFERENCIAS.Tipo de Molienda. */
export const GRIND_TYPES = ['GRANO', 'MOLIDO'] as const;
export type GrindType = (typeof GRIND_TYPES)[number];

/**
 * REFERENCIAS (g) — bag presentations in grams. The source enum omitted 125 and
 * 1, both of which already appear in the data; 1 is the granel (bulk) case
 * where quantity is expressed directly in grams.
 */
export const REFERENCE_GRAMS = [1, 125, 250, 340, 454, 500, 1000, 2500] as const;

/** Coffee varieties seen in the data. Free entry is allowed via "OTRO". */
export const VARIETIES = [
	'Castillo',
	'Caturra',
	'Caturra Amarillo',
	'Bourbon Rosado',
	'Tabi',
	'Cenicafe 1',
	'OTRO'
] as const;

/**
 * What the roaster holds in one batch, in kilos.
 *
 * The workbook wrote this as `MIN(LIST(DECIMAL(25), [PESO DEL BACHE (kg)]))` on
 * that field's Initial value — a machine limit hidden in a default. A lot larger
 * than this is roasted over several batches, which is exactly why a lot can hold
 * green and roasted coffee at the same time.
 */
export const ROASTER_BATCH_KILOS = 25;

/** The bag code that means "the client supplies their own packaging". */
export const CLIENT_BAG_CODE = 'Cliente';

/**
 * REGISTRO.ESTADO — the form the coffee is in, and nothing else.
 *
 * The old ESTADO ACTUAL string conflated this with a quality flag and with
 * in-progress-ness. Here the form is one column, SELECCIONADO is another, and
 * "in progress" is not stored at all: it is what holding weight in two of these
 * at once *means*.
 *
 * EMPACADO is a form rather than an exit. Packing does not consume coffee, it
 * puts it in bags, so the weight stays on the lot.
 */
export const LEDGER_STATES = ['VERDE', 'TOSTADO', 'EMPACADO'] as const;
export type LedgerState = (typeof LEDGER_STATES)[number];

/**
 * What caused a ledger entry. A movimiento is one kind of event, alongside the
 * four process steps; `recepcion` is the lot's own arrival.
 */
export const EVENT_TYPES = [
	'recepcion',
	'trilla',
	'seleccion',
	'tostion',
	'empaque',
	'movimiento'
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * MOVIMIENTOS.ACCION/PROCESO — the three ways coffee changes lot.
 *
 * SEPARAR and COMBINAR create their destination lot; TRANSFERIR pours into a
 * lot that already exists. Combining always creates rather than absorbing,
 * because PESO INICIAL is a reception fact: a lot that absorbed another would
 * carry an initial weight describing coffee that never arrived as part of it.
 */
export const MOVEMENT_ACTIONS = ['TRANSFERIR PESO', 'SEPARAR LOTE', 'COMBINAR LOTE'] as const;
export type MovementAction = (typeof MOVEMENT_ACTIONS)[number];

/** Actions whose destination lot is created by the movimiento itself. */
export const ACTIONS_CREATING_LOT: readonly MovementAction[] = ['SEPARAR LOTE', 'COMBINAR LOTE'];
