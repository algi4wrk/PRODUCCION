<script lang="ts">
	/**
	 * The Tostión section: every batch roasted, the form that adds one, and the
	 * detail view of a batch already recorded.
	 *
	 * Clicking a row opens that batch in full, with Editar and Deshacer in it.
	 * The table shows seven columns and the record has more; putting the actions
	 * where the whole record is visible is also what stops an undo being aimed at
	 * the wrong row.
	 */
	import Section from '$lib/components/Section.svelte';
	import Table from '$lib/components/Table.svelte';
	import EventDetail from './EventDetail.svelte';
	import TostionForm from './TostionForm.svelte';
	import { formatDate, formatKilos } from '$lib/domain/derived';
	import { editableLots } from '$lib/domain/editable';
	import { linkUnlessHere } from '$lib/here';
	import type { TostionLotOption } from '$lib/fields/tostion';
	import type { FieldOption } from '$lib/fields/types';
	import type { TostionRow } from '$lib/server/tostion';

	let {
		events,
		lots,
		staff,
		showOrder = false,
		readonly = false,
		lotId
	}: {
		events: TostionRow[];
		/** Omitted on a lot's own page, where there is nothing to pick between. */
		lots?: readonly TostionLotOption[];
		staff?: readonly FieldOption[];
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

	/**
	 * The order column only appears where more than one order can be listed —
	 * a person's page. Inside an order it would repeat the page's own heading on
	 * every row.
	 */
	const COLUMNS = $derived([
		{ key: 'date', label: 'Fecha' },
		...(showOrder ? [{ key: 'order', label: 'Orden' }] : []),
		{ key: 'lot', label: 'Lote' },
		{ key: 'roastType', label: 'Tueste' },
		{ key: 'batch', label: 'Bache', unit: 'kg', numeric: true },
		{ key: 'roasted', label: 'Tostado', unit: 'kg', numeric: true },
		{ key: 'merma', label: 'Merma', unit: 'kg', numeric: true },
		{ key: 'staff', label: 'Responsable' }
	]);

	const rows = $derived(
		events.map((event) => ({
			date: formatDate(event.date),
			order: event.orderCode,
			lot: event.lot,
			roastType: event.roastType,
			batch: formatKilos(event.batchKilos),
			roasted: formatKilos(event.roastedKilos),
			merma: formatKilos(event.mermaKilos),
			staff: event.staffName ?? '—'
		}))
	);

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
					{ label: 'Tueste', value: shown.roastType },
					{ label: 'Peso del bache', value: `${formatKilos(shown.batchKilos)} kg` },
					{ label: 'Peso tostado', value: `${formatKilos(shown.roastedKilos)} kg` },
					{ label: 'Merma del tueste', value: `${formatKilos(shown.mermaKilos)} kg` },
					// The name leads to the person, the same way the lot leads to the lot.
					{
						label: 'Responsable',
						value: shown.staffName ?? '—',
						href: linkUnlessHere(`/personal/${shown.edit.staffId}`)
					}
				]
			: []
	);
</script>

<Section title="Tostión" count={events.length}>
	{#snippet action()}
		{#if lots && staff}
			<TostionForm {lots} {staff} {lotId} />
		{/if}
	{/snippet}

	<Table
		columns={COLUMNS}
		{rows}
		empty="Sin tostiones registradas."
		onRowClick={(index) => (detail = index)}
	/>
</Section>

{#if shown}
	<EventDetail
		open={detail !== null}
		onClose={() => (detail = null)}
		title="Tostión — {shown.code}"
		{facts}
		notes={shown.notes}
		canUndo={shown.canUndo}
		blockedReason="Hay registros posteriores en este lote."
		undoAction="?/undoTostion"
		id={shown.id}
		subject="la tostión de {shown.lot} del {formatDate(shown.date)}"
		onEdit={lots && staff ? () => (editing = true) : undefined}
		{readonly}
	>
		{#snippet editForm()}
			<!--
				The lot this batch names is no longer roastable — it has been roasted —
				so `editableLots` puts it back in the picker with the green this batch
				took returned to it, which is the cap the server will apply once it has
				reversed the old entries.
			-->
			{#if lots && staff}
				<TostionForm
					lots={editableLots(lots, {
						value: String(shown.edit.lotId),
						label: shown.lot,
						status: '',
						availableKilos: shown.batchKilos,
						roastType: shown.roastType
					})}
					{staff}
					bind:open={editing}
					edit={{
						id: shown.id,
						row: {
							...shown.edit,
							lotId: String(shown.edit.lotId),
							staffId: String(shown.edit.staffId)
						}
					}}
				/>
			{/if}
		{/snippet}
	</EventDetail>
{/if}
