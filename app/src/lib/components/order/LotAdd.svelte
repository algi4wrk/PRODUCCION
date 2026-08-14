<script lang="ts">
	/**
	 * Adds a lot to an order that already exists.
	 *
	 * Reuses `lotFields` — the same definitions the creation form renders — so a
	 * rule added there applies here without being copied. A lot received on
	 * Tuesday is not a different kind of lot from one received at order creation.
	 *
	 * Carries the inline "+ Nueva finca" the creation form has, because a lot
	 * arriving later is exactly when an unknown farm turns up.
	 */
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Modal from '$lib/components/Modal.svelte';
	import Form from '$lib/components/form/Form.svelte';
	import AddButton from './AddButton.svelte';
	import { lotFields, blankLot } from '$lib/fields/lot';
	import { farmFields } from '$lib/fields/farm';
	import { validateRow, type FieldOption, type FormRow } from '$lib/fields/types';
	import { announceOnSuccess } from '$lib/enhanceWithAnnounce';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		farms,
		varieties
	}: {
		farms: readonly FieldOption[];
		varieties: readonly FieldOption[];
	} = $props();

	let open = $state(false);
	let draft = $state<FormRow>({});
	let errors = $state<Record<string, string>>({});

	const fields = $derived(lotFields(farms, varieties));

	function start() {
		draft = blankLot();
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

	// ── Inline finca creation, stacked on top of this modal ──────────────────
	let farmOpen = $state(false);
	let farmDraft = $state<FormRow>({});
	let farmErrors = $state<Record<string, string>>({});

	const farmDefs = farmFields();

	function openFarm() {
		farmDraft = { name: '', farmer: '', municipality: '', department: '' };
		farmErrors = {};
		farmOpen = true;
	}

	const submitFarm: SubmitFunction = ({ cancel }) => {
		farmErrors = validateRow(farmDefs, farmDraft);
		if (Object.keys(farmErrors).length > 0) {
			cancel();
			return;
		}

		return async ({ result }) => {
			if (result.type !== 'success') return;
			const newId = result.data?.createdFarmId;
			await invalidateAll();
			// Select the new finca straight into the lot still open behind this.
			if (newId) draft.farmId = String(newId);
			farmOpen = false;
		};
	};
</script>

<AddButton onclick={start} />

<Modal title="Materia prima — nuevo lote" bind:open size="wide">
	<form method="POST" action="?/addLot" use:enhance={submit}>
		<!-- The row travels as JSON: its shape is the field definitions', not a
		     hand-written list of inputs that could fall out of step with them. -->
		<input type="hidden" name="lot" value={JSON.stringify(draft)} />

		<Form
			{fields}
			bind:row={draft}
			{errors}
			idPrefix="add-lot"
			onCreateRef={(name) => {
				if (name === 'farmId') openFarm();
			}}
		/>

		<div class="mt-5 flex gap-2">
			<button
				type="submit"
				class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition
					hover:opacity-90"
			>
				Agregar lote
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

<Modal title="Nueva finca" bind:open={farmOpen}>
	<form method="POST" action="?/createFarm" use:enhance={submitFarm}>
		<input type="hidden" name="name" value={farmDraft.name} />
		<input type="hidden" name="farmer" value={farmDraft.farmer} />
		<input type="hidden" name="municipality" value={farmDraft.municipality} />
		<input type="hidden" name="department" value={farmDraft.department} />

		<Form fields={farmDefs} bind:row={farmDraft} errors={farmErrors} idPrefix="add-lot-farm" />

		<div class="mt-5 flex gap-2">
			<button
				type="submit"
				class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition
					hover:opacity-90"
			>
				Crear finca
			</button>
			<button
				type="button"
				onclick={() => (farmOpen = false)}
				class="rounded-md border border-border px-4 py-2 text-sm text-muted transition
					hover:text-text"
			>
				Cancelar
			</button>
		</div>
	</form>
</Modal>
