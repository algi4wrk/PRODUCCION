<script lang="ts">
	/**
	 * The lot header, built from the same parts as the order's.
	 *
	 * Facts are split the way the lot form splits them: **Detalles** — what
	 * physically arrived — and **Procesos** — what the client asked to have done.
	 * The distinction matters here more than anywhere: the spec decides which
	 * event sections the page renders, and the events fill them.
	 *
	 * Balances stand in for the order's reconciliation. They are projections over
	 * the lot's events, and there are no events yet, so today they say the lot
	 * holds what it arrived with and has lost nothing.
	 */
	import FactGrid, { type Fact } from '$lib/components/FactGrid.svelte';
	import MetricStrip, { type Metric } from '$lib/components/MetricStrip.svelte';

	let {
		details,
		spec,
		balances
	}: {
		details: Fact[];
		spec: Fact[];
		balances: Metric[];
	} = $props();
</script>

<div class="px-4 py-4">
	<FactGrid facts={details} />

	<div class="mt-5 border-t border-border pt-4">
		<h3 class="mb-3 text-xs tracking-wide text-muted uppercase">Procesos</h3>
		<FactGrid facts={spec} />
	</div>

	<MetricStrip title="Balances" metrics={balances} />
</div>
