<script lang="ts">
	/**
	 * The lineage of an order or a lot: every time coffee crossed between lots.
	 *
	 * Lots are named by their letter, not their full ID_LOTE, because a lot is
	 * only ever read inside its own order — the same naming the floor board uses.
	 *
	 * "Automático" marks a movimiento a process step emitted rather than one an
	 * operator entered. Those are the majority once the steps land: a trilla that
	 * separates a malla writes its own movimiento, and nobody fills in a form.
	 */
	import Table from '$lib/components/Table.svelte';
	import EventDetail from '$lib/components/proceso/EventDetail.svelte';
	import MovimientoForm from './MovimientoForm.svelte';
	import { formatDate, formatKilos } from '$lib/domain/derived';
	import { linkUnlessHere } from '$lib/here';
	import { editableLots } from '$lib/domain/editable';
	import type { LotOption } from '$lib/fields/movimiento';
	import type { FieldOption } from '$lib/fields/types';
	import type { MovementRow } from '$lib/server/movimientos';

	let {
		movements,
		/** The pickers the edit form needs. Omitted where editing is not offered. */
		lots,
		staff,
		showOrder = false,
		readonly = false
	}: {
		movements: MovementRow[];
		lots?: readonly LotOption[];
		staff?: readonly FieldOption[];
		/** Adds the Orden column, for a list that spans several. */
		showOrder?: boolean;
		/** Hides Deshacer, for views that only report what happened. */
		readonly?: boolean;
	} = $props();

	/** The row whose detail is open, if any. */
	let detail = $state<number | null>(null);
	/** Whether that row's edit form is open. */
	let editing = $state(false);

	const shown = $derived(detail === null ? null : movements[detail]);

	/**
	 * What each lot gave, and what the destination received.
	 *
	 * Not facts: a movimiento's legs are lots against weights, and a label/value
	 * grid says "Origen C · 4,00 kg" — which reads as a fact about something
	 * called Origen C rather than as one side of a transfer. As rows, with the
	 * destination under the origins, the table has the shape of the movimiento.
	 */
	const legs = $derived(
		shown
			? shown.origins.map((letter, index) => ({
					label: shown.originLabels[index] ?? letter,
					kilos: shown.originKilos[index] ?? 0,
					href: linkUnlessHere(`/lotes/${shown.originCodes[index]}`)
				}))
			: []
	);

	/**
	 * The lots the edit form may pick from.
	 *
	 * A movimiento that took everything left its origin at zero, and a lot at zero
	 * is not offered anywhere — so the form would open with its own origin missing
	 * from the list and the row blank. Each lot this movimiento touched goes back
	 * in with the weight it moved returned to it, which is also the cap the server
	 * will apply once it has reversed the old legs.
	 */
	const editLots = $derived.by(() => {
		if (!lots || !shown) return [];

		let merged = [...lots];
		shown.originIds.forEach((id, index) => {
			merged = editableLots(merged, {
				value: String(id),
				label: shown.originLabels[index],
				// Left blank on purpose: the form uses status to refuse mixing kinds
				// of coffee, and a movimiento that already exists was allowed once.
				status: '',
				availableKilos: shown.originKilos[index] ?? 0
			});
		});
		return merged;
	});

	/** The whole record, for the detail view. */
	const facts = $derived(
		shown
			? [
					{ label: 'Movimiento', value: shown.code, mono: true },
					{ label: 'Fecha', value: formatDate(shown.date) },
					{
						label: 'Orden',
						value: shown.orderCode,
						mono: true,
						href: linkUnlessHere(`/ordenes/${shown.orderCode}`)
					},
					{ label: 'Acción', value: shown.action },
					{ label: 'Peso movido', value: `${formatKilos(shown.kilos)} kg` },
					{
						label: 'Responsable',
						value: shown.staffName ?? '—',
						href: linkUnlessHere(`/personal/${shown.edit.staffId}`)
					},
					{
						label: 'Registro',
						value: shown.emittedBy ? `Automático · ${shown.emittedBy}` : 'Manual'
					}
				]
			: []
	);

	const COLUMNS = $derived([
		{ key: 'date', label: 'Fecha' },
		...(showOrder ? [{ key: 'order', label: 'Orden' }] : []),
		{ key: 'action', label: 'Acción' },
		{ key: 'origins', label: 'Origen' },
		{ key: 'destination', label: 'Destino' },
		{ key: 'kilos', label: 'Peso', unit: 'kg', numeric: true },
		{ key: 'staffName', label: 'Responsable' },
		{ key: 'source', label: 'Registro' }
	]);

	const rows = $derived(
		movements.map((movement) => ({
			date: formatDate(movement.date),
			order: movement.orderCode,
			action: movement.action,
			origins: movement.origins.join(', '),
			destination: movement.destination,
			kilos: formatKilos(movement.kilos),
			staffName: movement.staffName ?? '—',
			source: movement.emittedBy ? `Automático · ${movement.emittedBy}` : 'Manual'
		}))
	);
