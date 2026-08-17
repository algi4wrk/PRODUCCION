<script lang="ts">
	/**
	 * Lot detail — the order page, narrowed to one lot.
	 *
	 * Same skeleton on purpose: a header row that identifies the record, a
	 * Resumen card, then one collapsible section per process. What changes is the
	 * scope: the sections here are decided by this lot's specification rather
	 * than by every lot in the order, and they will hold this lot's events.
	 *
	 * `REGISTRO` does not exist yet, so each section renders its empty state —
	 * the same place the order page is in.
	 */
	import Section from '$lib/components/Section.svelte';
	import LotMark from '$lib/components/LotMark.svelte';
	import LotEdit from '$lib/components/lot/LotEdit.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import { enhance } from '$app/forms';
	import { announceChange } from '$lib/realtime';
	import LotSummary from '$lib/components/lot/LotSummary.svelte';
	import TrillaSection from '$lib/components/proceso/TrillaSection.svelte';
	import SeleccionSection from '$lib/components/proceso/SeleccionSection.svelte';
	import TostionSection from '$lib/components/proceso/TostionSection.svelte';
	import EmpaqueSection from '$lib/components/proceso/EmpaqueSection.svelte';
	import MovimientoForm from '$lib/components/movimiento/MovimientoForm.svelte';
	import MovimientoList from '$lib/components/movimiento/MovimientoList.svelte';
	import LineageSection from '$lib/components/movimiento/LineageSection.svelte';
	import TrillaForm from '$lib/components/proceso/TrillaForm.svelte';
	import SeleccionForm from '$lib/components/proceso/SeleccionForm.svelte';
	import TostionForm from '$lib/components/proceso/TostionForm.svelte';
	import EmpaqueForm from '$lib/components/proceso/EmpaqueForm.svelte';
	import { formForStep } from '$lib/domain/nextStepForm';
	import { STEP_TONES } from '$lib/stepTones';

	let { data } = $props();

	const lot = $derived(data.lot);

	/** Guards the delete: nothing is posted until the dialog is confirmed. */
	let confirmingDelete = $state(false);

	/**
	 * The step badge is the button that does the step, exactly as it is on the
	 * order page — pressed instead of read and then looked for below. There is no
	 * lot to choose here: this page is about one, so the form opens on it.
	 *
	 * Steps that are not work — GUARDAR, COMBINADO, EN GRANEL — map to nothing
	 * and stay a plain chip.
	 */
	const stepKind = $derived(formForStep(lot.step));
	/**
	 * Mounted only while it is open, the same as on the order page: these forms
	 * carry their own "+ Nuevo" trigger for the section headers, and one sitting
	 * under the page heading would be a second way to do the same thing.
	 */
	let stepMounted = $state(false);
	let stepOpen = $state(false);

	$effect(() => {
		if (!stepOpen) stepMounted = false;
	});

	function openStep() {
		stepMounted = true;
		stepOpen = true;
	}
</script>

