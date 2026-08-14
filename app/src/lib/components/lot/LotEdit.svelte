<script lang="ts">
	/**
	 * Corrects a lot's description.
	 *
	 * Reuses `lotFields`, minus the two that are not opinions: MATERIA PRIMA
	 * INICIAL and PESO INICIAL are reception facts, and a wrong weight is
	 * corrected by a compensating entry rather than by editing what somebody
	 * already worked from.
	 */
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';
	import Form from '$lib/components/form/Form.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { lotFields } from '$lib/fields/lot';
	import { validateRow, type FieldOption, type FormRow } from '$lib/fields/types';
	import { announceOnSuccess } from '$lib/enhanceWithAnnounce';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		lot,
		farms,
		varieties
	}: {
		lot: FormRow;
		farms: readonly FieldOption[];
		varieties: readonly FieldOption[];
	} = $props();

	let open = $state(false);
	let draft = $state<FormRow>({});
	let errors = $state<Record<string, string>>({});

	// Weight and material are dropped: what arrived is not editable.
	const fields = $derived(
		lotFields(farms, varieties).filter(
			(field) => !['rawMaterial', 'initialWeight', 'estimatedGreen', 'estimatedRoasted'].includes(field.name)
		)
	);

	function start() {
		draft = { ...lot };
		errors = {};
		open = true;
	}

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

<button
	type="button"
	onclick={start}
	class="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted transition
		hover:bg-amber-50 hover:text-amber-700
		dark:hover:bg-amber-950/50 dark:hover:text-amber-300"
>
	<Icon name="pencil" />
	Editar
</button>

<Modal title="Editar lote" bind:open size="wide">
	<form method="POST" action="?/updateLot" use:enhance={submit}>
		<input type="hidden" name="lot" value={JSON.stringify(draft)} />

		<Form {fields} bind:row={draft} {errors} idPrefix="edit-lot" />

		<div class="mt-5 flex gap-2">
			<button
				type="submit"
				class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition
					hover:opacity-90"
			>
				Guardar cambios
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