</script>

<Table
	columns={COLUMNS}
	{rows}
	empty="Este café no ha cambiado de lote."
	onRowClick={(index) => (detail = index)}
/>

{#if shown}
	<EventDetail
		open={detail !== null}
		onClose={() => (detail = null)}
		title="Movimiento — {shown.code}"
		{facts}
		canUndo={shown.canUndo}
		blockedReason={shown.emittedBy
			? `Lo generó una ${shown.emittedBy}: edítelo desde ahí.`
			: 'Hay registros posteriores en estos lotes.'}
		undoAction="?/undoMovimiento"
		id={shown.id}
		subject="{shown.action.toLowerCase()} de {shown.origins.join(', ')} a {shown.destination}"
		onEdit={lots && staff ? () => (editing = true) : undefined}
		{readonly}
	>
		{#snippet body()}
			<div class="mt-4 overflow-hidden rounded-md border border-border">
				<table class="w-full text-sm">
					<tbody>
						{#each legs as leg (leg.label)}
							<tr class="border-b border-border/60">
								<td class="px-3 py-2 text-xs tracking-wide text-muted uppercase">Origen</td>
								<td class="px-3 py-2">
									{#if leg.href}
										<a href={leg.href} class="text-accent transition hover:underline">
											{leg.label}
										</a>
									{:else}
										<span class="text-text">{leg.label}</span>
									{/if}
								</td>
								<td class="px-3 py-2 text-right tabular-nums text-text">
									{formatKilos(leg.kilos)} kg
								</td>
							</tr>
						{/each}
						<tr>
							<td class="px-3 py-2 text-xs tracking-wide text-muted uppercase">Destino</td>
							<td class="px-3 py-2">
								{#if linkUnlessHere(`/lotes/${shown.destinationCode}`)}
									<a
										href="/lotes/{shown.destinationCode}"
										class="font-medium text-accent transition hover:underline"
									>
										{shown.destinationLabel}
									</a>
								{:else}
									<span class="font-medium text-text">{shown.destinationLabel}</span>
								{/if}
							</td>
							<td class="px-3 py-2 text-right font-medium tabular-nums text-text">
								{formatKilos(shown.kilos)} kg
							</td>
						</tr>
					</tbody>
				</table>
			</div>
		{/snippet}

		{#snippet editForm()}
			<!--
				Editing rewrites the movimiento: the old legs are reversed and the new
				ones posted, so the origins go back to what they were holding before
				the picker caps anything.
			-->
			{#if lots && staff}
				<MovimientoForm
					lots={editLots}
					{staff}
					bind:open={editing}
					edit={{
						id: shown.id,
						action: shown.edit.action,
						destinationLotId: shown.edit.destinationLotId,
						staffId: shown.edit.staffId,
						legs: shown.edit.legs
					}}
				/>
			{/if}
		{/snippet}
	</EventDetail>
{/if}
