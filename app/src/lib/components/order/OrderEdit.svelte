<script lang="ts">
	/**
	 * Corrects an order's descriptive fields.
	 *
	 * Reuses the same `orderFields` definitions as the creation form, so the two
	 * cannot drift apart — a rule added there applies here without being copied.
	 *
	 * `ID_ORDEN` is not editable and is not recomputed when the client changes.
	 * Codes are issued once and stored; rewriting one would orphan whatever has
	 * already been written on a bag.
	 */
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Form from '$lib/components/form/Form.svelte';
	import { orderFields } from '$lib/fields/order';
	import { validateRow, type FieldOption, type FormRow } from '$lib/fields/types';
	import { announceOnSuccess } from '$lib/enhanceWithAnnounce';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { OrderDetail } from '$lib/server/orders';

	let {
		order,
		clients,
		brands
	}: {
		order: OrderDetail;
		clients: FieldOption[];
		/** Client id → brand, so the brand field can follow the client. */
		brands: Record<string, string>;
	} = $props();

	let open = $state(false);
	let draft = $state<FormRow>({});
	let errors = $state<Record<string, string>>({});

	const fields = $derived(orderFields(clients));

	function edit() {
		draft = {
			type: order.type,
			productLine: order.productLine ?? '',
			clientId: String(order.clientId),
			brand: order.brand ?? '',
			peelStick: order.peelStick,
			notes: order.notes ?? ''
		};
		errors = {};
		open = true;
	}

	// Brand follows the client, matching the creation form.
	$effect(() => {
		if (!open) return;
		const id = String(draft.clientId ?? '');
		draft.brand = id ? (brands[id] ?? '') : '';
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

<button
	type="button"
	onclick={edit}
	title="Editar"
		class="hint rounded-md p-1.5 text-muted transition
		hover:bg-amber-50 hover:text-amber-700
		dark:hover:bg-amber-950/50 dark:hover:text-amber-300"
>
	<Icon name="pencil" size={18} />
	<span class="sr-only">Editar</span>
</button>

<Modal title="Editar orden" bind:open size="wide">
	<form method="POST" action="?/update" use:enhance={submit}>
		<input type="hidden" name="type" value={draft.type} />
		<input type="hidden" name="clientId" value={draft.clientId} />
		<input type="hidden" name="productLine" value={draft.productLine} />
		<input type="hidden" name="peelStick" value={draft.peelStick} />
		<input type="hidden" name="notes" value={draft.notes} />

		<Form {fields} bind:row={draft} {errors} idPrefix="edit" />

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
