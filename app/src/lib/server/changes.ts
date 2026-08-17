/**
 * Change notifications, from the server to every connected screen.
 *
 * The `BroadcastChannel` in `$lib/realtime.ts` only reaches other windows of
 * the same browser, which covers the wall monitor and nothing else. This is the
 * next tier up: the server holds an open connection per screen and says
 * "cambio" down all of them whenever anything is written, so a tostión recorded
 * on the phone reaches the two computers at the mill within a moment.
 *
 * The message carries nothing but the word. Every listener refetches through
 * the ordinary `load`, so the database stays the only source of truth and there
 * is no state here that could drift from it.
 *
 * One process only, which is what the mill runs — `node build` on one machine.
 * Several processes would each hold their own set of listeners and only notify
 * their own; that is the day this becomes Postgres `LISTEN`/`NOTIFY` or
 * Supabase Realtime.
 */

/** Everyone currently listening. A screen that goes away removes itself. */
const listeners = new Set<(chunk: string) => void>();

/** How often to send a comment line, so idle connections are not reaped. */
const HEARTBEAT_MS = 30_000;

/**
 * Tells every connected screen that something changed. Called after a write has
 * succeeded — never before, since listeners refetch immediately.
 */
export function announce(): void {
	for (const send of listeners) {
		try {
			send('data: cambio\n\n');
		} catch {
			// A dead connection: its own cancel handler removes it.
		}
	}
}

/** The event stream one screen subscribes to. */
export function changeStream(): ReadableStream<Uint8Array> {
	const encode = new TextEncoder();
	let heartbeat: ReturnType<typeof setInterval>;

	return new ReadableStream({
		start(controller) {
			const send = (chunk: string) => controller.enqueue(encode.encode(chunk));

			// A first byte so the browser treats the connection as established
			// rather than pending.
			send(': conectado\n\n');
			listeners.add(send);

			// Comment lines: they keep proxies and phones from closing an idle
			// socket, and cost two bytes.
			heartbeat = setInterval(() => {
				try {
					send(': ping\n\n');
				} catch {
					clearInterval(heartbeat);
					listeners.delete(send);
				}
			}, HEARTBEAT_MS);

			// Closing over `send` is what lets cancel find this listener again.
			(controller as { _send?: typeof send })._send = send;
		},
		cancel(reason) {
			void reason;
			clearInterval(heartbeat);
			// Rebuilt on the next subscribe; a listener whose stream is gone can
			// only throw.
			for (const send of listeners) {
				try {
					send('');
				} catch {
					listeners.delete(send);
				}
			}
		}
	});
}

/** How many screens are listening. For the health check and for tests. */
export function listenerCount(): number {
	return listeners.size;
}
