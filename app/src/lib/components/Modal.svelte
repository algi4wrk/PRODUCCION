<script module lang="ts">
	/**
	 * Shared stack of open modals.
	 *
	 * Modals nest — "+ Nueva finca" opens on top of the lot form — so only the
	 * topmost one may react to Escape. Without this, one press would dismiss the
	 * whole stack and discard the lot being filled in underneath.
	 *
	 * Module scope, so every Modal instance shares the same stack.
	 */
	import { untrack } from 'svelte';

	let stack = $state<symbol[]>([]);

	// Mutations read the current stack untracked: the effect that calls these
	// also reads `stack` through them, and without untrack each push would
	// re-trigger that effect and push again, looping.
	function push(id: symbol) {
		stack = [...untrack(() => stack), id];
	}

	function pop(id: symbol) {
		stack = untrack(() => stack).filter((entry) => entry !== id);
	}

	function isTopmost(id: symbol): boolean {
		return stack.at(-1) === id;
	}

	/** Depth of a modal in the stack, used to layer it above the one below. */
	function depthOf(id: symbol): number {
		return Math.max(0, stack.indexOf(id));
	}
</script>

<script lang="ts">
	/**
	 * Overlay dialog, used for the inline "+ Nuevo" forms and for the nested lot
	 * and reference sub-forms.
	 *
	 * A modal rather than a new window because the form underneath holds unsaved
	 * state — an order in progress with its lots and references. Navigating away
	 * would discard it.
	 */
	import type { Snippet } from 'svelte';

	/** Panel widths. `wide` suits the two-column sub-forms; `md` the short ones. */
	const WIDTHS = {
		md: 'max-w-lg',
		wide: 'max-w-3xl'
	} as const;

	let {
		title,
		open = $bindable(false),
		size = 'md',
		placement = 'top',
		onClose,
		children
	}: {
		title: string;
		open?: boolean;
		size?: keyof typeof WIDTHS;
		/**
		 * Where the panel sits. Forms open at the top, because they are taller
		 * than the screen and centring them would put their first field halfway
		 * down it; a short dialog that asks one question is centred, where the
		 * eye already is.
		 */
		placement?: 'top' | 'center';
		/**
		 * Called on Escape, backdrop click or the close button. Use it when the
		 * caller derives `open` from its own state rather than binding it, so a
		 * dismissal clears that state instead of leaving it stale.
		 */
		onClose?: () => void;
		children: Snippet;
	} = $props();

	const id = Symbol('modal');
	let panel = $state<HTMLDivElement | null>(null);

	// Register while open so the stack always reflects what is on screen.
	$effect(() => {
		if (!open) return;
		push(id);
		return () => pop(id);
	});

	/**
	 * Move focus into the dialog when it opens.
	 *
	 * Correct for screen readers, and it also fixes Escape: focus otherwise
	 * stayed on the control that opened the dialog — a `<select>` in the case of
	 * "+ Nueva finca" — and the browser consumes Escape there, so the key never
	 * reached the handler.
	 */
	$effect(() => {
		if (open && panel) panel.focus();
	});

	const depth = $derived(open ? depthOf(id) : 0);

	/**
	 * When `onClose` is given the caller owns the open state — it is derived from
	 * something else, such as "is a draft row open" — so this must not assign to
	 * `open` itself. Doing so left the prop and the caller's state disagreeing,
	 * and the dialog would not close.
	 */
	function close() {
		if (onClose) onClose();
		else open = false;
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && isTopmost(id)) {
			event.stopPropagation();
			close();
		}
	}
</script>

<svelte:window onkeydown={open ? onKeydown : undefined} />

{#if open}
	<!-- Backdrop. Clicking outside the panel closes the dialog. -->
	<div
		class="fixed inset-0 flex justify-center overflow-y-auto bg-black/40 p-4 sm:p-8
			{placement === 'center' ? 'items-center' : 'items-start'}"
		style="z-index: {50 + depth * 10}"
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget) close();
		}}
	>
		<!--
			text-left: a modal renders where its caller sits, and a caller can be a
			right-aligned table cell — the row-action column is one. Without this the
			dialog inherits that alignment and its text drifts to the right.
		-->
		<div
			bind:this={panel}
			role="dialog"
			aria-modal="true"
			aria-label={title}
			tabindex="-1"
			class="w-full {WIDTHS[size]} rounded-lg border border-border bg-surface text-left
				shadow-xl outline-none"
		>
			<header class="flex items-center justify-between border-b border-border px-5 py-3">
				<h2 class="text-sm font-semibold tracking-wide text-text uppercase">{title}</h2>
				<button
					type="button"
					onclick={close}
					aria-label="Cerrar"
					class="text-muted transition hover:text-text"
				>
					✕
				</button>
			</header>

			<div class="px-5 py-5">
				{@render children()}
			</div>
		</div>
	</div>
{/if}
