<script lang="ts">
	/**
	 * "Are you sure?" for destructive actions, naming what is about to go.
	 *
	 * A native `confirm()` cannot be styled, cannot be read by the same modal
	 * stack as everything else, and — the reason it is gone — says "this order"
	 * rather than which one. A dialog that names the thing is the difference
	 * between confirming and confirming *the right row*.
	 *
	 * It renders **inside the caller's form**, so its confirm button is an
	 * ordinary submit and the form's own `use:enhance` still runs. There is no
	 * callback to wire up and no second path to keep in step.
	 */
	import Modal from './Modal.svelte';

	let {
		open = $bindable(false),
		title,
		/** What is being acted on, named — an order code, a lot label, an event. */
		subject,
		/**
		 * The verb, used both in the question and on the button. Process events
		 * are undone rather than deleted — the ledger is append-only, so the row
		 * leaves the list by posting its opposite — and the dialog has to say so.
		 */
		action = 'Eliminar',
		onClose
	}: {
		open?: boolean;
		title: string;
		subject: string;
		action?: string;
		/**
		 * For callers whose `open` is derived rather than bound — a table where
		 * one row at a time is asking. They own the state, so closing has to go
		 * back to them instead of being assigned here.
		 */
		onClose?: () => void;
	} = $props();

	function close() {
		if (onClose) onClose();
		else open = false;
	}
</script>

<Modal {title} bind:open {onClose} placement="center">
	<!-- Tight against the tag on purpose: a newline before the text renders as a
	     leading space, which reads as an indent before the question mark. -->
	<p class="text-sm text-text">¿{action} <strong class="font-medium">{subject}</strong>?</p>

	<div class="mt-5 flex gap-2">
		<!-- Submits the form this dialog sits inside. -->
		<button
			type="submit"
			class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition
				hover:opacity-90"
		>
			{action}
		</button>
		<button
			type="button"
			onclick={close}
			class="rounded-md border border-border px-4 py-2 text-sm text-muted transition
				hover:text-text"
		>
			Cancelar
		</button>
	</div>
</Modal>
