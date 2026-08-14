import { error } from '@sveltejs/kit';
import { getStaff } from '$lib/server/staff';
import { listTrillas } from '$lib/server/trilla';
import { listSelecciones } from '$lib/server/seleccion';
import { listTostiones } from '$lib/server/tostion';
import { listEmpaques } from '$lib/server/empaque';
import { listMovimientos } from '$lib/server/movimientos';
import { formatDate } from '$lib/domain/derived';
import type { Fact } from '$lib/components/FactGrid.svelte';

/**
 * One person, and everything they have recorded.
 *
 * The same five lists the order and lot pages use, filtered by responsable
 * instead of by order — which is the whole reason `responsable_id` is a
 * reference and not a typed name. No new query and no new component: the
 * sections already know how to show a trilla.
 */
export async function load({ params }) {
	const person = await getStaff(Number(params.id));
	if (!person) error(404, 'Persona no encontrada');

	const by = { staffId: person.id };

	const [trillas, greenSelecciones, roastedSelecciones, tostiones, empaques, movements] =
		await Promise.all([
			listTrillas(by),
			listSelecciones(by, 'VERDE'),
			listSelecciones(by, 'TOSTADO'),
			listTostiones(by),
			listEmpaques(by),
			listMovimientos(by)
		]);

	// The most recent thing they did, across all five kinds.
	const lastDate = [...trillas, ...greenSelecciones, ...roastedSelecciones, ...tostiones, ...empaques, ...movements]
		.map((event) => event.date)
		.sort((a, b) => b.getTime() - a.getTime())[0];

	const details: Fact[] = [
		{ label: 'Nombre', value: person.name },
		{ label: 'Posición', value: person.position || '—' },
		{ label: 'Último registro', value: lastDate ? formatDate(lastDate) : '—' }
	];

	return {
		person: { id: person.id, name: person.name },
		details,
		trillas,
		greenSelecciones,
		roastedSelecciones,
		tostiones,
		empaques,
		movements
	};
}
