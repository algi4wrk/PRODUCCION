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
		orderLabel,
		formatKilos,
		plannedKilos,
		receivedKilos,
		referenceKilos
	} from '$lib/domain/derived';
	import { estimatedOrderKilos, remainingKilos } from '$lib/domain/estimates';
	import { column } from '$lib/domain/lotRow';
	import { formForStep, type StepForm } from '$lib/domain/nextStepForm';
	import { STEP_TONES } from '$lib/stepTones';
	import TrillaForm from '$lib/components/proceso/TrillaForm.svelte';
	import SeleccionForm from '$lib/components/proceso/SeleccionForm.svelte';
	import TostionForm from '$lib/components/proceso/TostionForm.svelte';
	import EmpaqueForm from '$lib/components/proceso/EmpaqueForm.svelte';

	let { data } = $props();

	/**
	 * The next step, as a button.
	 *
	 * The lot rows already say what each lot needs next; pressing it opens the
	 * form that does it, with the lot filled in. The colours are the board's, so
	 * a step is the same colour wherever it is read.
	 *
	 * Steps that are not work — TERMINADO, COMBINADO, BODEGA, EN GRANEL — open
	 * nothing and stay as a plain chip.
	 */
	let stepForm = $state<{ kind: StepForm; lotId: number } | null>(null);
	/** Bound to the open form, so closing it from inside clears the choice. */
	let stepOpen = $state(false);

	$effect(() => {
		if (!stepOpen) stepForm = null;
	});

	const openStep = (index: number) => {
		const row = data.lotRows[index];
		const kind = formForStep(row.step);
		if (kind) {
			stepForm = { kind, lotId: order.lots[index].id };
			stepOpen = true;
		}
	};

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
	<!--
		The client leads, because that is what an order is *about*; the code is
		underneath in mono, where it is still available for the bags and the URL.
		The type label above is what tells this page apart from a lot's at a glance.
	-->
	<!--
		The path says where this is and what it is; the name says whose. The code
		lives in the path rather than in the title because it is how the order is
		filed, not what it is about.
	-->
	<div>
		<p class="text-xs tracking-widest text-muted uppercase">
			<a href="/ordenes" class="transition hover:text-accent">Órdenes</a>
			<span class="mx-1">›</span>
			<span class="font-mono">{order.code}</span>
		</p>
		<!-- The same name the queue and HISTORIAL show, so an order reads the same
		     wherever it is met: brand first, client after. -->
		<!-- The state sits at the end of the name, the way a lot's does. -->
		<h1 class="mt-0.5 flex flex-wrap items-center gap-2 text-xl font-semibold text-text">
			{orderLabel(order, order.clientName)}
			<Badge text={order.status} tone={statusTone(order.status)} />
			<!--
				Beside the status rather than outside the block. As a sibling of the
				name it was centred against both lines of it — path above, title below —
				and so sat half a line high beside the badge it belongs next to. The two
				say the same kind of thing about the order and now read as a pair.
			-->
			{#if order.priority}
				<Badge text="PRIORIDAD" tone="priority" />
			{/if}
		</h1>
	</div>

	<!-- The actions fill the empty right of this row: they act on the order as a
	     whole, which is exactly what this row identifies. -->
	<div class="ml-auto">
		<OrderStatus status={order.status} priority={order.priority} code={order.code}>
			{#snippet edit()}
				<MovimientoForm lots={data.lotOptions} staff={data.staffOptions} iconOnly />
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
			rowActionLabel="Paso siguiente"
		>
			{#snippet rowMark(row)}
				<LotMark status={row.status} />
			{/snippet}

			{#snippet rowAction(index)}
				{@const row = data.lotRows[index]}
				{@const kind = formForStep(row.step)}
				<!--
					`stopPropagation` so the button wins over the row it sits in: the row
					opens the lot, which is the right thing to do everywhere else on it.
				-->
				{#if kind}
					<button
						type="button"
						onclick={(event) => {
							event.stopPropagation();
							openStep(index);
						}}
						class="rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap transition
							hover:opacity-80 {STEP_TONES[row.stepTone] ?? STEP_TONES.neutral}"
					>
						{row.step}
					</button>
				{:else}
					<span
						class="rounded-md px-2 py-1 text-xs whitespace-nowrap
							{STEP_TONES[row.stepTone] ?? STEP_TONES.neutral}"
					>
						{row.step}
					</span>
				{/if}
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

<!--
	The forms the step buttons open, one instance each: they are the same forms
	the sections below use, opened with the lot already chosen.
-->
{#if stepForm}
	{@const lotId = stepForm.lotId}
	{#if stepForm.kind === 'trilla'}
		<TrillaForm
			lots={data.trillaLots}
			staff={data.staffOptions}
			{lotId}
			trigger={false}
			bind:open={stepOpen}
		/>
	{:else if stepForm.kind === 'seleccionVerde'}
		<SeleccionForm
			lots={data.greenSeleccionLots}
			staff={data.staffOptions}
			stage="VERDE"
			title="Selección — Almendra verde"
			{lotId}
			trigger={false}
			bind:open={stepOpen}
		/>
	{:else if stepForm.kind === 'seleccionTostado'}
		<SeleccionForm
			lots={data.roastedSeleccionLots}
			staff={data.staffOptions}
			stage="TOSTADO"
			title="Selección — Tostado"
			{lotId}
			trigger={false}
			bind:open={stepOpen}
		/>
	{:else if stepForm.kind === 'tostion'}
		<TostionForm
			lots={data.tostionLots}
			staff={data.staffOptions}
			{lotId}
			trigger={false}
			bind:open={stepOpen}
		/>
	{:else}
		<EmpaqueForm
			lots={data.empaqueLots}
			bags={data.bags}
			staff={data.staffOptions}
			references={data.referenceProgress}
			{lotId}
			trigger={false}
			bind:open={stepOpen}
		/>
	{/if}
{/if}
