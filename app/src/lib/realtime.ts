/**
 * Cross-window change notifications.
 *
 * The floor monitor is an HDMI output of the same computer someone enters data
 * on, so the board and the forms are two windows of one browser. Browsers can
 * already talk between windows of the same origin — `BroadcastChannel` — which
 * makes this a few lines instead of a server route holding open connections.
 *
 * The message carries nothing but "something changed". Listeners refetch from
 * the server, so there is no risk of two windows disagreeing about state: the
 * database stays the only source of truth and this is purely a nudge.
 *
 * Limits worth knowing before this stops being enough:
 *   - Same browser only. A second *device* would not hear it, and that is when
 *     Server-Sent Events become worth the extra machinery.
 *   - Not delivery-guaranteed. The board keeps its polling timer as a fallback,
 *     so a missed message costs one interval, not a stale screen.
 */

const CHANNEL = 'produccion:cambios';

/** Not available during SSR, and absent in a few older browsers. */
function open(): BroadcastChannel | null {
	if (typeof BroadcastChannel === 'undefined') return null;
	return new BroadcastChannel(CHANNEL);
}

/**
 * Tells every other window that data changed. Call after a write has succeeded,
 * never before — listeners refetch immediately and would otherwise read the old
 * value.
 */
export function announceChange(): void {
	const channel = open();
	if (!channel) return;
	channel.postMessage('cambio');
	channel.close();
}

/**
 * Runs `handler` whenever another window announces a change. Returns a cleanup
 * function for `$effect`.
 */
export function onChange(handler: () => void): () => void {
	const channel = open();
	if (!channel) return () => {};

	channel.onmessage = () => handler();
	return () => channel.close();
}
