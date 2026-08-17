<script lang="ts">
	/**
	 * Records a trilla.
	 *
	 * Entirely declared in `fields/trilla.ts` — the lot list, the screen fields
	 * that appear only when the specification asks for them, and the live cisco
	 * figure are all `FieldDef`s, so this component is a modal and a submit.
	 *
	 * The one thing written by hand is the workbook's Initial values: choosing a
	 * lot fills in the pergamino it is holding and the almendra its beneficio
	 * predicts. Both stay editable — they are what the operator came to correct.
	 */
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';
	import Form from '$lib/components/form/Form.svelte';
	import AddButton from '$lib/components/order/AddButton.svelte';
	import StaffModal from './StaffModal.svelte';
	import { blankTrilla, selectedLot, trillaFields, type TrillaLotOption } from '$lib/fields/trilla';
	import { validateRow, type FieldOption, type FormRow } from '$lib/fields/types';
	import { announceOnSuccess } from '$lib/enhanceWithAnnounce';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		lots,
		staff,
		/**
		 * Opened from a lot's own page: that lot is the subject, so the form opens
		 * on it instead of asking which.
		 */
		lotId,
		/** The record being rewritten. Absent when recording a new one. */
		edit,
		/**
		 * Whether to render the "+ Nuevo" that opens this form. False where the
		 * caller has its own control — the next-step badge on a lot's page — so
		 * the page does not grow a second way to do the same thing.
		 */
		trigger = true,
		open = $bindable(false)
	}: {
		lots: readonly TrillaLotOption[];
		staff: readonly FieldOption[];
		lotId?: number;
		edit?: { id: number; row: FormRow };
		trigger?: boolean;
		open?: boolean;
	} = $props();

	let draft = $state<FormRow>({});
	let errors = $state<Record<string, string>>({});
	let formError = $state('');
	/** The stacked "+ Nuevo responsable" sheet. */
	let staffOpen = $state(false);

	const fields = $derived(trillaFields({ lots, staff }));

	function start() {
		draft = blankTrilla();
		if (lotId) draft.lotId = String(lotId);
		errors = {};
		formError = '';
		open = true;
	}

	/**
	 * Ports the Initial values, keyed on the lot changing rather than on the
	 * weights being empty — otherwise clearing a field to retype it would refill
	 * it under the operator's cursor.
	 */

	/**
	 * Opening in edit mode fills the form from the record.
	 *
	 * `lastLot` is set with it so the initial-value effect below does not fire and
	 * overwrite what was recorded with what it would have proposed — the lot has
	 * not just been chosen, it was chosen when the record was made.
	 */
	let wasOpen = $state(false);
	$effect(() => {
		// Opened from outside — the next-step button on the order page — so the
		// draft has to be started here: `start()` only runs when the form's own
		// trigger is the thing that opened it.
		if (open && !wasOpen && !edit) start();

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

		draft.parchmentKilos = lot.availableKilos;
		draft.greenKilos = lot.estimatedGreenKilos;
		// Screens the lot does not ask for must not travel with the form.
		draft.screen14 = null;
		draft.screen1516 = null;
		draft.screen1718 = null;
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
				formError = String(opts.result.data?.error ?? (edit ? 'No se pudo guardar la trilla.' : 'No se pudo registrar la trilla.'));
			}
		};
	};
</script>

<!-- In edit mode the caller owns the trigger: it is a button in the detail
     modal, not a "+ Nuevo" in a section header. -->
{#if !edit && trigger}
	<AddButton onclick={start} />
{/if}

<Modal title={edit ? 'Trilla — editar registro' : 'Trilla — nuevo registro'} bind:open size="wide">
	<form method="POST" action={edit ? '?/editTrilla' : '?/trilla'} use:enhance={submit}>
		<input type="hidden" name="trilla" value={JSON.stringify(draft)} />
		{#if edit}<input type="hidden" name="id" value={edit.id} />{/if}

		<Form
			{fields}
			bind:row={draft}
			{errors}
			idPrefix="trilla"
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
				{edit ? 'Guardar cambios' : 'Registrar trilla'}
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
