<script lang="ts">
	/**
	 * Order detail — the page the operator works from.
	 *
	 * Everything about an order is nested here: its lots, its packaging plan and
	 * its process history. There are no standalone views for process steps.
	 */
	import { goto } from '$app/navigation';
	import Badge from '$lib/components/Badge.svelte';
	import LotMark from '$lib/components/LotMark.svelte';
	import Section from '$lib/components/Section.svelte';
	import Table from '$lib/components/Table.svelte';
	import OrderSummary from '$lib/components/order/OrderSummary.svelte';
	import OrderStatus from '$lib/components/order/OrderStatus.svelte';
	import OrderEdit from '$lib/components/order/OrderEdit.svelte';
	import OrderExport from '$lib/components/order/OrderExport.svelte';
	import LotAdd from '$lib/components/order/LotAdd.svelte';
	import ReferenceAdd from '$lib/components/order/ReferenceAdd.svelte';
	import RecordModal from '$lib/components/RecordModal.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { enhance } from '$app/forms';
	import { announceOnSuccess } from '$lib/enhanceWithAnnounce';
	import MovimientoForm from '$lib/components/movimiento/MovimientoForm.svelte';
	import MovimientoList from '$lib/components/movimiento/MovimientoList.svelte';
	import LineageSection from '$lib/components/movimiento/LineageSection.svelte';
	import TrillaSection from '$lib/components/proceso/TrillaSection.svelte';
	import SeleccionSection from '$lib/components/proceso/SeleccionSection.svelte';
	import TostionSection from '$lib/components/proceso/TostionSection.svelte';
	import EmpaqueSection from '$lib/components/proceso/EmpaqueSection.svelte';
	import { statusTone } from '$lib/domain/status';
	import {
		formatKilos,
		plannedKilos,
		receivedKilos,
		referenceKilos
	} from '$lib/domain/derived';
	import { estimatedOrderKilos, remainingKilos } from '$lib/domain/estimates';
	import { column } from '$lib/domain/lotRow';

	let { data } = $props();

	const order = $derived(data.order);
	const received = $derived(receivedKilos(order.lots));
	const planned = $derived(plannedKilos(order.references));
	// What the lots will actually yield roasted — the figure the packaging plan
	// has to fit inside, not the raw weight received.
	const estimated = $derived(estimatedOrderKilos(order.lots));
	// What a new reference may still claim, so adding one later cannot promise
	// coffee the order does not have.
	const available = $derived(remainingKilos(estimated, planned));

	/**
	 * A narrower cut than the floor board's — the board has a monitor to fill,
	 * this sits in a page beside everything else. Beneficio and humedad are left
	 * out: they are reception facts that never change, and the lot's own page
	 * lists them under Detalles. Values come from the same projection either way,
	 * so the two never disagree about a weight.
	 *
	 * Scrolls sideways inside its card when the window is narrow.
	 */
	const LOT_COLUMNS = column([
		'lote',
		'rawMaterial',
		'greenKilos',
		'roastedKilos',
		'initialWeight',
		'roastType',
		'selection'
	]);

	const REFERENCE_COLUMNS = [
		{ key: 'grams', label: 'Tamaño' },
		{ key: 'quantity', label: 'Cantidad', numeric: true },
		{ key: 'grind', label: 'Molienda' },
		{ key: 'variety', label: 'Variedad' },
		{ key: 'kilos', label: 'Peso', unit: 'kg', numeric: true }
	];

	const referenceRows = $derived(
		order.references.map((reference) => ({
			grams: reference.grams === 1 ? 'Granel' : `${reference.grams} g`,
			quantity: String(reference.quantity),
			grind: reference.grind,
			variety: reference.variety,
			kilos: formatKilos(referenceKilos(reference))
		}))
	);

	// ── Referencias: detail, edit and delete ─────────────────────────────────
	// A reference is an estimate, not a record of anything that happened, so it
	// is ordinary CRUD: corrected in place and audited, deleted softly.

	/** The reference whose detail is open, if any. */
	let referenceDetail = $state<number | null>(null);
	let editingReference = $state(false);
	let deletingReference = $state(false);

	const shownReference = $derived(
		referenceDetail === null ? null : order.references[referenceDetail]
	);

	const referenceFacts = $derived(
		shownReference
			? [
					{ label: 'Referencia', value: shownReference.code, mono: true },
					{
						label: 'Tamaño',
						value: shownReference.grams === 1 ? 'Granel' : `${shownReference.grams} g`
					},
					{ label: 'Cantidad', value: String(shownReference.quantity) },
					{ label: 'Molienda', value: shownReference.grind },
					{ label: 'Variedad', value: shownReference.variety },
					{
						label: 'Bolsa',
						value:
							data.bags.find((bag) => bag.value === String(shownReference.bagId))?.label ?? '—'
					},
					{ label: 'Peso', value: `${formatKilos(referenceKilos(shownReference))} kg` }
				]
			: []
	);
</script>

