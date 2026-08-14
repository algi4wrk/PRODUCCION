<script lang="ts">
	/**
	 * "+ Nuevo responsable", stacked on top of whichever form asked for it.
	 *
	 * One component rather than the same wiring in four process forms: the
	 * trilla, selección, tostión and movimiento forms all ask who did the work,
	 * and all of them meet somebody whose name is not in the list yet.
	 *
	 * On save it hands back the new id so the form underneath can select it,
	 * which is what stops the operator losing what they had already typed.
	 */
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Modal from '$lib/components/Modal.svelte';
	import Form from '$lib/components/form/Form.svelte';
	import { blankStaff, staffFields } from '$lib/fields/staff';
	import { validateRow, type FormRow } from '$lib/fields/types';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		open = $bindable(false),
		onCreated
	}: {
		open?: boolean;
		/** Called with the new id, so the form beneath can select it. */
		onCreated: (id: number) => void;
	} = $props();

	let draft = $state<FormRow>(blankStaff());
	let errors = $state<Record<string, string>>({});

	const fields = staffFields();

	// A fresh sheet each time it opens.
	$effect(() => {
		if (open) {
			draft = blankStaff();
			errors = {};
		}
	});

	const submit: SubmitFunction = ({ cancel }) => {
		errors = validateRow(fields, draft);
		if (Object.keys(errors).length > 0) {
			cancel();
			return;
		}

		return async ({ result }) => {
			if (result.type !== 'success') return;
			const id = result.data?.createdStaffId;
			await invalidateAll();
			if (id) onCreated(Number(id));
			open = false;
		};
	};
</script>

<Modal title="Nuevo responsable" bind:open>
	<form method="POST" action="?/createStaff" use:enhance={submit}>
		<input type="hidden" name="name" value={draft.name} />
		<input type="hidden" name="position" value={draft.position} />

		<Form {fields} bind:row={draft} {errors} idPrefix="staff" />

		<div class="mt-5 flex gap-2">
			<button
				type="submit"
				class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition
					hover:opacity-90"
			>
				Crear responsable
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
