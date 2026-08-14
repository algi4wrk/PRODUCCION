/**
 * What HISTORIAL can list.
 *
 * Here rather than beside the queries because both sides need it: the server
 * decides which rows and columns a view produces, and the filter panel offers
 * the same list to choose from. A view is a vocabulary, like every other list
 * in `domain/`.
 */
export const HISTORY_VIEWS = [
	{ value: 'ordenes', label: 'Órdenes' },
	{ value: 'trilla', label: 'Trillas' },
	{ value: 'seleccionVerde', label: 'Selecciones — verde' },
	{ value: 'seleccionTostado', label: 'Selecciones — tostado' },
	{ value: 'tostion', label: 'Tostiones' },
	{ value: 'empaque', label: 'Empaques' },
	{ value: 'movimientos', label: 'Movimientos' }
] as const;

export type HistoryView = (typeof HISTORY_VIEWS)[number]['value'];
