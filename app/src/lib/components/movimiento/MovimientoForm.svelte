<script lang="ts">
	/**
	 * Registers a movimiento: coffee crossing between lots.
	 *
	 * The header is declared in `fields/movimiento.ts` and rendered by the generic
	 * `Form`. What is written by hand is the list of **origin legs** — a lot and a
	 * weight, repeated as many times as needed. That list is the reason this form
	 * could not exist in the source app: a combo of three partial lots needs three
	 * rows, and AppSheet had no way to express "one or more".
	 *
	 * Each weight is capped at what that lot is actually holding. The ledger
	 * refuses a negative balance regardless, but a form that lets you type an
	 * impossible number and only complains on save is worse than one that does
	 * not.
	 */
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';
	import Form from '$lib/components/form/Form.svelte';
	import Dropdown from '$lib/components/form/Dropdown.svelte';
	import NumberField from '$lib/components/form/NumberField.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import AddButton from '$lib/components/order/AddButton.svelte';
	import StaffModal from '$lib/components/proceso/StaffModal.svelte';
	import { movementFields, createsLot, type LotOption } from '$lib/fields/movimiento';
	import { validateRow, type FieldOption, type FormRow } from '$lib/fields/types';
	import { validateLegWeight, validateOriginCount } from '$lib/domain/validation';
	import { formatKilos } from '$lib/domain/derived';
	import { announceOnSuccess } from '$lib/enhanceWithAnnounce';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		lots,
		staff,
		/** Preselected origin, when opened from a lot's own page. */
		lotId,
		/** Needed only from the lot page, where the route names a lot, not an order. */
		orderId,
		/**
		 * Where the trigger sits. `action` is the bare row beside Editar and
		 * Eliminar; `section` is the "+ Nuevo" button in a section header.
		 */
		variant = 'action',
		/** The movimiento being rewritten. Absent when registering a new one. */
		edit,
		open = $bindable(false)
	}: {
		lots: readonly LotOption[];
		staff: readonly FieldOption[];
		lotId?: number;
		orderId?: number;
		variant?: 'action' | 'section';
		edit?: {
			id: number;
			action: string;
			destinationLotId: number;
			staffId: number;
			legs: { lotId: number; kilos: number }[];
		};
		open?: boolean;
	} = $props();

	/** One origin: which lot, and how much of it. */
	type Leg = { lotId: string; kilos: number | null };

	let draft = $state<FormRow>({});
	let legs = $state<Leg[]>([]);
	let errors = $state<Record<string, string>>({});
	let legErrors = $state<string[]>([]);
	let formError = $state('');
	/** The stacked "+ Nuevo responsable" sheet. */
	let staffOpen = $state(false);

	const fields = $derived(movementFields({ lots, staff }));

	/**
	 * The form reads in the order the movimiento happens: what is being done,
	 * from which lots, to where, by whom. So the action is rendered above the
	 * origin list and everything else below it.
	 */
	const leading = $derived(fields.filter((field) => field.name === 'action'));
	// Destino is drawn by hand inside the origins box, on the same grid as a leg,
	// so the two line up; only the responsable is left for the generic renderer.
	const trailing = $derived(fields.filter((field) => field.name === 'staffId'));

	/**
	 * A lot may not be its own destination, and may not receive coffee unlike
	 * what it already holds. An empty lot takes anything.
	 */
	const destinationOptions = $derived(
		lots.filter(
			(lot) =>
				!legs.some((leg) => leg.lotId === lot.value) &&
				(!chosenStatus || lot.availableKilos === 0 || lot.status === chosenStatus)
		)
	);

	/**
	 * Overdrawn legs complain as they are typed, not on save.
	 *
	 * Only this rule is live: "how much is there" is a fact the form already
	 * knows, so waiting until submit to mention it wastes the operator's time. An
	 * empty weight is not an error until they try to save.
	 */
	const liveErrors = $derived(
		legs.map((leg) =>
			leg.lotId && leg.kilos !== null && leg.kilos > 0
				? (validateLegWeight(leg.kilos, availableFor(leg.lotId)) ?? '')
				: ''
		)
	);

	/** The status every other chosen lot shares, once one has been picked. */
	const chosenStatus = $derived(
		lots.find((lot) => lot.value === legs.find((leg) => leg.lotId)?.lotId)?.status
	);

	/**
	 * Origins already chosen cannot be chosen twice, and every origin must hold
	 * the same kind of coffee: pergamino does not combine with almendra, and
	 * neither combines with roasted.
	 *
	 * Filtering the list rather than rejecting the pick — the same posture the
	 * bolsa field takes, where only bags of the matching size are offered.
	 */
	function optionsFor(index: number) {
		const taken = legs.filter((_, i) => i !== index).map((leg) => leg.lotId);
		const own = legs[index]?.lotId;
		return lots.filter(
			(lot) =>
				!taken.includes(lot.value) &&
				(!chosenStatus || lot.status === chosenStatus || lot.value === own)
		);
	}

	function availableFor(lotId: string): number {
		return lots.find((lot) => lot.value === lotId)?.availableKilos ?? 0;
	}

	const total = $derived(legs.reduce((sum, leg) => sum + (leg.kilos ?? 0), 0));

	/** What the destination is already holding, when it is an existing lot. */
	const destinationKilos = $derived(
		createsLot(draft.action)
			? 0
			: (lots.find((lot) => lot.value === draft.destinationLotId)?.availableKilos ?? 0)
	);

	function start() {
		// Transferir is the default: the least assuming of the three — one origin,
		// no new lot — so opening on it never presumes more than has been said.
		draft = { action: 'TRANSFERIR PESO', destinationLotId: '', staffId: '' };
		legs = [{ lotId: lotId ? String(lotId) : '', kilos: null }];
		lastPicked = [];
		errors = {};
		legErrors = [];
		formError = '';
		open = true;
	}

	/**
	 * Opening in edit mode fills the form from the movimiento.
	 *
	 * `lastPicked` is filled with it so the effect that proposes whole-lot weights
	 * for a combo does not overwrite the partial amounts actually moved.
	 */
	let wasOpen = $state(false);
	$effect(() => {
		if (open && !wasOpen && edit) {
			draft = {
				action: edit.action,
				destinationLotId: String(edit.destinationLotId),
				staffId: String(edit.staffId)
			};
			legs = edit.legs.map((leg) => ({ lotId: String(leg.lotId), kilos: leg.kilos }));
			lastPicked = legs.map((leg) => leg.lotId);
			errors = {};
			legErrors = [];
			formError = '';
		}
		wasOpen = open;
	});

	function addLeg() {
		legs = [...legs, { lotId: '', kilos: null }];
	}

	function removeLeg(index: number) {
		legs = legs.filter((_, i) => i !== index);
	}

	/** Whether this action may draw on more than one origin. */
	const manyOrigins = $derived(draft.action !== 'SEPARAR LOTE');

	/**
	 * The rows follow the action rather than reporting on it: a combo opens with
	 * two, because one lot combined with nothing is not a combination, and
	 * separating collapses back to the single parent a split has by definition.
	 * A transfer may pour from several lots but does not assume it will.
	 */
	$effect(() => {
		if (!open) return;
		if (draft.action === 'COMBINAR LOTE') {
			if (legs.length < 2) legs = [...legs, { lotId: '', kilos: null }];
		} else if (!manyOrigins && legs.length > 1) {
			legs = [legs[0]];
		}
	});

	/**
	 * Combining usually takes whole lots, so picking one fills in everything it
	 * holds; a partial combo is then a matter of editing the number down.
	 *
	 * Keyed on the *lot changing*, not on the weight being empty — otherwise
	 * clearing the field to retype it would refill it under the operator's
	 * cursor. Separar and transferir stay blank, since those are partial by
	 * nature.
	 */
	let lastPicked = $state<string[]>([]);

	$effect(() => {
		if (!open || draft.action !== 'COMBINAR LOTE') return;

		legs.forEach((leg, index) => {
			if (leg.lotId === untrack(() => lastPicked[index])) return;
			lastPicked[index] = leg.lotId;
			if (leg.lotId) leg.kilos = availableFor(leg.lotId);
		});
	});

	/** Validates the legs, which the generic FieldDef validator cannot see. */
	function checkLegs(): boolean {
		legErrors = legs.map((leg) => {
			if (!leg.lotId) return 'Seleccione el lote.';
			return validateLegWeight(leg.kilos ?? 0, availableFor(leg.lotId)) ?? '';
		});

		const countError = validateOriginCount(String(draft.action), legs.length);
		formError = countError ?? '';

		// A destination that is also an origin would post +x and −x on one lot.
		if (!createsLot(draft.action) && legs.some((leg) => leg.lotId === draft.destinationLotId)) {
			formError = 'El lote destino no puede ser también el origen.';
		}

		return legErrors.every((error) => !error) && !formError;
	}

	const submit: SubmitFunction = (input) => {
		errors = validateRow(fields, draft);
		const legsOk = checkLegs();
		if (Object.keys(errors).length > 0 || !legsOk) {
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
     modal, not one of these. -->
{#if edit}
	<!-- no trigger -->
{:else if variant === 'section'}
	<AddButton onclick={start} />
{:else}
	<button
		type="button"
		onclick={start}
		class="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted transition
			hover:bg-accent-soft hover:text-accent"
	>
		<Icon name="split" />
		Movimiento
	</button>
{/if}

<Modal title={edit ? 'Editar movimiento' : 'Registrar movimiento'} bind:open size="wide">
	<form method="POST" action={edit ? '?/editMovimiento' : '?/movimiento'} use:enhance={submit}>
		{#if edit}<input type="hidden" name="id" value={edit.id} />{/if}
		<input type="hidden" name="action" value={draft.action} />
		<input type="hidden" name="destinationLotId" value={draft.destinationLotId} />
		<input type="hidden" name="staffId" value={draft.staffId} />
		{#if orderId}<input type="hidden" name="orderId" value={orderId} />{/if}
		<!-- The legs travel as JSON: a repeating group has no form-encoded shape. -->
		<input type="hidden" name="legs" value={JSON.stringify(legs)} />

		<Form fields={leading} bind:row={draft} {errors} idPrefix="mov" />

		<section class="mt-5 rounded-lg border border-border">
			<header class="flex items-center justify-between border-b border-border px-4 py-3">
				<h3 class="text-sm font-semibold tracking-wide text-text uppercase">
					Origen y destino
				</h3>
				{#if manyOrigins}
					<button
						type="button"
						onclick={addLeg}
						class="rounded-md border border-accent/40 bg-accent-soft px-3 py-1.5 text-sm
							font-medium text-accent transition hover:border-accent"
					>
						+ Agregar lote
					</button>
				{/if}
			</header>

			<div class="flex flex-col gap-3 px-4 py-4">
				{#each legs as leg, index (index)}
					<div class="flex items-start gap-3">
						<div class="min-w-0 flex-1">
							<!-- Clearable: choosing a lot narrows what the other rows may
							     pick, so getting out of a wrong choice has to be easy. -->
							<Dropdown
								id="mov-leg-{index}"
								bind:value={leg.lotId}
								options={optionsFor(index)}
								error={legErrors[index]}
								clearable
								placeholder="Lote origen"
							/>
						</div>

						<div class="w-32">
							<NumberField
								id="mov-kilos-{index}"
								bind:value={leg.kilos}
								step={0.01}
								unit="kg"
								error={liveErrors[index] || legErrors[index] || undefined}
							/>

							<!--
								The message, which NumberField does not draw itself — in the
								generic form FieldShell does that, and this row is hand-built.
								Otherwise an overdrawn weight would only turn the border red.
							-->
							{#if liveErrors[index] || legErrors[index]}
								<p class="mt-1 text-xs text-red-600 dark:text-red-400">
									{liveErrors[index] || legErrors[index]}
								</p>
							{:else if leg.lotId}
								<p class="mt-1 text-xs text-muted">
									disponible {formatKilos(availableFor(leg.lotId))} kg
								</p>
							{/if}
						</div>

						<!-- A combo needs two; the others need one. Below that there is
						     nothing to remove. -->
						<button
							type="button"
							onclick={() => removeLeg(index)}
							disabled={legs.length <= (draft.action === 'COMBINAR LOTE' ? 2 : 1)}
							class="mt-2 flex w-6 justify-center rounded p-1 text-muted transition
								hover:text-red-600 disabled:opacity-30 disabled:hover:text-muted"
							aria-label="Quitar lote"
						>
							<Icon name="trash" />
						</button>
					</div>
				{/each}

				<!--
					Destino on the same three-column grid as a leg: lot, weight, and the
					gap where a leg's remove button sits. Lining them up is what makes
					the box read as "these lots, that lot" rather than two lists.
				-->
				<div class="flex items-start gap-3 border-t border-border pt-3">
					<div class="min-w-0 flex-1">
						{#if createsLot(draft.action)}
							<p
								class="rounded-md border border-dashed border-border px-3 py-2 text-sm
									text-muted"
							>
								Se creará un lote nuevo
							</p>
						{:else}
							<Dropdown
								id="mov-destinationLotId"
								bind:value={draft.destinationLotId as string}
								options={destinationOptions}
								error={errors.destinationLotId}
								clearable
								placeholder="Lote destino"
							/>
						{/if}
					</div>

					<!--
						A transfer pours into a lot that already holds something, so the
						weight column shows what is there now and the sum below says what
						it will hold afterwards. A new lot has nothing to add to, so it
						just shows what arrives.
					-->
					<div class="w-32 py-2 text-sm">
						<strong class="text-text tabular-nums">
							{formatKilos(createsLot(draft.action) ? total : destinationKilos)} kg
						</strong>
						{#if !createsLot(draft.action) && draft.destinationLotId}
							<p class="mt-1 text-xs text-muted">actual</p>
						{/if}
					</div>

					<!-- Matches the width of a leg's remove button, so the columns align. -->
					<div class="w-6" aria-hidden="true"></div>
				</div>

				{#if !createsLot(draft.action) && draft.destinationLotId}
					<div class="flex items-start gap-3 border-t border-border pt-3 text-sm">
						<div class="min-w-0 flex-1 text-right text-muted">
							{formatKilos(destinationKilos)} + {formatKilos(total)} =
						</div>
						<div class="w-32">
							<strong class="text-text tabular-nums">
								{formatKilos(destinationKilos + total)} kg
							</strong>
						</div>
						<div class="w-6" aria-hidden="true"></div>
					</div>
				{/if}
			</div>
		</section>

		<div class="mt-5">
			<Form
				fields={trailing}
				bind:row={draft}
				{errors}
				idPrefix="mov"
				onCreateRef={(name) => {
					if (name === 'staffId') staffOpen = true;
				}}
			/>
		</div>

		{#if formError}
			<p class="mt-3 text-sm text-red-600 dark:text-red-400">{formError}</p>
		{/if}

		<div class="mt-5 flex gap-2">
			<button
				type="submit"
				class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition
					hover:opacity-90"
			>
				{edit ? 'Guardar cambios' : 'Registrar'}
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

<StaffModal bind:open={staffOpen} onCreated={(id) => (draft.staffId = String(id))} />
