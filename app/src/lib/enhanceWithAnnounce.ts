/**
 * A `use:enhance` submit function that announces the change to other windows
 * once the write has succeeded.
 *
 * Wrapping it here rather than repeating the callback at every form keeps the
 * ordering right in one place: update the page first, announce second, and only
 * on success — announcing after a failed action would make the board refetch
 * for nothing.
 */

import type { SubmitFunction } from '@sveltejs/kit';
import { announceChange } from './realtime';

export const announceOnSuccess: SubmitFunction = () => {
	return async ({ result, update }) => {
		await update();
		// Redirects count: they are how a successful creation ends.
		if (result.type === 'success' || result.type === 'redirect') announceChange();
	};
};
