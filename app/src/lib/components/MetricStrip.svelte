<script lang="ts">
	/**
	 * A labelled row of figures under a small heading — the order's
	 * reconciliation, the lot's balances.
	 *
	 * Wraps rather than scrolls, and stays one strip rather than becoming a
	 * table: these are a handful of totals, not records.
	 */
	export type Metric = {
		label: string;
		value: string;
		/** Draws the figure in red — a number that should not have happened. */
		alert?: boolean;
		/** Draws it muted — a placeholder awaiting the ledger. */
	};

	let { title, metrics }: { title: string; metrics: readonly Metric[] } = $props();
</script>

<div class="mt-4 border-t border-border pt-3">
	<h3 class="text-xs tracking-wide text-muted uppercase">{title}</h3>
	<div class="mt-2 flex flex-wrap gap-x-8 gap-y-2 text-sm">
		{#each metrics as metric (metric.label)}
			<span class="text-muted">
				{metric.label}
				<strong
					class="ml-1 tabular-nums {metric.alert
						? 'text-red-600 dark:text-red-400'
						: 'text-text'}"
				>
					{metric.value}
				</strong>
			</span>
		{/each}
	</div>
</div>
