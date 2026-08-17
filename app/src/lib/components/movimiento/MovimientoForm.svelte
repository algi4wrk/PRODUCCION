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
		/** Icon alone, for the order header where seven controls share a row. */
		iconOnly = false,
		/** The movimiento being rewritten. Absent when registering a new one. */
		edit,
		open = $bindable(false)
	}: {
		lots: readonly LotOption[];
		staff: readonly FieldOption[];
		lotId?: number;
		orderId?: number;
		variant?: 'action' | 'section';
		iconOnly?: boolean;
		edit?: {
			id: number;
			action: string;
			destinationLotId: number;
			staffId: number;
			legs: { lotId: number; kilos: number }[];
		};
		open?: boolean;
	} = $props();

	/**
	 * One origin: which lot, how much of it, and — for a lot caught half way
	 * through a selección — which of its two portions.
	 */
	type Leg = {
		lotId: string;
		kilos: number | null;
		/** Which bucket of the lot, when it is holding more than one. */
		state?: 'VERDE' | 'TOSTADO' | 'EMPACADO';
		selected?: boolean;
	};

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
				(!chosenBucket ||
					lot.availableKilos === 0 ||
					(lot.portions ?? []).some(
						(portion) => `${portion.state}·${portion.selected}` === chosenBucket
					))
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
				? (validateLegWeight(leg.kilos, availableFor(leg)) ?? '')
				: ''
		)
	);

	/**
	 * The coffee already committed to, once a leg names one.
	 *
	 * A bucket, not a status. A status summarises a whole lot, so comparing them
	 * refuses things that are perfectly sound: 10 kg of roasted coffee out of a
	 * lot that reads EN PROCESO TOSTION is the same coffee as a lot reading
	 * TOSTADO, and combining the two is what a combo is for.
	 *
	 * Only while there is more than one origin — with one leg there is nothing to
	 * mix it with.
	 */
	/**
	 * The coffee committed to by the *other* rows.
	 *
	 * A row is never narrowed by its own answer: with nothing else filled in there
	 * is nothing to be consistent with, so every lot is offered — which is what
	 * makes changing your mind possible. The moment another row names a coffee,
	 * this one has to match it.
	 *
	 * `except` is the row asking. Omitting it asks the question for the movimiento
	 * as a whole, which is what the destination needs.
	 *
	 * A row with no lot names nothing, whatever it was told earlier: otherwise
	 * clearing the field would leave the list narrowed by a choice no longer on
	 * screen.
	 */
	function bucketFor(except?: number): string | undefined {
		return legs
			.map((leg, index) =>
				index !== except && leg.lotId && leg.state ? `${leg.state}·${leg.selected ?? false}` : ''
			)
			.find(Boolean);
	}

	const chosenBucket = $derived(bucketFor());

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
		const bucket = bucketFor(index);

		return lots.filter(
			(lot) =>
				!taken.includes(lot.value) &&
				(!bucket ||
					lot.value === own ||
					(lot.portions ?? []).some(
						(portion) => `${portion.state}·${portion.selected}` === bucket
					))
		);
	}

	/**
	 * A lot holding one thing needs no question, so the leg takes it as soon as
	 * the lot is picked. That is also what lets the list be narrowed by coffee
	 * rather than by status: every leg ends up naming its bucket.
	 */
	$effect(() => {
		if (!open) return;
		for (const leg of legs) {
			const portions = lotFor(leg.lotId)?.portions ?? [];

			// Clearing the lot clears what was chosen with it: the bucket and the
			// weight belong to that lot, not to the row.
			if (!leg.lotId) {
				if (leg.state !== undefined) {
					leg.state = undefined;
					leg.selected = undefined;
					leg.kilos = null;
				}
				continue;
			}

			// The lot changed under a bucket it does not have.
			if (leg.state && !portions.some((p) => p.state === leg.state && p.selected === leg.selected)) {
				leg.state = undefined;
				leg.selected = undefined;
				leg.kilos = null;
			}

			const movable = movableOf(leg.lotId);
			if (movable.length === 1 && leg.state === undefined) {
				leg.state = movable[0].state;
				leg.selected = movable[0].selected;
			}
		}
	});

	/** The lot behind a leg, if one is chosen. */
	function lotFor(lotId: string) {
		return lots.find((lot) => lot.value === lotId);
	}

	/**
	 * The parts of a lot a movimiento can actually take.
	 *
	 * Packed coffee is listed with the rest so the operator sees the whole lot,
	 * but it never moves — so every question the form asks about "which part"
	 * counts only these. A lot that is half bagged and half roasted has one
	 * movable part, and needs no question at all.
	 */
	function movableOf(lotId: string) {
		return (lotFor(lotId)?.portions ?? []).filter((portion) => portion.movable !== false);
	}

	/**
	 * What a leg may draw on: the whole lot, or the portion it names once the lot
	 * turns out to be half sorted. Sorting part of a lot and then separating the
	 * rest is ordinary; what is not ordinary is guessing which part.
	 */
	function availableFor(leg: Leg): number {
		const lot = lotFor(leg.lotId);
		if (!lot) return 0;
		if (!lot.portions?.length) return lot.availableKilos;

		const chosen = lot.portions.find(
			(portion) => portion.state === leg.state && portion.selected === leg.selected
		);
		return chosen?.kilos ?? 0;
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
		lastAction = '';
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
			// The record's own action, so opening an edit does not read as a change
			// and wipe the legs it just filled in.
			lastAction = edit.action;
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
	let lastAction = $state('');

	$effect(() => {
		if (!open) return;

		const action = String(draft.action ?? '');
		if (action === lastAction) return;
		lastAction = action;

		/*
		 * Changing the action starts the form again rather than carrying the old
		 * answers across. The three actions ask different questions — a combo of
		 * two lots is not a transfer with a spare row — so weights chosen against
		 * one of them are answers to a question no longer being asked, and a
		 * destination picked for a transfer means nothing to a split that creates
		 * its own.
		 */
		legs = action === 'COMBINAR LOTE'
			? [{ lotId: '', kilos: null }, { lotId: '', kilos: null }]
			: [{ lotId: lotId ? String(lotId) : '', kilos: null }];
		lastPicked = [];
		draft.destinationLotId = '';
		errors = {};
		legErrors = [];
		formError = '';
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
			// Only when the lot holds one thing: with two, the weight waits for the
			// operator to say which of them is moving.
			if (leg.lotId && movableOf(leg.lotId).length === 1) {
				leg.kilos = availableFor(leg);
			}
		});
	});

	/** Validates the legs, which the generic FieldDef validator cannot see. */
	function checkLegs(): boolean {
		legErrors = legs.map((leg) => {
			if (!leg.lotId) return 'Seleccione el lote.';
			if (movableOf(leg.lotId).length > 1 && leg.state === undefined) {
				return 'Indique qué parte del lote mueve.';
			}
			return validateLegWeight(leg.kilos ?? 0, availableFor(leg)) ?? '';
		});

		const countError = validateOriginCount(String(draft.action), legs.length);
		formError = countError ?? '';

		/*
		 * Different coffees in one movimiento. The server refuses it too — that is
		 * the rule — but by then the operator has pressed a button and watched
		 * nothing happen; the picker narrows the list for the same reason.
		 */
		const kinds = new Set(
			legs.filter((leg) => leg.lotId && leg.state).map((leg) => `${leg.state}·${leg.selected}`)
		);
		if (kinds.size > 1) {
			formError = 'No se puede mezclar café de distinta clase: elija la misma parte en todos los lotes.';
		}

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
			// A refusal has to be visible: a form that closes on nothing, or sits
			// there doing nothing, reads as the button being broken.
			if (opts.result.type === 'failure') {
				formError = String(opts.result.data?.error ?? 'No se pudo registrar el movimiento.');
			}
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
		title="Movimiento"
		class="{iconOnly
			? 'hint rounded-md p-1.5'
			: 'flex items-center gap-1.5 rounded-md px-2 py-1 text-sm'} text-muted transition
			hover:bg-violet-50 hover:text-violet-600 dark:hover:bg-violet-950/50"
	>
		<Icon name="split" size={iconOnly ? 18 : 14} />
		{#if iconOnly}
			<span class="sr-only">Movimiento</span>
		{:else}
			Movimiento
		{/if}
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

							<!--
								A lot half way through a selección holds the same coffee twice
								over: the part already sorted and the part still waiting. Both
								are almendra, so nothing but the operator can say which one is
								moving — and the new lot then reads AV or AV SELECCIONADO
								rather than inheriting "en proceso" from a parent it only took
								half of.
							-->
							{#if (lotFor(leg.lotId)?.portions ?? []).length > 1}
								<!--
									A lot holding two kinds of coffee at once — half roasted, or
									half sorted — cannot answer "move 5 kg" on its own. It offers
									what it has and the operator picks; the new lot then reads by
									the coffee it received instead of inheriting "en proceso"
									from a parent it only took part of.
								-->
								<div class="mt-2 flex flex-wrap gap-2">
									{#each lotFor(leg.lotId)!.portions! as portion (portion.label)}
										{#if portion.movable === false}
											<!--
												Shown, not offered. Packed coffee is still the lot's
												weight and belongs in this list — half a lot in bags is
												exactly what someone deciding about the other half needs
												to see — but it cannot move: it is bagged against a line
												of the packaging plan, and the way back is to undo the
												empaque.
											-->
											<span
												title="El café empacado no se mueve: deshaga primero el empaque."
												class="cursor-not-allowed rounded-md border border-dashed border-border
													px-2 py-1 text-xs text-muted/70"
											>
												{portion.label}
												<span class="ml-1 tabular-nums opacity-70">
													{formatKilos(portion.kilos)} kg
												</span>
											</span>
										{:else}
											<button
												type="button"
												onclick={() => {
													leg.state = portion.state;
													leg.selected = portion.selected;
													leg.kilos = null;
												}}
												aria-pressed={leg.state === portion.state &&
													leg.selected === portion.selected}
												class="rounded-md border px-2 py-1 text-xs transition
													{leg.state === portion.state && leg.selected === portion.selected
													? 'border-accent bg-accent-soft font-medium text-accent'
													: 'border-border text-muted hover:border-accent/40'}"
											>
												{portion.label}
												<span class="ml-1 tabular-nums opacity-70">
													{formatKilos(portion.kilos)} kg
												</span>
											</button>
										{/if}
									{/each}
								</div>
							{/if}
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
									disponible {formatKilos(availableFor(leg))} kg
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
