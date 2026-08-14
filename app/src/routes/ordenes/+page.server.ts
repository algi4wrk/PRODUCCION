import { fail, redirect } from '@sveltejs/kit';
import {
	createOrder,
	listOrders,
	type NewLotInput,
	type NewReferenceInput
} from '$lib/server/orders';
import {
	bagOptions,
	clientOptions,
	createClient,
	createFarm,
	farmOptions,
	listClients,
	varietyOptions
} from '$lib/server/lookups';
import { db } from '$lib/server/db';
import { orders } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { plannedKilos, receivedKilos, sortForQueue, orderLabel } from '$lib/domain/derived';
import { validatePlannedWeight } from '$lib/domain/validation';
import type { Actions } from './$types';

/**
 * The order queue. Sorting is priority first, then oldest first — the position
 * shown in the list is simply the index, replacing the stored QUEUE column that
 * the workbook recomputed for every row on every render.
 *
 * Paused and finished orders are hidden here: this list is the work queue, and
 * neither is being worked on. Both live in HISTORIAL, whose filter chips already
 * carry their counts, so this page does not repeat them.
 *
 * It also carries what the creation modal needs — option lists, and the prefixes
 * the ID_ORDEN preview is built from. The form lives over this page rather than
 * on one of its own, so its data is loaded with the queue.
 */
export async function load() {
	const [all, clients, farms, bags, varieties, clientRows] = await Promise.all([
		listOrders(),
		clientOptions(),
		farmOptions(),
		bagOptions(),
		varietyOptions(),
		listClients()
	]);
	const active = all.filter(
		(order) => order.status !== 'PAUSADA' && order.status !== 'TERMINADA'
	);

	return {
		clients,
		farms,
		bags,
		varieties,
		/** Existing codes, so the preview can show the sequence letter it will get. */
		existingCodes: all.map((order) => order.code),
		// Keyed by client id so the ID_ORDEN preview can be built client-side
		// without a round trip on every keystroke.
		prefixes: Object.fromEntries(clientRows.map((client) => [String(client.id), client.prefix])),
		brands: Object.fromEntries(clientRows.map((client) => [String(client.id), client.brand ?? ''])),
		orders: sortForQueue(active).map((order, index) => ({
			id: order.id,
			position: index + 1,
			code: order.code,
			label: orderLabel(order, order.clientName),
			date: order.date,
			type: order.type,
			status: order.status,
			priority: order.priority,
			lotCount: order.lotCount
		}))
	};
}

export const actions: Actions = {
	/**
	 * Creates the order together with its lots and references, in one
	 * transaction. Nested rows arrive as JSON because they are arbitrary in
	 * number — the "dynamic data size" the source app could not express.
	 */
	create: async ({ request }) => {
		const form = await request.formData();

		const lots = JSON.parse(String(form.get('lots') ?? '[]')) as NewLotInput[];
		const references = JSON.parse(String(form.get('references') ?? '[]')) as NewReferenceInput[];

		// The packaging plan cannot promise more coffee than the order received.
		const weightError = validatePlannedWeight(plannedKilos(references), receivedKilos(lots));
		if (weightError) {
			return fail(400, { error: weightError });
		}

		const created = await createOrder({
			type: String(form.get('type')) as never,
			clientId: Number(form.get('clientId')),
			productLine: (form.get('productLine') as never) || null,
			peelStick: form.get('peelStick') === 'true',
			notes: String(form.get('notes') ?? '') || null,
			lots,
			references
		});

		// To the new order by its code, which is what its URL is.
		const [order] = await db.select({ code: orders.code }).from(orders).where(eq(orders.id, created));
		redirect(303, `/ordenes/${order.code}`);
	},

	/** Inline "+ Nuevo" on the client field, so a new client needs no detour. */
	createClient: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'El nombre del cliente es obligatorio.' });

		const id = await createClient({
			name,
			brand: String(form.get('brand') ?? '').trim() || null,
			owner: String(form.get('owner') ?? '').trim() || null,
			country: String(form.get('country') ?? '').trim() || null
		});

		return { createdClientId: id };
	},

	/** Inline "+ Nueva finca" from the lot sub-form. */
	createFarm: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'El nombre de la finca es obligatorio.' });

		const id = await createFarm({
			name,
			farmer: String(form.get('farmer') ?? '').trim() || null,
			municipality: String(form.get('municipality') ?? '').trim() || null,
			department: String(form.get('department') ?? '').trim() || null
		});

		return { createdFarmId: id };
	}
};
