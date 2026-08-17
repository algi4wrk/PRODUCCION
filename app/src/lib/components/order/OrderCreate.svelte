<script lang="ts">
	/**
	 * Order creation, as a modal over the queue.
	 *
	 * Everything — the order, its lots and its references — is held in form state
	 * and written in one transaction on save. Closing therefore leaves nothing
	 * behind, which is not possible in the source app where a nested sub-form
	 * writes its child row immediately.
	 *
	 * It is a modal rather than a page because creating an order is a detour from
	 * the queue and returns to it: the list stays behind the form, so cancelling
	 * puts the operator back exactly where they were. The sub-forms it opens —
	 * a lot, a referencia, a new cliente or finca — stack on top of it, which is
	 * the same arrangement the order page already uses for its own forms.
	 */
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { announceOnSuccess } from '$lib/enhanceWithAnnounce';
	import Form from '$lib/components/form/Form.svelte';
	import NestedTable from '$lib/components/form/NestedTable.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { orderFields } from '$lib/fields/order';
	import { clientFields } from '$lib/fields/client';
	import { farmFields } from '$lib/fields/farm';
	import { clientPrefix } from '$lib/domain/codes';
	import { lotFields, blankLot, selectionMethodsOf, LOT_SUMMARY_COLUMNS } from '$lib/fields/lot';
	import { referenceFields, blankReference, REFERENCE_SUMMARY_COLUMNS } from '$lib/fields/reference';
	import { validateRow, type FieldOption, type FormRow } from '$lib/fields/types';
	import type { BagOption } from '$lib/fields/reference';
	import { orderCode } from '$lib/domain/codes';
	import { referenceKilos, plannedKilos, receivedKilos, formatKilos } from '$lib/domain/derived';
	import { estimatedOrderKilos, remainingKilos, type EstimableLot } from '$lib/domain/estimates';
	import { validatePlannedWeight } from '$lib/domain/validation';
	import { formatSelectionStages } from '$lib/domain/vocabulary';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		data,
		open = $bindable(false)
	}: {
		/** Option lists and code-preview data, loaded with the queue. */
		data: {
			clients: FieldOption[];
			farms: FieldOption[];
			bags: BagOption[];
			varieties: FieldOption[];
			existingCodes: string[];
			prefixes: Record<string, string>;
			brands: Record<string, string>;
		};
		open?: boolean;
	} = $props();

	/** Server error from the create action, shown inside the modal. */
	let formError = $state('');

	/** A blank order, so reopening never inherits the last attempt. */
	function reset() {
		order = {
			type: 'Maquila',
			productLine: '',
			clientId: '',
			brand: '',
			peelStick: false,
			notes: ''
		};
		lots = [];
		references = [];
		errors = {};
		formError = '';
	}

	// Opening resets, so an abandoned draft is genuinely abandoned.
	let wasOpen = $state(false);
	$effect(() => {
		if (open && !wasOpen) reset();
		wasOpen = open;
	});

	/** The order's own fields. */
	let order = $state<FormRow>({
		type: 'Maquila',
		productLine: '',
		clientId: '',
		brand: '',
		peelStick: false,
		notes: ''
	});

	let lots = $state<FormRow[]>([]);
	let references = $state<FormRow[]>([]);
	let errors = $state<Record<string, string>>({});

	const orderFieldDefs = $derived(orderFields(data.clients));

	// A reference can only promise a variety the order's lots actually contain.
	const lotVarieties = $derived([...new Set(lots.map((lot) => String(lot.variety)))]);

	/**
	 * Variety suggestions are loaded with the page, so a new one typed into a lot
	 * would not be offered to the next lot in the same order until after saving.
	 * Merge in the varieties already used by lots in this form.
	 */
	const varietyOptions = $derived.by(() => {
		const known = new Set(data.varieties.map((option) => option.value));
		const fresh = lotVarieties
			.filter((variety) => variety && !known.has(variety))
			.map((variety) => ({ value: variety, label: variety }));
		return [...data.varieties, ...fresh].sort((a, b) => a.label.localeCompare(b.label, 'es'));
	});

	const lotFieldDefs = $derived(lotFields(data.farms, varietyOptions));
	// Brand autofills from the selected client and is stored on the order.
	$effect(() => {
		const id = String(order.clientId ?? '');
		order.brand = id ? (data.brands[id] ?? '') : '';
	});

	/** Live ID_ORDEN preview, using the same generator the server will use. */
	const codePreview = $derived.by(() => {
		const prefix = data.prefixes[String(order.clientId ?? '')];
		if (!prefix) return null;
		return orderCode(prefix, order.type as never, new Date(), data.existingCodes);
	});

	const received = $derived(
		receivedKilos(lots.map((lot) => ({ initialWeight: Number(lot.initialWeight) })))
	);
	const planned = $derived(
		plannedKilos(
			references.map((ref) => ({ grams: Number(ref.grams), quantity: Number(ref.quantity) }))
		)
	);

	/**
	 * Roasted coffee this order is expected to yield: pergamino loses weight at
	 * trilla by beneficio, then everything loses a fifth in the roast. This, not
	 * the raw weight received, is what the packaging plan is measured against.
	 */
	const estimableLots = $derived(
		lots.map((lot) => ({
			rawMaterial: lot.rawMaterial,
			initialWeight: Number(lot.initialWeight) || 0,
			process: lot.process
		})) as EstimableLot[]
	);
	const estimated = $derived(estimatedOrderKilos(estimableLots));

	/** Kilos not yet claimed by a reference — the AppSheet ESTIMADO (kg). */
	const available = $derived(remainingKilos(estimated, planned));

	const referenceFieldDefs = $derived(
		referenceFields({ bags: data.bags, lotVarieties, availableKilos: available })
	);

	const weightWarning = $derived(validatePlannedWeight(planned, estimated));

	const newLot = blankLot;

	const newReference = () => blankReference(lotVarieties[0] ?? '');

	/**
	 * Summary row for a lot inside the nested table. The letter shown is
	 * provisional — the server assigns the real one at save, from the letters
	 * already used in the order.
	 */
	function formatLot(lot: FormRow, index: number) {
		return {
			letter: String.fromCharCode(65 + index),
			rawMaterial: String(lot.rawMaterial ?? ''),
			initialWeight: lot.initialWeight ? formatKilos(Number(lot.initialWeight)) : '',
			variety: String(lot.variety ?? ''),
			roastType: String(lot.roastType ?? ''),
			selectionStages: formatSelectionStages((lot.selectionStages as string[]) ?? [])
		};
	}

	function formatReference(reference: FormRow) {
		const bag = data.bags.find((option) => option.value === String(reference.bagId));
		const grams = Number(reference.grams);
		return {
			grams: grams === 1 ? 'Granel' : `${grams} g`,
			quantity: String(reference.quantity ?? ''),
			grind: String(reference.grind ?? ''),
			variety: String(reference.variety ?? ''),
			bag: bag?.label ?? '',
			kilos: formatKilos(referenceKilos({ grams, quantity: Number(reference.quantity) }))
		};
	}

	/**
	 * Converts form values into what the server expects: numeric ids, and
	 * humidity back from a typed percentage (10,4) to the stored fraction.
	 */
	function serialiseLots(): string {
		return JSON.stringify(
			lots.map((lot) => ({
				rawMaterial: lot.rawMaterial,
				initialWeight: Number(lot.initialWeight),
				variety: lot.variety,
				process: lot.process,
				humidity: Number(lot.humidity) / 100,
				farmId: lot.farmId ? Number(lot.farmId) : null,
				selectionStages: lot.selectionStages,
				// The two method fields become the stored map here, where the rest of
				// the row is converted for the server.
				selectionMethods: selectionMethodsOf(lot),
				roastType: lot.roastType,
				screens: lot.screens,
				addQuaker: lot.addQuaker,
				storeInWarehouse: lot.storeInWarehouse
			}))
		);
	}

	function serialiseReferences(): string {
		return JSON.stringify(
			references.map((reference) => ({
				grams: Number(reference.grams),
				quantity: Number(reference.quantity),
				grind: reference.grind,
				variety: reference.variety,
				bagId: reference.bagId ? Number(reference.bagId) : null
			}))
		);
	}

	// ── Inline client creation ───────────────────────────────────────────────
	// Reached from the "+ Nuevo cliente" entry in the cliente dropdown. Opens in
	// a modal rather than a new page so the order in progress, with its lots and
	// references, survives.

	let clientModalOpen = $state(false);
	let clientDraft = $state<FormRow>({ name: '', brand: '', owner: '', country: '' });
	let clientErrors = $state<Record<string, string>>({});

	const clientFieldDefs = clientFields();

	/** The prefix the new client will get, shown so its effect on codes is visible. */
	const draftPrefix = $derived(
		String(clientDraft.name ?? '').trim()
			? clientPrefix(String(clientDraft.name), String(clientDraft.brand ?? ''))
			: null
	);

	function openClientModal() {
		clientDraft = { name: '', brand: '', owner: '', country: '' };
		clientErrors = {};
		clientModalOpen = true;
	}

	/** Validates before the POST, and selects the new client once it exists. */
	const submitClient: SubmitFunction = ({ cancel }) => {
		clientErrors = validateRow(clientFieldDefs, clientDraft);
		if (Object.keys(clientErrors).length > 0) {
			cancel();
			return;
		}

		return async ({ result }) => {
			if (result.type !== 'success') return;

			const newId = result.data?.createdClientId;
			// Reload so the dropdown and the prefix map include the new client.
			await invalidateAll();
			if (newId) order.clientId = String(newId);
			clientModalOpen = false;
		};
	};

	// ── Inline finca creation ────────────────────────────────────────────────
	// Reached from "+ Nueva finca" inside the lot sub-form. `lotDraft` is bound
	// to the open lot row so the new finca can be selected into it on save.

	let farmModalOpen = $state(false);
	let farmDraft = $state<FormRow>({ name: '', farmer: '', municipality: '', department: '' });
	let farmErrors = $state<Record<string, string>>({});
	let lotDraft = $state<FormRow | null>(null);

	const farmFieldDefs = farmFields();

	function openFarmModal() {
		farmDraft = { name: '', farmer: '', municipality: '', department: '' };
		farmErrors = {};
		farmModalOpen = true;
	}

	const submitFarm: SubmitFunction = ({ cancel }) => {
		farmErrors = validateRow(farmFieldDefs, farmDraft);
		if (Object.keys(farmErrors).length > 0) {
			cancel();
			return;
		}

		return async ({ result }) => {
			if (result.type !== 'success') return;

			const newId = result.data?.createdFarmId;
			await invalidateAll();
			// Select the new finca straight into the lot row still open above.
			if (newId && lotDraft) lotDraft.farmId = String(newId);
			farmModalOpen = false;
		};
	};

	/**
	 * Blocks submission when the order's own fields are invalid, and otherwise
	 * lets the action run — it redirects to the new order, so there is nothing to
	 * close by hand.
	 */
	const submit: SubmitFunction = (input) => {
		errors = validateRow(orderFieldDefs, order);
		formError = '';
		if (Object.keys(errors).length > 0 || weightWarning) {
			input.cancel();
			return;
		}

		const announce = announceOnSuccess(input);
		return async (opts) => {
			if (typeof announce === 'function') await announce(opts);
			if (opts.result.type === 'failure') {
				formError = String(opts.result.data?.error ?? 'No se pudo crear la orden.');
			}
		};
	};
