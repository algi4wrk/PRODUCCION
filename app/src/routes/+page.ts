import { redirect } from '@sveltejs/kit';

/** The app opens on the order list. */
export function load() {
	redirect(307, '/ordenes');
}
