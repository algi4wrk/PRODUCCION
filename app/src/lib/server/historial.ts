/**
 * HISTORIAL — the saved-query view.
 *
 * Everywhere else in the app a list belongs to something: an order's trillas, a
 * lot's movimientos, a person's history. This is the one place that asks the
 * question the other way round — *every* trilla, or every empaque of one client
 * in a date range — which is what an export has to be built on.
 *
 * So a query is two choices: **what to list**, and **which of them**. The first
 * decides the columns, because a trilla and an order have nothing in common to
 * put in a shared table; the second is the same handful of filters throughout.
 * Both live in the URL, so a query can be linked, reloaded, and later exported
 * by handing the same parameters to a different renderer.
 *
 * The rows come from the very same list functions the order and lot pages use,
 * with a filter that names no order. Nothing here re-queries the domain: if a
 * column is wrong on this page it is wrong on that one too.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from './db/index.ts';
import { clients, orders } from './db/schema.ts';
import { listOrders } from './orders.ts';
import { listTrillas } from './trilla.ts';
import { listSelecciones } from './seleccion.ts';
import { listTostiones } from './tostion.ts';
import { listEmpaques } from './empaque.ts';
import { listMovimientos } from './movimientos.ts';
import { formatDate, formatKilos, orderLabel } from '../domain/derived.ts';
import { formatSelectionMethod } from '../domain/vocabulary.ts';
import type { EventFilter } from '../domain/eventFilter.ts';
import { HISTORY_VIEWS, type HistoryView } from '../domain/historial.ts';
import type { OrderStatus } from '../domain/vocabulary.ts';

export type HistoryQuery = {
	view: HistoryView;
	/** All optional, and they combine. */
	orderId?: number;
	clientId?: number;
	status?: OrderStatus;
	from?: Date;
	to?: Date;
};

export type HistoryColumn = { key: string; label: string; unit?: string; numeric?: boolean };

export type HistoryResult = {
	columns: HistoryColumn[];
	rows: Record<string, string>[];
	/** Where each row leads when clicked — the order it belongs to. */
	links: string[];
	/** Ids for the row actions the órdenes view offers. */
	ids: number[];
	/** Paused orders can be resumed from here; nothing else has an action. */
	statuses: string[];
};

/** Reads a query out of the URL, ignoring anything it does not recognise. */
export function parseQuery(params: URLSearchParams): HistoryQuery {
	const view = HISTORY_VIEWS.some((option) => option.value === params.get('vista'))
		? (params.get('vista') as HistoryView)
		: 'ordenes';

	const date = (name: string) => {
		const value = params.get(name);
		if (!value) return undefined;
		const parsed = new Date(`${value}T00:00:00`);
		return Number.isNaN(parsed.getTime()) ? undefined : parsed;
	};

	// The end of the range is inclusive of its whole day: a filter that reads
	// "hasta el 14" and drops everything recorded that afternoon is a trap.
	const to = date('hasta');
	if (to) to.setHours(23, 59, 59, 999);

	return {
		view,
		orderId: Number(params.get('orden')) || undefined,
		clientId: Number(params.get('cliente')) || undefined,
		status: (params.get('estado') as OrderStatus) || undefined,
		from: date('desde'),
		to
	};
}

/** The orders a query matches, newest first. */
async function orderRows(query: HistoryQuery) {
	const all = await listOrders();

	return all
		.filter((order) => {
			if (query.orderId && order.id !== query.orderId) return false;
			if (query.clientId && order.clientId !== query.clientId) return false;
			if (query.status && order.status !== query.status) return false;
			if (query.from && order.date < query.from) return false;
			if (query.to && order.date > query.to) return false;
			return true;
		})
		.sort((a, b) => b.date.getTime() - a.date.getTime());
}

/**
 * Orders the event views are restricted to.
 *
 * Status is a fact about an order, not about a trilla, so filtering trillas by
 * it means "trillas of orders in that state" — which needs the orders first.
 * Returned as `undefined` when the filter does not mention status, so the usual
 * case adds no condition at all.
 */
async function ordersMatching(query: HistoryQuery): Promise<number[] | undefined> {
	if (!query.status) return undefined;

	const rows = await db
		.select({ id: orders.id })
		.from(orders)
		.where(and(eq(orders.status, query.status), isNull(orders.deletedAt)));
	return rows.map((row) => row.id);
}

