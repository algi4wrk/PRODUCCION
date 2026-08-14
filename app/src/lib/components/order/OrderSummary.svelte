<script lang="ts">
	/**
	 * The order header: identifying facts, plus reconciliation as a subheader.
	 *
	 * Reconciliation reports what arrived, what the ledger says has been lost,
	 * and how much of the packaging plan the order can still cover.
	 */
	import FactGrid, { type Fact } from '$lib/components/FactGrid.svelte';
	import MetricStrip, { type Metric } from '$lib/components/MetricStrip.svelte';
	import { formatDate, formatKilos, formatPercent } from '$lib/domain/derived';
	import { remainingKilos } from '$lib/domain/estimates';
	import type { OrderDetail } from '$lib/server/orders';

	let {
		order,
		received,
		estimated,
		planned,
		merma
	}: {
		order: OrderDetail;
		received: number;
		/** Roasted coffee the lots are expected to yield. */
		estimated: number;
		planned: number;
		/** What has actually been lost so far, and as a share of what arrived. */
		merma: { kilos: number; fraction: number };
	} = $props();

	/** Kilos still unallocated, with sub-gram noise snapped to zero. */
	const remaining = $derived(remainingKilos(estimated, planned));

	const facts = $derived<Fact[]>([
		{ label: 'Código', value: order.code, mono: true },
		{ label: 'Cliente', value: order.clientName },
		{ label: 'Marca', value: order.brand || '—' },
		{ label: 'Tipo', value: order.type },
		{ label: 'Línea de producto', value: order.productLine || '—' },
		{ label: 'Fecha', value: formatDate(order.date) },
		{ label: 'Peel stick', value: order.peelStick ? 'Sí' : 'No' }
	]);

	/**
	 * Reconciliation: what arrived, what has been lost, what is left to promise.
	 *
	 * The two estimates behind `Disponible` are no longer shown beside it. They
	 * belong to lot creation and to the referencias that spend them; repeating
	 * them here restated the arithmetic instead of reporting the order.
	 */
	const metrics = $derived<Metric[]>([
		{ label: 'Recibido', value: `${formatKilos(received)} kg` },
		// What has gone, as opposed to what the yield tables predict.
		{
			label: 'Merma',
			value: `${formatKilos(merma.kilos)} kg · ${formatPercent(merma.fraction)}`
		},
		// Negative means the packaging plan promises more than the lots can yield.
		{ label: 'Disponible', value: `${formatKilos(remaining)} kg`, alert: remaining < 0 }
	]);
</script>

<div class="px-4 py-4">
	<FactGrid {facts} />

	<!--
		Notes carry things the structured fields cannot — billing remarks, packaging
		the client supplies. Set apart so they read as a written note rather than
		another field, and hidden entirely when empty so the space is not reserved.
	-->
	{#if order.notes}
		<div class="mt-4 rounded-md border border-border bg-bg/60 px-3 py-2.5">
			<p class="text-xs tracking-wide text-muted uppercase">Notas</p>
			<p class="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-text">{order.notes}</p>
		</div>
	{/if}

	<MetricStrip title="Conciliación" {metrics} />
</div>
