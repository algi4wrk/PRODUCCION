<script lang="ts">
	/**
	 * Adds a packaging reference to an order that already exists — or corrects
	 * one.
	 *
	 * Reuses `referenceFields`, so the bag-size rule, the variety rule and the
	 * budget check all apply exactly as they do in the creation form. The budget
	 * is what is left of the order's roasted estimate after the references it
	 * already has — adding one later must not promise coffee twice.
	 */
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';
	import Form from '$lib/components/form/Form.svelte';
	import AddButton from './AddButton.svelte';
	import { referenceFields, blankReference, type BagOption } from '$lib/fields/reference';
	import { validateRow, type FormRow } from '$lib/fields/types';
	import { announceOnSuccess } from '$lib/enhanceWithAnnounce';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		bags,
		lotVarieties,
		availableKilos,
		/** The reference being corrected. Absent when adding a new one. */
		edit,
		open = $bindable(false)
	}: {
		bags: readonly BagOption[];
		lotVarieties: readonly string[];
		/** Kilos of the roasted estimate not yet claimed by another reference. */
		availableKilos: number;
		edit?: { id: number; row: FormRow };
		open?: boolean;
	} = $props();

	let draft = $state<FormRow>({});
	let errors = $state<Record<string, string>>({});

	const fields = $derived(referenceFields({ bags, lotVarieties, availableKilos }));

	function start() {
		draft = blankReference(lotVarieties[0] ?? '');
		errors = {};
		open = true;
	}

	/**
	 * Opening in edit mode fills the form from the reference. Its own kilos are
	 * added back to the budget by the caller, so editing a line does not have to
	 * fit alongside itself.
	 */
	let wasOpen = $state(false);
	$effect(() => {
		if (open && !wasOpen && edit) {
			draft = { ...edit.row };
			errors = {};
		}
		wasOpen = open;
	});

	const submit: SubmitFunction = (input) => {
		errors = validateRow(fields, draft);
		if (Object.keys(errors).length > 0) {
			input.cancel();
			return;
		}

		const announce = announceOnSuccess(input);
		return async (opts) => {
			if (typeof announce === 'function') await announce(opts);
			if (opts.result.type === 'success') open = false;
		};
	};
</script>

<!-- In edit mode the caller owns the trigger: it is a button in the detail
     modal, not a "+ Nuevo" in the section header. -->
{#if !edit}
	<AddButton onclick={start} />
{/if}

<Modal
	title={edit ? 'Tipos de empaque — editar referencia' : 'Tipos de empaque — nueva referencia'}
	bind:open
	size="wide"
>
	<form
		method="POST"
		action={edit ? '?/updateReference' : '?/addReference'}
		use:enhance={submit}
	>
		<input type="hidden" name="reference" value={JSON.stringify(draft)} />
		{#if edit}<input type="hidden" name="id" value={edit.id} />{/if}

		<Form {fields} bind:row={draft} {errors} idPrefix="add-ref" />

		<div class="mt-5 flex gap-2">
			<button
				type="submit"
				class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition
					hover:opacity-90"
			>
				{edit ? 'Guardar cambios' : 'Agregar referencia'}
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
