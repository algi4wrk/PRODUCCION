<script lang="ts">
	/**
	 * The lineage diagram in its section, on either page that shows one.
	 *
	 * On an order it is the whole order, collapsed by default: it is a picture of
	 * something the tables above already state, worth opening when a combo has
	 * made the tables hard to follow.
	 *
	 * On a lot it opens on that lot's own neighbourhood — see `focusLineage` for
	 * what that includes — with the whole order a click away.
	 */
	import Section from '$lib/components/Section.svelte';
	import LotTree from './LotTree.svelte';
	import { focusLineage } from '$lib/domain/lineage';
	import type { LineageGraph } from '$lib/server/movimientos';

	let {
		graph,
		/** Set on a lot's page: the lot the narrow view is centred on. */
		currentLotId,
		open = true
	}: {
		graph: LineageGraph;
		currentLotId?: number;
		open?: boolean;
	} = $props();

	/**
	 * Which of the two the operator is looking at. Only offered on a lot.
	 *
	 * Opens narrow: a lot's page is about that lot, and the rest of the order in
	 * the frame is other people's coffee. The whole order is one click away.
	 *
	 * Reset when the lot changes, so every lot opens the same way rather than
	 * inheriting whatever was chosen on the one before it.
	 */
	let scope = $state<'lote' | 'orden'>('lote');

	$effect(() => {
		currentLotId;
		scope = 'lote';
	});

	const focused = $derived(
		currentLotId === undefined ? graph : focusLineage(graph, currentLotId)
	);
	const shown = $derived(scope === 'orden' ? graph : focused);

	/**
	 * Nothing to narrow: the lot's neighbourhood is already the whole order.
	 *
	 * Measured on the *focused* graph rather than on what is showing. Reading it
	 * off `shown` made the two identical the moment the operator switched to the
	 * order — so the control vanished, with no way back to the lot.
	 */
	const sameEitherWay = $derived(
		currentLotId !== undefined && focused.nodes.length === graph.nodes.length
	);

	const TAB = 'rounded-md px-2 py-1 text-xs transition';
</script>

<Section title="Árbol de lotes" {open}>
	{#if currentLotId !== undefined && !sameEitherWay}
		<div class="flex items-center gap-1 px-4 pt-3">
			<button
				type="button"
				onclick={() => (scope = 'lote')}
				aria-pressed={scope === 'lote'}
				class="{TAB} {scope === 'lote'
					? 'bg-accent-soft font-medium text-accent'
					: 'text-muted hover:text-accent'}"
			>
				Este lote
			</button>
			<button
				type="button"
				onclick={() => (scope = 'orden')}
				aria-pressed={scope === 'orden'}
				class="{TAB} {scope === 'orden'
					? 'bg-accent-soft font-medium text-accent'
					: 'text-muted hover:text-accent'}"
			>
				Toda la orden
			</button>
		</div>
	{/if}

	{#if shown.edges.length === 0}
		<p class="px-4 py-6 text-center text-sm text-muted">Este café no ha cambiado de lote.</p>
	{:else}
		<LotTree graph={shown} {currentLotId} />
	{/if}
</Section>
