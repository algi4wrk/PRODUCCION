import { fail } from '@sveltejs/kit';
import { setOrderStatus } from '$lib/server/orders';
import { filterOptions, parseQuery, runQuery } from '$lib/server/historial';
import type { Actions } from './$types';

/**
 * HISTORIAL — every record, whatever its status, asked for by query.
 *
 * The working queue at /ordenes hides paused orders, so this is where they live
 * and where they are resumed. It is also the only view that lists *across*
 * orders: every trilla, every empaque of one client in a date range. Those are
 * the queries an export will be built from, which is why the whole query lives
 * in the URL rather than in component state — the same parameters will hand a
 * spreadsheet the same rows.
 */
export async function load({ url }) {
	const query = parseQuery(url.searchParams);
	const [result, options] = await Promise.all([runQuery(query), filterOptions()]);

	return {
		// Echoed back so the filter panel opens on what the URL asked for.
		filter: {
			vista: query.view,
			cliente: url.searchParams.get('cliente') ?? '',
			orden: url.searchParams.get('orden') ?? '',
			estado: url.searchParams.get('estado') ?? '',
			desde: url.searchParams.get('desde') ?? '',
			hasta: url.searchParams.get('hasta') ?? ''
		},
		options,
		result
	};
}

export const actions: Actions = {
	/** Returns a paused order to the working queue. */
	resume: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id) return fail(400, { error: 'Orden inválida.' });

		await setOrderStatus(id, 'EN PROCESO');
		return { ok: true };
	}
};
