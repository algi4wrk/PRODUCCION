<script lang="ts">
	/**
	 * Records an empaque.
	 *
	 * The fields are declared in `fields/empaque.ts`. What is written by hand is
	 * the **plan panel**: the order's referencias, with how much of each line has
	 * already been packed, sitting inside the form itself.
	 *
	 * That panel is the point of this screen. The plan was written before the
	 * coffee was roasted, and the person at the bagging table is the one who has
	 * to reconcile it with what the lot actually yielded — so what the client
	 * asked for has to be visible *while* they pack, not on another page they
	 * have to remember. Picking a line fills the presentation in from it; every
	 * field stays editable afterwards, because filling the plan exactly is the
	 * goal and not a constraint.
	 *
	 * The sheet reached for this with REFS / REFS USADAS and an ID_REF whose
	 * formula picked the first unspent reference. A guess is not much use when
	 * the answer is "whichever one this lot can still fill".
	 */
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';
	import Form from '$lib/components/form/Form.svelte';
	import AddButton from '$lib/components/order/AddButton.svelte';
	import StaffModal from './StaffModal.svelte';
	import {
		blankEmpaque,
		empaqueFields,
		packedKilos,
		selectedLot,
		type EmpaqueLotOption
	} from '$lib/fields/empaque';
	import { validateRow, type FieldOption, type FormRow } from '$lib/fields/types';
	import type { BagOption } from '$lib/fields/reference';
	import { formatKilos } from '$lib/domain/derived';
	import { announceOnSuccess } from '$lib/enhanceWithAnnounce';
	import type { ReferenceProgress } from '$lib/server/empaque';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		lots,
		bags,
		staff,
		references,
		/** The record being rewritten. Absent when recording a new one. */
		edit,
		open = $bindable(false)
	}: {
		lots: readonly EmpaqueLotOption[];
		bags: readonly BagOption[];
		staff: readonly FieldOption[];
		/** The packaging plan, with each line's progress. */
		references: readonly ReferenceProgress[];
		edit?: { id: number; row: FormRow };
		open?: boolean;
	} = $props();

	let draft = $state<FormRow>({});
	let errors = $state<Record<string, string>>({});
	let formError = $state('');
	/** The stacked "+ Nuevo responsable" sheet. */
	let staffOpen = $state(false);

	const fields = $derived(empaqueFields({ lots, bags, staff }));

	function start() {
		draft = blankEmpaque();
		errors = {};
		formError = '';
		open = true;
	}

	/** Roasted coffee the chosen lot is holding. */
	const available = $derived(selectedLot(lots, draft)?.availableKilos ?? 0);

	/** A bag's name, for the plan panel — it lists bags, not bag ids. */
	function bagName(bagId: number | null): string {
		if (bagId === null) return '—';
		return bags.find((bag) => bag.value === String(bagId))?.label ?? '—';
	}

	/**
	 * How many bags to propose for a planned line.
	 *
	 * The bags still owed on it, capped by what the lot can actually fill — but
	 * only once a lot has been chosen. Ports CANTIDAD's Initial value, which was
	 * the whole remaining weight divided by the presentation size; neither figure
	 * is binding, since the operator packs what came out.
	 */
	function proposedQuantity(reference: ReferenceProgress): number | null {
		const pending = Math.max(0, reference.pendingQuantity);
		if (!draft.lotId) return pending || null;

		const fits = Math.floor((available * 1000) / reference.grams);
		return Math.min(pending, fits) || null;
	}

	/** Takes the presentation from a planned line. */
	function choose(reference: ReferenceProgress) {
		// Clicking the selected line again clears it: coffee packed against no
		// planned line is still coffee packed.
		if (String(draft.referenceId) === String(reference.id)) {
			draft.referenceId = '';
			return;
		}

		draft.referenceId = String(reference.id);
		draft.grams = String(reference.grams);
		draft.grind = reference.grind;
		draft.bagId = reference.bagId === null ? '' : String(reference.bagId);
		draft.quantity = proposedQuantity(reference);
	}

	/**
	 * Choosing the line first and the lot second is just as natural as the other
	 * way round, so the proposal is recomputed when the lot arrives — otherwise
	 * it would have been capped against a lot that had not been picked yet.
	 *
	 * Keyed on the lot *changing*, like the trilla form: recomputing whenever the
	 * quantity happens to be empty would refill it under the operator's cursor.
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

		const reference = references.find((line) => String(line.id) === String(draft.referenceId));
		if (reference) draft.quantity = proposedQuantity(reference);
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
				formError = String(opts.result.data?.error ?? (edit ? 'No se pudo guardar el empaque.' : 'No se pudo registrar el empaque.'));
			}
		};
	};
</script>

<!-- In edit mode the caller owns the trigger: it is a button in the detail
     modal, not a "+ Nuevo" in a section header. -->
{#if !edit}
	<AddButton onclick={start} />
{/if}

<Modal title={edit ? 'Empaque — editar registro' : 'Empaque — nuevo registro'} bind:open size="wide">
	<form method="POST" action={edit ? '?/editEmpaque' : '?/empaque'} use:enhance={submit}>
		<input type="hidden" name="empaque" value={JSON.stringify(draft)} />
		{#if edit}<input type="hidden" name="id" value={edit.id} />{/if}

		<!--
			The plan, inside the form. Ordered as the client wrote it, with the
			lines still owed readable at a glance: pendiente is what the operator is
			working towards.
		-->
		<section class="mb-6 rounded-lg border border-border">
			<header class="flex items-center justify-between border-b border-border px-4 py-3">
				<h3 class="text-xs font-semibold tracking-wide text-text uppercase">
					Lo que pidió el cliente
				</h3>
				<span class="text-xs text-muted">Elija una línea para copiar la presentación</span>
			</header>

			{#if references.length === 0}
				<p class="px-4 py-6 text-center text-sm text-muted">
					Esta orden no tiene referencias de empaque.
				</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-border text-left text-xs text-muted uppercase">
								<th class="px-4 py-2 font-medium">Tamaño</th>
								<th class="px-4 py-2 font-medium">Molienda</th>
								<th class="px-4 py-2 font-medium">Variedad</th>
								<th class="px-4 py-2 font-medium">Bolsa</th>
								<th class="px-4 py-2 font-medium">Plan</th>
								<th class="px-4 py-2 font-medium">Empacado</th>
								<th class="px-4 py-2 font-medium">Pendiente</th>
							</tr>
						</thead>
						<tbody>
							{#each references as reference (reference.id)}
								{@const chosen = String(draft.referenceId) === String(reference.id)}
								<tr
									class="cursor-pointer border-b border-border/60 last:border-0 transition
										{chosen ? 'bg-accent-soft' : 'hover:bg-accent-soft/40'}"
									onclick={() => choose(reference)}
								>
									<td class="px-4 py-2 tabular-nums">{reference.grams} g</td>
									<td class="px-4 py-2">{reference.grind}</td>
									<td class="px-4 py-2">{reference.variety}</td>
									<td class="px-4 py-2 text-muted">{bagName(reference.bagId)}</td>
									<td class="px-4 py-2 tabular-nums">{reference.quantity}</td>
									<td class="px-4 py-2 tabular-nums">{reference.packedQuantity}</td>
									<!-- Zero pending is the line finished; below zero it was overpacked,
									     which is allowed and worth seeing. -->
									<td
										class="px-4 py-2 tabular-nums
											{reference.pendingQuantity <= 0 ? 'text-muted' : 'font-medium text-text'}"
									>
										{reference.pendingQuantity}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<Form
			{fields}
			bind:row={draft}
			{errors}
			idPrefix="empaque"
			onCreateRef={(name) => {
				if (name === 'staffId') staffOpen = true;
			}}
		/>

		{#if draft.lotId}
			<p class="mt-3 text-sm text-muted">
				El lote tiene {formatKilos(available)} kg tostados; este empaque toma
				{formatKilos(packedKilos(draft))} kg.
			</p>
		{/if}

		{#if formError}
			<p class="mt-3 text-sm text-red-600 dark:text-red-400">{formError}</p>
		{/if}

		<div class="mt-5 flex gap-2">
			<button
				type="submit"
				class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition
					hover:opacity-90"
			>
				{edit ? 'Guardar cambios' : 'Registrar empaque'}
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
