<script lang="ts">
	/**
	 * Toggles browser fullscreen for the wall display.
	 *
	 * Requests fullscreen on the document root rather than on a container so the
	 * page background covers the whole screen; the app chrome is hidden by an
	 * `html:fullscreen` rule in app.css rather than by shared state.
	 *
	 * Hidden entirely when the browser has no Fullscreen API — a button that
	 * cannot work is worse than no button.
	 */
	let active = $state(false);
	let supported = $state(false);

	$effect(() => {
		supported = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;

		const sync = () => (active = !!document.fullscreenElement);
		sync();
		document.addEventListener('fullscreenchange', sync);
		return () => document.removeEventListener('fullscreenchange', sync);
	});

	async function toggle() {
		// Fullscreen requests reject when not driven by a user gesture, and when
		// already in the requested state — neither is worth surfacing.
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await document.documentElement.requestFullscreen();
		} catch {
			// Ignored: the button simply does nothing.
		}
	}
</script>

{#if supported}
	<button
		type="button"
		onclick={toggle}
		title={active ? 'Salir de pantalla completa' : 'Pantalla completa'}
		class="rounded-md border border-border px-3 py-1.5 text-xs text-muted transition
			hover:border-accent/40 hover:text-accent"
	>
		{active ? '⤡ Salir' : '⤢ Pantalla completa'}
	</button>
{/if}
