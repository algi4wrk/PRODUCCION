<script lang="ts">
	/** The Empaque section: everything bagged, and the form that adds a batch. */
	import Section from '$lib/components/Section.svelte';
	import Table from '$lib/components/Table.svelte';
	import EventDetail from './EventDetail.svelte';
	import EmpaqueForm from './EmpaqueForm.svelte';
	import { formatDate, formatKilos } from '$lib/domain/derived';
	import { editableLots } from '$lib/domain/editable';
	import { linkUnlessHere } from '$lib/here';
	import type { EmpaqueLotOption } from '$lib/fields/empaque';
	import type { BagOption } from '$lib/fields/reference';
	import type { FieldOption } from '$lib/fields/types';
	import type { EmpaqueRow, ReferenceProgress } from '$lib/server/empaque';

	let {
		events,
		lots,
		bags,
		staff,
		references = [],
		showOrder = false,
		readonly = false,
		lotId
	}: {
		events: EmpaqueRow[];
		/** Omitted on a lot's own page, where there is nothing to pick between. */
		lots?: readonly EmpaqueLotOption[];
		bags?: readonly BagOption[];
		staff?: readonly FieldOption[];
		references?: readonly ReferenceProgress[];
		/** Adds the Orden column, for a list that spans several. */
		showOrder?: boolean;
		/** On a lot's page: the lot a new record opens on. */
		lotId?: number;
		/**
		 * Hides Deshacer. A person's page is a record of what they did, not a
		 * place to unwind production — and it has no action to post to.
		 */
		readonly?: boolean;
	} = $props();

	/** The row whose detail is open, if any. */
	let detail = $state<number | null>(null);
	/** Whether that row's edit form is open. */
	let editing = $state(false);

	const shown = $derived(detail === null ? null : events[detail]);

	/** The whole record, for the detail view. */
	const facts = $derived(
		shown
			? [
					{ label: 'Registro', value: shown.code, mono: true },
					{ label: 'Fecha', value: formatDate(shown.date) },
					{
						label: 'Orden',
						value: shown.orderCode,
						mono: true,
						href: linkUnlessHere(`/ordenes/${shown.orderCode}`)
					},
					// A record that names a lot is a way into it — unless it is the lot
					// whose page this already is.
					{ label: 'Lote', value: shown.lot, href: linkUnlessHere(`/lotes/${shown.lotCode}`) },
					{ label: 'Presentación', value: `${shown.grams} g` },
					{ label: 'Molienda', value: shown.grind },
					{ label: 'Cantidad', value: `${shown.quantity} bolsas` },
					{ label: 'Peso empacado', value: `${formatKilos(shown.kilos)} kg` },
					{ label: 'Bolsa', value: shown.bagName ?? '—' },
					{ label: 'Inspección', value: shown.inspection },
					// The name leads to the person, the same way the lot leads to the lot.
					{
						label: 'Responsable',
						value: shown.staffName ?? '—',
						href: linkUnlessHere(`/personal/${shown.edit.staffId}`)
					}
				]
			: []
	);

	/**
	 * The order column only appears where more than one order can be listed —
	 * a person's page. Inside an order it would repeat the page's own heading on
	 * every row.
	 */
	const COLUMNS = $derived([
		{ key: 'date', label: 'Fecha' },
		...(showOrder ? [{ key: 'order', label: 'Orden' }] : []),
		{ key: 'lot', label: 'Lote' },
		{ key: 'presentation', label: 'Presentación' },
		{ key: 'quantity', label: 'Cantidad', numeric: true },
		{ key: 'kilos', label: 'Peso', unit: 'kg', numeric: true },
		{ key: 'bag', label: 'Bolsa' },
		{ key: 'inspection', label: 'Inspección' },
		{ key: 'staff', label: 'Responsable' }
	]);

	const rows = $derived(
		events.map((event) => ({
			date: formatDate(event.date),
			order: event.orderCode,
			lot: event.lot,
			// Size and grind read as one thing on the bag, so they read as one here.
			presentation: `${event.grams} g · ${event.grind}`,
			quantity: String(event.quantity),
			kilos: formatKilos(event.kilos),
			bag: event.bagName ?? '—',
			inspection: event.inspection,
			staff: event.staffName ?? '—'
		}))
	);
</script>

<Section title="Empaque" count={events.length}>
	{#snippet action()}
		{#if lots && bags && staff}
			<EmpaqueForm {lots} {bags} {staff} {references} {lotId} />
		{/if}
	{/snippet}

	<Table
		columns={COLUMNS}
		{rows}
		empty="Sin empaques registrados."
		onRowClick={(index) => (detail = index)}
	/>
</Section>

{#if shown}
	<EventDetail
		open={detail !== null}
		onClose={() => (detail = null)}
		title="Empaque — {shown.code}"
		{facts}
		notes={shown.notes}
		canUndo={shown.canUndo}
		blockedReason="Hay registros posteriores en este lote."
		undoAction="?/undoEmpaque"
		id={shown.id}
		subject="el empaque de {shown.lot} del {formatDate(shown.date)}"
		onEdit={lots && bags && staff ? () => (editing = true) : undefined}
	>
		{#snippet editForm()}
			<!-- The coffee this bagged is in the EMPACADO bucket now, so the lot goes
			     back into the picker with that weight returned to it. -->
			{#if lots && bags && staff}
				<EmpaqueForm
					lots={editableLots(lots, {
						value: String(shown.edit.lotId),
						label: shown.lot,
						status: '',
						availableKilos: shown.kilos,
						variety: ''
					})}
					{bags}
					{staff}
					{references}
					bind:open={editing}
					edit={{
						id: shown.id,
						row: {
							lotId: String(shown.edit.lotId),
							referenceId: shown.edit.referenceId === null ? '' : String(shown.edit.referenceId),
							grams: String(shown.edit.grams),
							quantity: shown.edit.quantity,
							grind: shown.edit.grind,
							bagId: shown.edit.bagId === null ? '' : String(shown.edit.bagId),
							inspection: shown.edit.inspection,
							staffId: String(shown.edit.staffId),
							notes: shown.edit.notes ?? ''
						}
					}}
				/>
			{/if}
		{/snippet}
	</EventDetail>
{/if}
