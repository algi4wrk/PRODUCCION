<script lang="ts">
	/**
	 * Records a selección, on either side of the roast.
	 *
	 * The stage is not asked for: it follows from what the lot is holding, since
	 * green coffee can only be sorted green and roasted coffee roasted. The lot
	 * list is already filtered to one stage, so choosing a lot settles it.
	 */
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';
	import Form from '$lib/components/form/Form.svelte';
	import AddButton from '$lib/components/order/AddButton.svelte';
	import StaffModal from './StaffModal.svelte';
	import {
		blankSeleccion,
		seleccionFields,
		selectedLot,
		type SeleccionLotOption
	} from '$lib/fields/seleccion';
	import { validateRow, type FieldOption, type FormRow } from '$lib/fields/types';
	import { announceOnSuccess } from '$lib/enhanceWithAnnounce';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		lots,
		staff,
		title,
		/** The record being rewritten. Absent when recording a new one. */
		edit,
		open = $bindable(false)
	}: {
		lots: readonly SeleccionLotOption[];
		staff: readonly FieldOption[];
		title: string;
		edit?: { id: number; row: FormRow };
		open?: boolean;
	} = $props();

	let draft = $state<FormRow>({});
	let errors = $state<Record<string, string>>({});
	let formError = $state('');
	/** The stacked "+ Nuevo responsable" sheet. */
	let staffOpen = $state(false);

	const fields = $derived(seleccionFields({ lots, staff }));

	function start() {
		draft = blankSeleccion();
		errors = {};
		formError = '';
		open = true;
	}

	/** Choosing a lot offers everything it is holding unsorted. */

	/**
	 * Opening in edit mode fills the form from the record.
	 *
	 * `lastLot` is set with it so the initial-value effect below does not fire and
	 * overwrite what was recorded with what it would have proposed — the lot has
	 * not just been chosen, it was chosen when the record was made.
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
		draft.totalKilos = lot.availableKilos;
		draft.netKilos = null;
		draft.quakerKilos = null;
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
				formError = String(opts.result.data?.error ?? (edit ? 'No se pudo guardar la selección.' : 'No se pudo registrar la selección.'));
			}
		};
	};
</script>

<!-- In edit mode the caller owns the trigger: it is a button in the detail
     modal, not a "+ Nuevo" in a section header. -->
{#if !edit}
	<AddButton onclick={start} />
{/if}

<Modal {title} bind:open size="wide">
	<form method="POST" action={edit ? '?/editSeleccion' : '?/seleccion'} use:enhance={submit}>
		<input type="hidden" name="seleccion" value={JSON.stringify(draft)} />
		{#if edit}<input type="hidden" name="id" value={edit.id} />{/if}

		<Form
			{fields}
			bind:row={draft}
			{errors}
			idPrefix="sel"
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
				{edit ? 'Guardar cambios' : 'Registrar selección'}
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
