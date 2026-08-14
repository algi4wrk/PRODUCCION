<script lang="ts">
	/**
	 * Records one roasting batch — or rewrites one.
	 *
	 * Choosing a lot fills in the profile the client asked for and proposes a
	 * batch of whatever the roaster can take — capped at what the lot is actually
	 * holding, since the last batch of a lot is usually a partial one.
	 *
	 * Editing is the same form on the same fields: an edit that could change some
	 * fields and not others would be a second, quieter set of rules to keep in
	 * step. Passing `edit` swaps the trigger for the caller's own control, opens
	 * on the values as recorded, and posts to the action that rewrites the batch.
	 * The server allows that only while nothing stands on the event — the same
	 * condition undoing it has.
	 */
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';
	import Form from '$lib/components/form/Form.svelte';
	import AddButton from '$lib/components/order/AddButton.svelte';
	import StaffModal from './StaffModal.svelte';
	import {
		blankTostion,
		selectedLot,
		tostionFields,
		type TostionLotOption
	} from '$lib/fields/tostion';
	import { validateRow, type FieldOption, type FormRow } from '$lib/fields/types';
	import { ROASTER_BATCH_KILOS } from '$lib/domain/vocabulary';
	import { announceOnSuccess } from '$lib/enhanceWithAnnounce';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		lots,
		staff,
		/** The batch being rewritten. Absent when recording a new one. */
		edit,
		open = $bindable(false)
	}: {
		lots: readonly TostionLotOption[];
		staff: readonly FieldOption[];
		edit?: { id: number; row: FormRow };
		open?: boolean;
	} = $props();
	let draft = $state<FormRow>({});
	let errors = $state<Record<string, string>>({});
	let formError = $state('');
	/** The stacked "+ Nuevo responsable" sheet. */
	let staffOpen = $state(false);

	const fields = $derived(tostionFields({ lots, staff }));

	function start() {
		draft = blankTostion();
		errors = {};
		formError = '';
		open = true;
	}

	/**
	 * Opening in edit mode fills the form from the event.
	 *
	 * `lastLot` is set with it so the initial-value effect below does not fire and
	 * overwrite the recorded batch with a proposed one — the lot has not been
	 * chosen, it was already chosen.
	 */
	let wasOpen = $state(false);
	$effect(() => {
		if (open && !wasOpen && edit) {
			draft = { ...edit.row };
			lastLot = String(edit.row.lotId ?? '');
			errors = {};
			formError = '';
		}
		wasOpen = open;
	});

	let lastLot = $state('');

	$effect(() => {
		if (!open) return;
		const chosen = String(draft.lotId ?? '');
		if (chosen === lastLot) return;
		lastLot = chosen;

		const lot = selectedLot(lots, draft);
		if (!lot) return;

		draft.roastType = lot.roastType;
		// A full batch, or the rest of the lot if that is less.
		draft.batchKilos = Math.min(ROASTER_BATCH_KILOS, lot.availableKilos);
		draft.roastedKilos = null;
	});

	const submit: SubmitFunction = (input) => {
		errors = validateRow(fields, draft);
		formError = '';
		if (Object.keys(errors).length > 0) {
			input.cancel();
			return;
		}

		const announce = announceOnSuccess(input);
		return async (opts) => {
			if (typeof announce === 'function') await announce(opts);
			if (opts.result.type === 'success') open = false;
			if (opts.result.type === 'failure') {
				formError = String(opts.result.data?.error ?? 'No se pudo registrar la tostión.');
			}
		};
	};
</script>

<!-- In edit mode the caller owns the trigger: it is a button in the detail
     modal, not a "+ Nuevo" in a section header. -->
{#if !edit}
	<AddButton onclick={start} />
{/if}

<Modal title={edit ? 'Tostión — editar bache' : 'Tostión — nuevo bache'} bind:open size="wide">
	<form method="POST" action={edit ? '?/editTostion' : '?/tostion'} use:enhance={submit}>
		<input type="hidden" name="tostion" value={JSON.stringify(draft)} />
		{#if edit}<input type="hidden" name="id" value={edit.id} />{/if}

		<Form
			{fields}
			bind:row={draft}
			{errors}
			idPrefix="tos"
			onCreateRef={(name) => {
				if (name === 'staffId') staffOpen = true;
			}}
		/>

		{#if formError}
			<p class="mt-3 text-sm text-red-600 dark:text-red-400">{formError}</p>
		{/if}

		<div class="mt-5 flex gap-2">
			<button
				type="submit"
				class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition
					hover:opacity-90"
			>
				{edit ? 'Guardar cambios' : 'Registrar tostión'}
			</button>
			<button
				type="button"
				onclick={() => (open = false)}
				class="rounded-md border border-border px-4 py-2 text-sm text-muted transition
					hover:text-text"
			>
				Cancelar
			</button>
		</div>
	</form>
</Modal>

<!-- Outside the modal above: the new responsable is selected straight into the
     form that asked for them. -->
<StaffModal bind:open={staffOpen} onCreated={(id) => (draft.staffId = String(id))} />
