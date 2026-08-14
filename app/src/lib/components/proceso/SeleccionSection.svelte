<script lang="ts">
	/**
	 * A selección section — one for green, one for roasted. Both are the same
	 * event; which lots appear is what differs.
	 */
	import Section from '$lib/components/Section.svelte';
	import Table from '$lib/components/Table.svelte';
	import EventDetail from './EventDetail.svelte';
	import SeleccionForm from './SeleccionForm.svelte';
	import { editableLots } from '$lib/domain/editable';
	import { linkUnlessHere } from '$lib/here';
	import { formatDate, formatKilos } from '$lib/domain/derived';
	import type { SeleccionLotOption } from '$lib/fields/seleccion';
	import type { FieldOption } from '$lib/fields/types';
	import type { SeleccionRow } from '$lib/server/seleccion';

	let {
		title,
		events,
		lots,
		staff,
		showOrder = false,
		readonly = false
	}: {
		title: string;
		events: SeleccionRow[];
		/** Omitted on a lot's own page, where there is nothing to pick between. */
		lots?: readonly SeleccionLotOption[];
		staff?: readonly FieldOption[];
		/** Adds the Orden column, for a list that spans several. */
		showOrder?: boolean;
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
					{ label: 'Etapa', value: shown.stage },
					{ label: 'Peso a seleccionar', value: `${formatKilos(shown.totalKilos)} kg` },
					{ label: 'Peso seleccionado', value: `${formatKilos(shown.netKilos)} kg` },
					/*
					 * One field, not two: what was picked out is a single weight, and
					 * the stage decides what it is called. Sorting green coffee picks
					 * out defects; sorting roasted coffee picks out quakers, which the
					 * client may have asked to keep — then they leave in a lot of their
					 * own instead of becoming merma.
					 */
					shown.stage === 'TOSTADO'
						? {
								label: 'Quakers',
								value: `${formatKilos(shown.totalKilos - shown.netKilos)} kg${
									shown.quakerKilos === null ? ' · merma' : ' · a su propio lote'
								}`
							}
						: {
								label: 'Defectos',
								value: `${formatKilos(shown.totalKilos - shown.netKilos)} kg · merma`
							},
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
		{ key: 'total', label: 'Entra', unit: 'kg', numeric: true },
		{ key: 'net', label: 'Seleccionado', unit: 'kg', numeric: true },
		{ key: 'removed', label: 'Retirado', unit: 'kg', numeric: true },
		{ key: 'fate', label: 'Destino de lo retirado' },
		{ key: 'staff', label: 'Responsable' }
	]);

	const rows = $derived(
		events.map((event) => ({
			date: formatDate(event.date),
			order: event.orderCode,
			lot: event.lot,
			total: formatKilos(event.totalKilos),
			net: formatKilos(event.netKilos),
			removed: formatKilos(event.totalKilos - event.netKilos),
			fate: event.quakerKilos === null ? 'Merma' : 'Lote de quakers',
			staff: event.staffName ?? '—'
		}))
	);
</script>

<Section {title} count={events.length}>
	{#snippet action()}
		{#if lots && staff}
			<SeleccionForm {lots} {staff} title="{title} — nuevo registro" />
		{/if}
	{/snippet}

	<Table
		columns={COLUMNS}
		{rows}
		empty="Sin selecciones registradas."
		onRowClick={(index) => (detail = index)}
	/>
</Section>

{#if shown}
	<EventDetail
		open={detail !== null}
		onClose={() => (detail = null)}
		title="{title} — {shown.code}"
		{facts}
		notes={shown.notes}
		canUndo={shown.canUndo}
		blockedReason="Hay registros posteriores en estos lotes."
		undoAction="?/undoSeleccion"
		id={shown.id}
		subject="la selección de {shown.lot} del {formatDate(shown.date)}"
		onEdit={lots && staff ? () => (editing = true) : undefined}
		{readonly}
	>
		{#snippet editForm()}
			<!--
				The coffee this sorted is now in the sorted bucket, so the lot may no
				longer be offered here at all. It goes back into the picker with the
				weight this selección took returned to it.
			-->
			{#if lots && staff}
				<SeleccionForm
					lots={editableLots(lots, {
						value: String(shown.edit.lotId),
						label: shown.lot,
						status: '',
						availableKilos: shown.totalKilos,
						keepsQuakers: shown.quakerKilos !== null
					})}
					{staff}
					title="{title} — editar registro"
					bind:open={editing}
					edit={{
						id: shown.id,
						row: {
							lotId: String(shown.edit.lotId),
							totalKilos: shown.edit.totalKilos,
							netKilos: shown.edit.netKilos,
							staffId: String(shown.edit.staffId),
							notes: shown.edit.notes ?? ''
						}
					}}
				/>
			{/if}
		{/snippet}
	</EventDetail>
{/if}
