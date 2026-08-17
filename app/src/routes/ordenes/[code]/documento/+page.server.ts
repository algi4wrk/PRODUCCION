import { error } from '@sveltejs/kit';
import { getOrder, orderIdFor } from '$lib/server/orders';
import { listTrillas } from '$lib/server/trilla';
import { listSelecciones } from '$lib/server/seleccion';
import { listTostiones } from '$lib/server/tostion';
import { listEmpaques, referenceProgress } from '$lib/server/empaque';
import { listMovimientos } from '$lib/server/movimientos';
import { orderLedgers, orderSourceMerma } from '$lib/server/ledger';
import { formatDate, formatKilos, formatPercent, referenceKilos } from '$lib/domain/derived';
import { estimatedOrderKilos } from '$lib/domain/estimates';
import { formatSelection, formatSelectionMethod } from '$lib/domain/vocabulary';
import { lotStatus } from '$lib/domain/lotState';
import { totalOf } from '$lib/domain/ledger';

/**
 * The order as a document, for printing or handing to the client.
 *
 * Two of them, and the difference is who is reading. **Orden de producción** is
 * for the client: what they sent, what they asked to have packed, and what came
 * back — an invoice-shaped account of their coffee. **Historial completo** adds
 * every process event and movimiento, which is the mill's own record and says
 * things a client has no use for, like how much cisco a trilla left.
 *
 * It renders as a page rather than a generated file. The browser's own print
 * dialogue writes the PDF, which costs no dependency, keeps the app's type and
 * numbers exactly as the screen shows them, and prints from any machine on the
 * floor. A PDF library would be worth it the day this has to be produced
 * without someone pressing the button — emailed on a schedule, say.
 */
export async function load({ params, url }) {
	const id = await orderIdFor(params.code);
	const order = id === null ? null : await getOrder(id);
	if (!order) error(404, 'Orden no encontrada');

	const full = url.searchParams.get('tipo') === 'historial';

	const [ledgers, sourceMerma, plan, empaques] = await Promise.all([
		orderLedgers(order.id),
		orderSourceMerma(order.id),
		referenceProgress(order.id),
		listEmpaques({ orderId: order.id })
	]);

	// The events, only when the document is the mill's own record.
	const [trillas, greenSelecciones, roastedSelecciones, tostiones, movements] = full
		? await Promise.all([
				listTrillas({ orderId: order.id }),
				listSelecciones({ orderId: order.id }, 'VERDE'),
				listSelecciones({ orderId: order.id }, 'TOSTADO'),
				listTostiones({ orderId: order.id }),
				listMovimientos({ orderId: order.id })
			])
		: [[], [], [], [], []];

	const receivedKilos = [...sourceMerma.values()].reduce((sum, b) => sum + b.receivedKilos, 0);
	const mermaKilos = [...sourceMerma.values()].reduce((sum, b) => sum + b.lostKilos, 0);
	const packedKilos = empaques.reduce((sum, event) => sum + event.kilos, 0);
	const plannedKilos = plan.reduce((sum, line) => sum + line.kilos, 0);

	return {
		full,
		order: {
			code: order.code,
			date: formatDate(order.date),
			client: order.clientName,
			brand: order.brand ?? '—',
			type: order.type,
			productLine: order.productLine || '—',
			peelStick: order.peelStick ? 'Sí' : 'No',
			status: order.status,
			notes: order.notes
		},
		/** What the client sent. */
		lots: order.lots.map((lot) => {
			const ledger = ledgers.get(lot.id);
			return {
				lot: `${lot.letter} - ${lot.variety}${lot.kind ? ` ${lot.kind}` : ''}`,
				rawMaterial: lot.rawMaterial,
				process: lot.process,
				humidity: formatPercent(lot.humidity),
				initial: formatKilos(lot.initialWeight),
				current: formatKilos(ledger ? totalOf(ledger.balances) : 0),
				status: lotStatus(lot, ledger),
				asked: [
					// The method rides on the stage it belongs to: it is part of what
					// the client ordered, and part of what they are billed for.
					formatSelection(lot.selectionStages, lot.selectionMethods),
					lot.roastType !== 'Ninguno' ? lot.roastType : null
				]
					.filter(Boolean)
					.join(' · ')
			};
		}),
		/** What they asked to have packed, and how much of it came back. */
		plan: plan.map((line) => ({
			presentation: `${line.grams} g · ${line.grind}`,
			variety: line.variety,
			planned: String(line.quantity),
			packed: String(line.packedQuantity),
			pending: String(line.pendingQuantity),
			kilos: formatKilos(line.kilos)
		})),
		/** What was actually packed, line by line. */
		packed: empaques.map((event) => ({
			date: formatDate(event.date),
			lot: event.lot,
			presentation: `${event.grams} g · ${event.grind}`,
			quantity: String(event.quantity),
			kilos: formatKilos(event.kilos),
			bag: event.bagName ?? '—',
			inspection: event.inspection
		})),
		totals: {
			received: formatKilos(receivedKilos),
			estimated: formatKilos(estimatedOrderKilos(order.lots)),
			merma: `${formatKilos(mermaKilos)} kg · ${formatPercent(receivedKilos === 0 ? 0 : mermaKilos / receivedKilos)}`,
			planned: formatKilos(plannedKilos),
			packed: formatKilos(packedKilos)
		},
		events: {
			trillas: trillas.map((event) => ({
				date: formatDate(event.date),
				lot: event.lot,
				parchment: formatKilos(event.parchmentKilos),
				green: formatKilos(event.greenKilos),
				screens:
					event.screens.map((s) => `${s.screen}: ${formatKilos(s.kilos)} kg`).join(' · ') || '—',
				merma: formatKilos(event.mermaKilos),
				staff: event.staffName ?? '—'
			})),
			selecciones: [...greenSelecciones, ...roastedSelecciones]
				.sort((a, b) => a.date.getTime() - b.date.getTime())
				.map((event) => ({
					date: formatDate(event.date),
					lot: event.lot,
					stage: event.stage,
					method: formatSelectionMethod(event.method),
					total: formatKilos(event.totalKilos),
					net: formatKilos(event.netKilos),
					removed: formatKilos(event.totalKilos - event.netKilos),
					staff: event.staffName ?? '—'
				})),
			tostiones: tostiones.map((event) => ({
				date: formatDate(event.date),
				lot: event.lot,
				roastType: event.roastType,
				batch: formatKilos(event.batchKilos),
				roasted: formatKilos(event.roastedKilos),
				merma: formatKilos(event.mermaKilos),
				staff: event.staffName ?? '—'
			})),
			movements: movements.map((movement) => ({
				date: formatDate(movement.date),
				action: movement.action,
				origins: movement.origins.join(', '),
				destination: movement.destination,
				kilos: formatKilos(movement.kilos),
				staff: movement.staffName ?? '—',
				source: movement.emittedBy ? `Automático · ${movement.emittedBy}` : 'Manual'
			}))
		},
		printedOn: formatDate(new Date())
	};
}
