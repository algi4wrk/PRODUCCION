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
	import { STEP_TONES } from '$lib/stepTones';

	let { data } = $props();

	const lot = $derived(data.lot);

	/** Guards the delete: nothing is posted until the dialog is confirmed. */
	let confirmingDelete = $state(false);
</script>

<div class="mb-6 flex flex-wrap items-center gap-3">
	<!-- Back to the order, not to the board: a lot is read inside its order. -->
	<a
		href="/ordenes/{lot.order.code}"
		class="text-sm text-muted transition hover:text-accent"
	>
		← {lot.order.code}
	</a>
	<!-- No status badge: the label already ends in the lot's state, and the mark
	     before it says the same thing at a glance. -->
	<h1 class="flex items-center gap-2 text-xl font-semibold text-text">
		<LotMark status={lot.status} size={20} />
		{lot.label}
	</h1>

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

	<!-- What this lot needs next, in the board's colours so the two agree. -->
	<span
		class="rounded px-2 py-0.5 text-xs font-semibold {STEP_TONES[lot.stepTone]}"
	>
		{lot.step}
	</span>
</div>

<div class="flex flex-col gap-6">
	<Section title="Resumen">
		<LotSummary details={data.details} spec={data.spec} balances={data.balances} />
	</Section>

	<!-- One section per process this lot's specification calls for. -->
	{#if data.sections.trilla}
		<TrillaSection events={data.trillas} />
	{/if}
	{#if data.sections.seleccionVerde}
		<SeleccionSection title="Selección — Almendra verde" events={data.greenSelecciones} />
	{/if}
	{#if data.sections.tostion}
		<TostionSection events={data.tostiones} />
	{/if}
	{#if data.sections.seleccionTostado}
		<SeleccionSection title="Selección — Tostado" events={data.roastedSelecciones} />
	{/if}
	{#if data.sections.empaque}
		<EmpaqueSection events={data.empaques} />
	{/if}

	<!--
		Lineage lands with movimientos: a lot's parents and children are the one
		part of its history that is not a process event. The same movimientos
		twice — as a shape, then as rows.
	-->
	<LineageSection graph={data.graph} currentLotId={lot.id} />

	<Section title="Movimientos de lotes" count={data.movements.length}>
		<MovimientoList movements={data.movements} lots={data.lotOptions} staff={data.staffOptions} />
	</Section>
</div>
