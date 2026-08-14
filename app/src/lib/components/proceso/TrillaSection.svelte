<script lang="ts">
	/**
	 * The Trilla section of an order: its hullings, and the form that adds one.
	 *
	 * Replaces the empty ProcessSection placeholder. Whether the section appears
	 * at all is still decided by the lot specifications, not by whether events
	 * exist — an order that needs hulling shows it from the moment it is created.
	 */
	import Section from '$lib/components/Section.svelte';
	import Table from '$lib/components/Table.svelte';
	import EventDetail from './EventDetail.svelte';
	import TrillaForm from './TrillaForm.svelte';
	import { formatDate, formatKilos } from '$lib/domain/derived';
	import { editableLots } from '$lib/domain/editable';
	import { linkUnlessHere } from '$lib/here';
	import type { TrillaLotOption } from '$lib/fields/trilla';
	import type { FieldOption } from '$lib/fields/types';
	import type { TrillaRow } from '$lib/server/trilla';

	let {
		events,
		lots,
		staff,
		showOrder = false,
		readonly = false
	}: {
		events: TrillaRow[];
		/** Omitted on a lot's own page, where there is nothing to pick between. */
		lots?: readonly TrillaLotOption[];
		staff?: readonly FieldOption[];
		/** Adds the Orden column, for a list that spans several. */
		showOrder?: boolean;
		/**
		 * Hides Deshacer. A person's page is a record of what they did, not a
		 * place to unwind production — and it has no action to post to.
		 */
		readonly?: boolean;
	} = $props();

	/**
	 * The order column only appears where more than one order can be listed —
	 * a person's page. Inside an order it would repeat the page's own heading on
	 * every row.
	 */
	const COLUMNS = $derived([
		{ key: 'date', label: 'Fecha' },
		...(showOrder ? [{ key: 'order', label: 'Orden' }] : []),
		{ key: 'lot', label: 'Lote' },
		{ key: 'parchment', label: 'Pergamino', unit: 'kg', numeric: true },
		{ key: 'green', label: 'Almendra', unit: 'kg', numeric: true },
		{ key: 'screens', label: 'Mallas separadas' },
		{ key: 'merma', label: 'Cisco', unit: 'kg', numeric: true },
		{ key: 'staff', label: 'Responsable' }
	]);

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
					{ label: 'Peso pergamino', value: `${formatKilos(shown.parchmentKilos)} kg` },
					{ label: 'Peso almendra', value: `${formatKilos(shown.greenKilos)} kg` },
					...shown.screens.map((screen) => ({
						label: `Malla ${screen.screen}`,
						value: `${formatKilos(screen.kilos)} kg`
					})),
					{ label: 'Cisco', value: `${formatKilos(shown.mermaKilos)} kg` },
					// The name leads to the person, the same way the lot leads to the lot.
					{
						label: 'Responsable',
						value: shown.staffName ?? '—',
						href: linkUnlessHere(`/personal/${shown.edit.staffId}`)
					}
				]
			: []
	);

	const rows = $derived(
		events.map((event) => ({
			date: formatDate(event.date),
			order: event.orderCode,
			lot: event.lot,
			parchment: formatKilos(event.parchmentKilos),
			green: formatKilos(event.greenKilos),
			screens:
				event.screens.map((s) => `${s.screen}: ${formatKilos(s.kilos)} kg`).join(' · ') || '—',
			merma: formatKilos(event.mermaKilos),
			staff: event.staffName ?? '—'
		}))
	);
</script>

<Section title="Trilla" count={events.length}>
	{#snippet action()}
		{#if lots && staff}
			<TrillaForm {lots} {staff} />
		{/if}
	{/snippet}

	<Table
		columns={COLUMNS}
		{rows}
		empty="Sin trillas registradas."
		onRowClick={(index) => (detail = index)}
	/>
</Section>

{#if shown}
	<EventDetail
		open={detail !== null}
		onClose={() => (detail = null)}
		title="Trilla — {shown.code}"
		{facts}
		notes={shown.notes}
		canUndo={shown.canUndo}
		blockedReason="Hay registros posteriores en estos lotes."
		undoAction="?/undoTrilla"
		id={shown.id}
		subject="la trilla de {shown.lot} del {formatDate(shown.date)}"
		onEdit={lots && staff ? () => (editing = true) : undefined}
		{readonly}
	>
		{#snippet editForm()}
			<!--
				The lot is no longer pergamino — this trilla is what made it almendra —
				so it has to be put back in the picker with the weight this event took
				returned to it. That is the cap the server applies once it has reversed
				the old entries.
			-->
			{#if lots && staff}
				<TrillaForm
					lots={editableLots(lots, {
						value: String(shown.edit.lotId),
						label: shown.lot,
						status: '',
						availableKilos: shown.parchmentKilos,
						estimatedGreenKilos: shown.greenKilos,
						screens: shown.screens.map((screen) => screen.screen)
					})}
					{staff}
					bind:open={editing}
					edit={{
						id: shown.id,
						row: {
							lotId: String(shown.edit.lotId),
							parchmentKilos: shown.edit.parchmentKilos,
							greenKilos: shown.edit.greenKilos,
							screen14: shown.edit.screen14,
							screen1516: shown.edit.screen1516,
							screen1718: shown.edit.screen1718,
							staffId: String(shown.edit.staffId),
							notes: shown.edit.notes ?? ''
						}
					}}
				/>
			{/if}
		{/snippet}
	</EventDetail>
{/if}