/** The filter every event list understands. */
function eventFilter(query: HistoryQuery): EventFilter {
	return {
		orderId: query.orderId,
		clientId: query.clientId,
		from: query.from,
		to: query.to
	};
}

const ORDER_COLUMNS: HistoryColumn[] = [
	{ key: 'code', label: 'Orden' },
	{ key: 'client', label: 'Cliente' },
	{ key: 'type', label: 'Tipo' },
	{ key: 'date', label: 'Fecha' },
	{ key: 'lots', label: 'Lotes', numeric: true },
	{ key: 'status', label: 'Estado' }
];

/** Columns every event view starts with: when, whose, and which lot. */
const EVENT_HEAD: HistoryColumn[] = [
	{ key: 'date', label: 'Fecha' },
	{ key: 'order', label: 'Orden' },
	{ key: 'client', label: 'Cliente' },
	{ key: 'lot', label: 'Lote' }
];

const STAFF_COLUMN: HistoryColumn = { key: 'staff', label: 'Responsable' };

export async function runQuery(query: HistoryQuery): Promise<HistoryResult> {
	// Client names, for the column every event view carries: an export that says
	// only "TIE-M0727A" is an export somebody has to translate by hand.
	const clientRows = await db.select().from(clients);
	const clientOf = new Map(clientRows.map((client) => [client.id, client.name]));

	const orderRowsById = new Map(
		(await db.select().from(orders)).map((order) => [order.id, order])
	);
	const clientNameOf = (orderId: number) => {
		const order = orderRowsById.get(orderId);
		return order ? (clientOf.get(order.clientId) ?? '—') : '—';
	};

	const allowed = await ordersMatching(query);
	const keep = <T extends { orderId: number }>(rows: T[]) =>
		allowed === undefined ? rows : rows.filter((row) => allowed.includes(row.orderId));

	const filter = eventFilter(query);

	if (query.view === 'ordenes') {
		const rows = await orderRows(query);
		return {
			columns: ORDER_COLUMNS,
			rows: rows.map((order) => ({
				code: order.code,
				client: orderLabel(order, order.clientName),
				type: order.type,
				date: formatDate(order.date),
				lots: String(order.lotCount),
				status: order.status
			})),
			links: rows.map((order) => `/ordenes/${order.code}`),
			ids: rows.map((order) => order.id),
			statuses: rows.map((order) => order.status)
		};
	}

	if (query.view === 'trilla') {
		const rows = keep(await listTrillas(filter));
		return {
			columns: [
				...EVENT_HEAD,
				{ key: 'parchment', label: 'Pergamino', unit: 'kg', numeric: true },
				{ key: 'green', label: 'Almendra', unit: 'kg', numeric: true },
				{ key: 'screens', label: 'Mallas' },
				{ key: 'merma', label: 'Cisco', unit: 'kg', numeric: true },
				STAFF_COLUMN
			],
			rows: rows.map((event) => ({
				date: formatDate(event.date),
				order: event.orderCode,
				client: clientNameOf(event.orderId),
				lot: event.lot,
				parchment: formatKilos(event.parchmentKilos),
				green: formatKilos(event.greenKilos),
				screens:
					event.screens.map((s) => `${s.screen}: ${formatKilos(s.kilos)} kg`).join(' · ') || '—',
				merma: formatKilos(event.mermaKilos),
				staff: event.staffName ?? '—'
			})),
			links: rows.map((event) => `/lotes/${event.lotCode}`),
			ids: rows.map((event) => event.id),
			statuses: []
		};
	}

	if (query.view === 'seleccionVerde' || query.view === 'seleccionTostado') {
		const stage = query.view === 'seleccionVerde' ? 'VERDE' : 'TOSTADO';
		const rows = keep(await listSelecciones(filter, stage));
		return {
			columns: [
				...EVENT_HEAD,
				// Manual or electrónica: what the two are priced apart by, and what
				// makes merma per method answerable once this is exported.
				{ key: 'method', label: 'Método' },
				{ key: 'total', label: 'Entra', unit: 'kg', numeric: true },
				{ key: 'net', label: 'Seleccionado', unit: 'kg', numeric: true },
				{ key: 'removed', label: stage === 'TOSTADO' ? 'Quakers' : 'Defectos', unit: 'kg', numeric: true },
				STAFF_COLUMN
			],
			rows: rows.map((event) => ({
				date: formatDate(event.date),
				order: event.orderCode,
				client: clientNameOf(event.orderId),
				lot: event.lot,
				method: formatSelectionMethod(event.method),
				total: formatKilos(event.totalKilos),
				net: formatKilos(event.netKilos),
				removed: formatKilos(event.totalKilos - event.netKilos),
				staff: event.staffName ?? '—'
			})),
			links: rows.map((event) => `/lotes/${event.lotCode}`),
			ids: rows.map((event) => event.id),
			statuses: []
		};
	}

	if (query.view === 'tostion') {
		const rows = keep(await listTostiones(filter));
		return {
			columns: [
				...EVENT_HEAD,
				{ key: 'roastType', label: 'Tueste' },
				{ key: 'batch', label: 'Bache', unit: 'kg', numeric: true },
				{ key: 'roasted', label: 'Tostado', unit: 'kg', numeric: true },
				{ key: 'merma', label: 'Merma', unit: 'kg', numeric: true },
				STAFF_COLUMN
			],
			rows: rows.map((event) => ({
				date: formatDate(event.date),
				order: event.orderCode,
				client: clientNameOf(event.orderId),
				lot: event.lot,
				roastType: event.roastType,
				batch: formatKilos(event.batchKilos),
				roasted: formatKilos(event.roastedKilos),
				merma: formatKilos(event.mermaKilos),
				staff: event.staffName ?? '—'
			})),
			links: rows.map((event) => `/lotes/${event.lotCode}`),
			ids: rows.map((event) => event.id),
			statuses: []
		};
	}

	if (query.view === 'empaque') {
		const rows = keep(await listEmpaques(filter));
		return {
			columns: [
				...EVENT_HEAD,
				{ key: 'presentation', label: 'Presentación' },
				{ key: 'quantity', label: 'Cantidad', numeric: true },
				{ key: 'kilos', label: 'Peso', unit: 'kg', numeric: true },
				{ key: 'bag', label: 'Bolsa' },
				{ key: 'inspection', label: 'Inspección' },
				STAFF_COLUMN
			],
			rows: rows.map((event) => ({
				date: formatDate(event.date),
				order: event.orderCode,
				client: clientNameOf(event.orderId),
				lot: event.lot,
				presentation: `${event.grams} g · ${event.grind}`,
				quantity: String(event.quantity),
				kilos: formatKilos(event.kilos),
				bag: event.bagName ?? '—',
				inspection: event.inspection,
				staff: event.staffName ?? '—'
			})),
			links: rows.map((event) => `/lotes/${event.lotCode}`),
			ids: rows.map((event) => event.id),
			statuses: []
		};
	}

	const rows = keep(await listMovimientos(filter));
	return {
		columns: [
			{ key: 'date', label: 'Fecha' },
			{ key: 'order', label: 'Orden' },
			{ key: 'client', label: 'Cliente' },
			{ key: 'action', label: 'Acción' },
			{ key: 'origins', label: 'Origen' },
			{ key: 'destination', label: 'Destino' },
			{ key: 'kilos', label: 'Peso', unit: 'kg', numeric: true },
			STAFF_COLUMN,
			{ key: 'source', label: 'Registro' }
		],
		rows: rows.map((movement) => ({
			date: formatDate(movement.date),
			order: movement.orderCode,
			client: clientNameOf(movement.orderId),
			action: movement.action,
			origins: movement.origins.join(', '),
			destination: movement.destination,
			kilos: formatKilos(movement.kilos),
			staff: movement.staffName ?? '—',
			source: movement.emittedBy ? `Automático · ${movement.emittedBy}` : 'Manual'
		})),
		links: rows.map((movement) => `/lotes/${movement.destinationCode}`),
		ids: rows.map((movement) => movement.id),
		statuses: []
	};
}

/** Orders and clients for the filter's own pickers. */
export async function filterOptions() {
	const [orderRows, clientRows] = await Promise.all([
		db
			.select({ id: orders.id, code: orders.code })
			.from(orders)
			.where(isNull(orders.deletedAt))
			.orderBy(desc(orders.date)),
		db.select().from(clients).where(isNull(clients.deletedAt))
	]);

	return {
		orders: orderRows.map((order) => ({ value: String(order.id), label: order.code })),
		clients: clientRows
			.map((client) => ({ value: String(client.id), label: client.name }))
			.sort((a, b) => a.label.localeCompare(b.label, 'es'))
	};
}
