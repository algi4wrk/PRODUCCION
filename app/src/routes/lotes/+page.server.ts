import { loadBoard } from '$lib/server/board';
import { lotRow } from '$lib/domain/lotRow';

/**
 * LOTES ACTIVOS — the floor board.
 *
 * Rows are projected here rather than in the component, so the display stays a
 * table of strings and the rules live in one place — `domain/lotRow.ts`, which
 * the order page's Materia prima table reads from too.
 */
export async function load() {
	const board = await loadBoard();

	return {
		orders: board.map((order) => ({
			id: order.id,
			code: order.code,
			label: order.label,
			priority: order.priority,
			lots: order.lots.map((lot) => ({
				id: lot.id,
				orderId: order.id,
				...lotRow(lot, {
					ledger: lot.ledger,
					merma: lot.merma,
					hasReferences: order.hasReferences,
					originLots: lot.originLots,
					createdLots: lot.createdLots
				})
			}))
		})),
		// Shown in the header so the room can tell the board is live.
		refreshedAt: new Date()
	};
}