<div class="mb-6 flex flex-wrap items-center gap-3">
	<a href="/ordenes" class="text-sm text-muted transition hover:text-accent">← Órdenes</a>
	<h1 class="font-mono text-xl font-semibold text-text">{order.code}</h1>
	<Badge text={order.status} tone={statusTone(order.status)} />
	{#if order.priority}
		<Badge text="PRIORIDAD" tone="priority" />
	{/if}

	<!-- The actions fill the empty right of this row: they act on the order as a
	     whole, which is exactly what this row identifies. -->
	<div class="ml-auto">
		<OrderStatus status={order.status} priority={order.priority} code={order.code}>
			{#snippet edit()}
				<MovimientoForm lots={data.lotOptions} staff={data.staffOptions} />
				<OrderEdit {order} clients={data.clients} brands={data.brands} />
				<OrderExport code={order.code} />
			{/snippet}
		</OrderStatus>
	</div>
</div>

<div class="flex flex-col gap-6">
	<Section title="Resumen">
		<OrderSummary {order} {received} {estimated} {planned} merma={data.merma} />
	</Section>

	<Section title="Materia prima" count={order.lots.length}>
		{#snippet action()}
			<LotAdd farms={data.farms} varieties={data.varieties} />
		{/snippet}

		<!-- A row opens that lot's own page, where its history lives. -->
		<Table
			columns={LOT_COLUMNS}
			rows={data.lotRows}
			empty="Esta orden todavía no tiene lotes registrados."
			onRowClick={(index) => goto(`/lotes/${order.lots[index].code}`)}
		>
			{#snippet rowMark(row)}
				<LotMark status={row.status} />
			{/snippet}
		</Table>
	</Section>

	<Section title="Tipos de empaque" count={order.references.length}>
		{#snippet action()}
			<ReferenceAdd
				bags={data.bags}
				lotVarieties={data.lotVarieties}
				availableKilos={available}
			/>
		{/snippet}

		<Table
			columns={REFERENCE_COLUMNS}
			rows={referenceRows}
			empty="Esta orden todavía no tiene referencias de empaque."
			onRowClick={(index) => (referenceDetail = index)}
		/>
	</Section>

	<!-- Process sections appear according to what the lots specify. -->
	{#if data.sections.trilla}
		<TrillaSection events={data.trillas} lots={data.trillaLots} staff={data.staffOptions} />
	{/if}
	{#if data.sections.seleccionVerde}
		<SeleccionSection
			title="Selección — Almendra verde"
			stage="VERDE"
			events={data.greenSelecciones}
			lots={data.greenSeleccionLots}
			staff={data.staffOptions}
		/>
	{/if}
	{#if data.sections.tostion}
		<TostionSection events={data.tostiones} lots={data.tostionLots} staff={data.staffOptions} />
	{/if}
	{#if data.sections.seleccionTostado}
		<SeleccionSection
			title="Selección — Tostado"
			stage="TOSTADO"
			events={data.roastedSelecciones}
			lots={data.roastedSeleccionLots}
			staff={data.staffOptions}
		/>
	{/if}
	{#if data.sections.empaque}
		<EmpaqueSection
			events={data.empaques}
			lots={data.empaqueLots}
			bags={data.bags}
			staff={data.staffOptions}
			references={data.referenceProgress}
		/>
	{/if}

	<!--
		Lineage: where each lot came from and what it became — as a shape first,
		then as rows. Collapsed by default: the diagram earns its space once a combo
		has made the rows hard to follow.
	-->
	<LineageSection graph={data.graph} open={false} />

	<Section title="Movimientos de lotes" count={data.movements.length}>
		{#snippet action()}
			<MovimientoForm
				lots={data.lotOptions}
				staff={data.staffOptions}
				variant="section"
			/>
		{/snippet}

		<MovimientoList movements={data.movements} lots={data.lotOptions} staff={data.staffOptions} />
	</Section>
</div>

{#if shownReference}
	<RecordModal
		open={referenceDetail !== null}
		onClose={() => (referenceDetail = null)}
		title="Referencia — {shownReference.code}"
		facts={referenceFacts}
	>
		{#snippet actions()}
			<button
				type="button"
				onclick={() => (editingReference = true)}
				class="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm
					text-muted transition hover:bg-amber-50 hover:text-amber-700
					dark:hover:bg-amber-950/40 dark:hover:text-amber-300"
			>
				<Icon name="pencil" />
				Editar
			</button>

			<form
				method="POST"
				action="?/deleteReference"
				use:enhance={(input) => {
					const announce = announceOnSuccess(input);
					return async (opts) => {
						if (typeof announce === 'function') await announce(opts);
						if (opts.result.type === 'success') referenceDetail = null;
					};
				}}
			>
				<input type="hidden" name="id" value={shownReference.id} />
				<button
					type="button"
					onclick={() => (deletingReference = true)}
					class="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm
						text-muted transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50"
				>
					<Icon name="trash" />
					Eliminar
				</button>

				<ConfirmDialog
					bind:open={deletingReference}
					title="Eliminar referencia"
					subject="la referencia de {shownReference.quantity} × {shownReference.grams} g"
				/>
			</form>
		{/snippet}
	</RecordModal>

	<!--
		Its own kilos go back into the budget while it is being edited: a line that
		had to fit alongside itself could never be made larger.
	-->
	<ReferenceAdd
		bags={data.bags}
		lotVarieties={data.lotVarieties}
		availableKilos={available + referenceKilos(shownReference)}
		bind:open={editingReference}
		edit={{
			id: shownReference.id,
			row: {
				grams: String(shownReference.grams),
				quantity: shownReference.quantity,
				grind: shownReference.grind,
				variety: shownReference.variety,
				bagId: shownReference.bagId === null ? '' : String(shownReference.bagId)
			}
		}}
	/>
{/if}