<div class="mb-6 flex flex-wrap items-center gap-3">
	<!--
		The breadcrumb says both things at once: this is a lot, and it belongs to
		that order. Back to the order rather than to the board, because a lot is
		read inside its order.
	-->
	<!--
		Whose coffee this is, and which order it came on — then the word LOTE, so
		the page says what kind of page it is before the name of the lot is read.
		The order code is the way back.
	-->
	<div>
		<p class="text-xs tracking-widest text-muted uppercase">
			<a href="/ordenes/{lot.order.code}" class="transition hover:text-accent">
				{lot.order.clientName} <span class="font-mono">({lot.order.code})</span>
			</a>
			<span class="mx-1">›</span>
			Lote
		</p>

		<!-- No status badge: the label already ends in the lot's state, and the
		     mark before it says the same thing at a glance. -->
		<h1 class="mt-0.5 flex items-center gap-2 text-xl font-semibold text-text">
			<LotMark status={lot.status} size={20} />
			{lot.label}
		</h1>
	</div>

	<!--
		The same actions row the order page has, in the same place: what acts on
		the whole record sits beside the name of the record.
	-->
	<div class="ml-auto flex items-center gap-1">
		<MovimientoForm
			lots={data.lotOptions}
			staff={data.staffOptions}
			lotId={lot.id}
			orderId={lot.order.id}
		/>

		<LotEdit lot={data.lotDraft} farms={data.farms} varieties={data.varieties} />

		<form method="POST" action="?/deleteLot" use:enhance={() => announceChange()}>
			<button
				type="button"
				onclick={() => (confirmingDelete = true)}
				class="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted transition
					hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50"
			>
				<Icon name="trash" />
				Eliminar
			</button>

			<!-- Named by its label rather than its ID_LOTE: a lot is read as
			     "B - Castillo - AV" everywhere else in the app. -->
			<ConfirmDialog
				bind:open={confirmingDelete}
				title="Eliminar lote"
				subject="el lote {lot.label}"
			/>
		</form>
	</div>

	<!-- What this lot needs next, in the board's colours so the two agree — and
	     the way to do it, when it is something that can be done. -->
	{#if stepKind}
		<button
			type="button"
			onclick={openStep}
			class="rounded px-2 py-0.5 text-xs font-semibold transition hover:opacity-80
				{STEP_TONES[lot.stepTone]}"
		>
			{lot.step}
		</button>
	{:else}
		<span class="rounded px-2 py-0.5 text-xs font-semibold {STEP_TONES[lot.stepTone]}">
			{lot.step}
		</span>
	{/if}
</div>

<!--
	The form the step badge opens: the same one its section below uses, with this
	lot already chosen. Only the one the step calls for is mounted, so the page
	does not carry five idle modals.
-->
{#if stepMounted}
	{#if stepKind === 'trilla'}
		<TrillaForm
			lots={data.trillaLots}
			staff={data.staffOptions}
			lotId={lot.id}
			trigger={false}
			bind:open={stepOpen}
		/>
	{:else if stepKind === 'seleccionVerde'}
		<SeleccionForm
			lots={data.greenSeleccionLots}
			staff={data.staffOptions}
			stage="VERDE"
			title="Selección — Almendra verde"
			lotId={lot.id}
			trigger={false}
			bind:open={stepOpen}
		/>
	{:else if stepKind === 'seleccionTostado'}
		<SeleccionForm
			lots={data.roastedSeleccionLots}
			staff={data.staffOptions}
			stage="TOSTADO"
			title="Selección — Tostado"
			lotId={lot.id}
			trigger={false}
			bind:open={stepOpen}
		/>
	{:else if stepKind === 'tostion'}
		<TostionForm
			lots={data.tostionLots}
			staff={data.staffOptions}
			lotId={lot.id}
			trigger={false}
			bind:open={stepOpen}
		/>
	{:else if stepKind === 'empaque'}
		<EmpaqueForm
			lots={data.empaqueLots}
			bags={data.bags}
			staff={data.staffOptions}
			references={data.referenceProgress}
			lotId={lot.id}
			trigger={false}
			bind:open={stepOpen}
		/>
	{/if}
{/if}

<div class="flex flex-col gap-6">
	<Section title="Resumen">
		<LotSummary details={data.details} spec={data.spec} balances={data.balances} />
	</Section>

	<!-- One section per process this lot's specification calls for. -->
	{#if data.sections.trilla}
		<TrillaSection
			events={data.trillas}
			lots={data.trillaLots}
			staff={data.staffOptions}
			lotId={lot.id}
		/>
	{/if}
	{#if data.sections.seleccionVerde}
		<SeleccionSection
			title="Selección — Almendra verde"
			stage="VERDE"
			events={data.greenSelecciones}
			lots={data.greenSeleccionLots}
			staff={data.staffOptions}
			lotId={lot.id}
		/>
	{/if}
	{#if data.sections.tostion}
		<TostionSection
			events={data.tostiones}
			lots={data.tostionLots}
			staff={data.staffOptions}
			lotId={lot.id}
		/>
	{/if}
	{#if data.sections.seleccionTostado}
		<SeleccionSection
			title="Selección — Tostado"
			stage="TOSTADO"
			events={data.roastedSelecciones}
			lots={data.roastedSeleccionLots}
			staff={data.staffOptions}
			lotId={lot.id}
		/>
	{/if}
	{#if data.sections.empaque}
		<EmpaqueSection
			events={data.empaques}
			lots={data.empaqueLots}
			bags={data.bags}
			staff={data.staffOptions}
			references={data.referenceProgress}
			lotId={lot.id}
		/>
	{/if}

	<!--
		Lineage lands with movimientos: a lot's parents and children are the one
		part of its history that is not a process event. The same movimientos
		twice — as a shape, then as rows.
	-->
	<LineageSection graph={data.graph} currentLotId={lot.id} />

	<Section title="Movimientos de lotes" count={data.movements.length}>
		{#snippet action()}
			<!-- Opens on this lot, like the process forms above it. -->
			<MovimientoForm
				lots={data.lotOptions}
				staff={data.staffOptions}
				lotId={lot.id}
				orderId={lot.order.id}
				variant="section"
			/>
		{/snippet}

		<MovimientoList movements={data.movements} lots={data.lotOptions} staff={data.staffOptions} />
	</Section>
</div>