</script>

<Modal title="Nueva orden" bind:open size="wide">
	<!-- The code the order will get, using the same generator the server uses. -->
	{#if codePreview}
		<p class="mb-4 text-sm text-muted">
			Código: <span class="font-mono font-medium text-accent">{codePreview}</span>
		</p>
	{/if}

	{#if formError}
		<p class="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800
			dark:border-red-900 dark:bg-red-950 dark:text-red-300">
			{formError}
		</p>
	{/if}

	<form method="POST" action="?/create" use:enhance={submit} class="flex flex-col gap-6">
		<input type="hidden" name="type" value={order.type} />
		<input type="hidden" name="clientId" value={order.clientId} />
		<input type="hidden" name="productLine" value={order.productLine} />
		<input type="hidden" name="peelStick" value={order.peelStick} />
		<input type="hidden" name="notes" value={order.notes} />
		<input type="hidden" name="lots" value={serialiseLots()} />
		<input type="hidden" name="references" value={serialiseReferences()} />

		<section class="rounded-lg border border-border bg-surface p-4">
			<Form
				fields={orderFieldDefs}
				bind:row={order}
				{errors}
				idPrefix="order"
				onCreateRef={(name) => {
					if (name === 'clientId') openClientModal();
				}}
			/>
		</section>

		<NestedTable
			title="Materia prima"
			fields={lotFieldDefs}
			bind:rows={lots}
			columns={LOT_SUMMARY_COLUMNS}
			formatRow={formatLot}
			newRow={newLot}
			idPrefix="lot"
			bind:draft={lotDraft}
			onCreateRef={(name) => {
				if (name === 'farmId') openFarmModal();
			}}
			emptyMessage="Aún no hay lotes. Puede agregarlos ahora o después de crear la orden."
		/>

		<NestedTable
			title="Tipos de empaque"
			fields={referenceFieldDefs}
			bind:rows={references}
			columns={REFERENCE_SUMMARY_COLUMNS}
			formatRow={formatReference}
			newRow={newReference}
			idPrefix="ref"
			emptyMessage="Aún no hay referencias. Puede agregarlas ahora o después de crear la orden."
		/>

		{#if lots.length > 0 || references.length > 0}
			<div class="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
				<div class="flex flex-wrap gap-x-8 gap-y-1">
					<span class="text-muted">Recibido: <strong class="text-text">{formatKilos(received)} kg</strong></span>
					<span class="text-muted">
						Estimado tostado: <strong class="text-text">{formatKilos(estimated)} kg</strong>
					</span>
					<span class="text-muted">Planeado: <strong class="text-text">{formatKilos(planned)} kg</strong></span>
					<span class="text-muted">
						Disponible:
						<strong class={available < 0 ? 'text-red-600 dark:text-red-400' : 'text-text'}>
							{formatKilos(available)} kg
						</strong>
					</span>
				</div>
				{#if weightWarning}
					<p class="mt-2 text-red-600 dark:text-red-400">{weightWarning}</p>
				{/if}
			</div>
		{/if}

		<div class="flex gap-3">
			<button
				type="submit"
				class="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition
					hover:opacity-90 disabled:opacity-50"
				disabled={!!weightWarning}
			>
				Crear orden
			</button>
			<button
				type="button"
				onclick={() => (open = false)}
				class="rounded-md border border-border px-5 py-2.5 text-sm text-muted transition hover:text-text"
			>
				Cancelar
			</button>
		</div>
	</form>
</Modal>

<!-- Outside the order form: a form cannot be nested inside another form. -->
<Modal title="Nuevo cliente" bind:open={clientModalOpen}>
	<form method="POST" action="?/createClient" use:enhance={submitClient}>
		<input type="hidden" name="name" value={clientDraft.name} />
		<input type="hidden" name="brand" value={clientDraft.brand} />
		<input type="hidden" name="owner" value={clientDraft.owner} />
		<input type="hidden" name="country" value={clientDraft.country} />

		<Form
			fields={clientFieldDefs}
			bind:row={clientDraft}
			errors={clientErrors}
			idPrefix="client"
		/>

		{#if draftPrefix}
			<p class="mt-4 text-xs text-muted">
				Prefijo de código: <span class="font-mono text-accent">{draftPrefix}</span>
			</p>
		{/if}

		<div class="mt-5 flex gap-2">
			<button
				type="submit"
				class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
			>
				Crear cliente
			</button>
			<button
				type="button"
				onclick={() => (clientModalOpen = false)}
				class="rounded-md border border-border px-4 py-2 text-sm text-muted transition hover:text-text"
			>
				Cancelar
			</button>
		</div>
	</form>
</Modal>

<Modal title="Nueva finca" bind:open={farmModalOpen}>
	<form method="POST" action="?/createFarm" use:enhance={submitFarm}>
		<input type="hidden" name="name" value={farmDraft.name} />
		<input type="hidden" name="farmer" value={farmDraft.farmer} />
		<input type="hidden" name="municipality" value={farmDraft.municipality} />
		<input type="hidden" name="department" value={farmDraft.department} />

		<Form fields={farmFieldDefs} bind:row={farmDraft} errors={farmErrors} idPrefix="farm" />

		<div class="mt-5 flex gap-2">
			<button
				type="submit"
				class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
			>
				Crear finca
			</button>
			<button
				type="button"
				onclick={() => (farmModalOpen = false)}
				class="rounded-md border border-border px-4 py-2 text-sm text-muted transition hover:text-text"
			>
				Cancelar
			</button>
		</div>
	</form>
</Modal>
