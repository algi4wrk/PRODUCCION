<script lang="ts">
	/**
	 * The detail view of one process event, with its two actions.
	 *
	 * Every step's section shows the same thing here — the whole record, then
	 * Editar and Deshacer — so the shape lives once. What differs is the facts
	 * each step reports and the form its Editar opens, and both are passed in.
	 *
	 * Editing and undoing are gated by the same fact, `canUndo`: with nothing
	 * standing on the event, unwinding it and writing it again cannot invalidate
	 * anything downstream, because there is nothing downstream. When something
	 * does stand on it, both controls are disabled and the reason is stated
	 * rather than left to be discovered by clicking.
	 */
	import type { Snippet } from 'svelte';
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import RecordModal from '$lib/components/RecordModal.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import type { Fact } from '$lib/components/FactGrid.svelte';
	import { announceOnSuccess } from '$lib/enhanceWithAnnounce';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		open = false,
		/**
		 * Closing goes back to the caller: `open` is derived from which row is
		 * showing, so the section owns it and assigning here would leave the two
		 * disagreeing — the row would stay "open" and never reopen.
		 */
		onClose,
		title,
		facts,
		notes,
		/** Whether the event can still be edited or undone. */
		canUndo,
		/**
		 * Why not, when it cannot. Shown on hover over the controls it disables,
		 * rather than as a standing note: it explains something you tried to press,
		 * and until you try it is a sentence in the way.
		 */
		blockedReason,
		/** The action that undoes it, e.g. "?/undoTostion". */
		undoAction,
		id,
		/** What the confirmation names — "la tostión de B - Castillo del 7/8". */
		subject,
		/** Absent where editing is not offered: the lot page has no pickers. */
		onEdit,
		/** Hides Deshacer, for views that only report what happened. */
		readonly = false,
		/** Extra content under the facts — see RecordModal's `body`. */
		body,
		/** The edit form itself, rendered by the caller and opened by `onEdit`. */
		editForm
	}: {
		open?: boolean;
		onClose: () => void;
		title: string;
		facts: readonly Fact[];
		notes?: string | null;
		canUndo: boolean;
		blockedReason: string;
		undoAction: string;
		id: number;
		subject: string;
		onEdit?: () => void;
		readonly?: boolean;
		body?: Snippet;
		editForm?: Snippet;
	} = $props();

	let confirming = $state(false);
	let error = $state('');

	const undo: SubmitFunction = (input) => {
		error = '';
		const announce = announceOnSuccess(input);
		return async (opts) => {
			if (typeof announce === 'function') await announce(opts);
			// Closing on success: the record it was showing no longer exists.
			if (opts.result.type === 'success') onClose();
			if (opts.result.type === 'failure') {
				error = String(opts.result.data?.error ?? 'No se pudo deshacer.');
			}
		};
	};

	const ACTION =
		'flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted ' +
		'transition disabled:cursor-not-allowed disabled:opacity-40 ' +
		'disabled:hover:bg-transparent disabled:hover:text-muted';
</script>

<RecordModal {open} {onClose} {title} {facts} {notes} {body}>
	{#snippet actions()}
		{#if onEdit}
			<button
				type="button"
				onclick={onEdit}
				disabled={!canUndo}
				title={canUndo ? undefined : blockedReason}
				class="{ACTION} hover:bg-amber-50 hover:text-amber-700
					dark:hover:bg-amber-950/40 dark:hover:text-amber-300"
			>
				<Icon name="pencil" />
				Editar
			</button>
		{/if}

		{#if !readonly}
			<form method="POST" action={undoAction} use:enhance={undo}>
				<input type="hidden" name="id" value={id} />
				<button
					type="button"
					onclick={() => (confirming = true)}
					disabled={!canUndo}
					title={canUndo ? undefined : blockedReason}
					class="{ACTION} hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50"
				>
					<Icon name="close" size={14} />
					Deshacer
				</button>

				<ConfirmDialog bind:open={confirming} title="Deshacer" {subject} action="Deshacer" />
			</form>
		{/if}

		{#if error}
			<p class="w-full text-sm text-red-600 dark:text-red-400">{error}</p>
		{/if}
	{/snippet}
</RecordModal>

<!-- Outside the modal: the edit form is a modal of its own, stacked on top. -->
{#if editForm}{@render editForm()}{/if}
