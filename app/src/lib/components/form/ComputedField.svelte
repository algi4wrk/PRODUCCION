<script lang="ts">
	/**
	 * Read-only derived value, recalculated as the form is filled in.
	 *
	 * These are the AppSheet columns that had an App formula and `Show? = true` —
	 * PESO KILO, ESTIMADO (kg), ESTIMADO TRILLA. Styled unlike an input, because
	 * it is a result rather than something to type into.
	 */
	let {
		text,
		note,
		tone = 'neutral'
	}: {
		text: string;
		/** Muted aside on the right, e.g. the merma percentage behind a figure. */
		note?: string;
		/** `warn` for a value that has gone negative. */
		tone?: 'neutral' | 'warn';
	} = $props();
</script>

<div
	class="flex items-baseline justify-between gap-3 rounded-md border border-dashed
		border-border bg-bg/50 px-3 py-2 text-sm"
>
	<span class="tabular-nums {tone === 'warn' ? 'text-red-600 dark:text-red-400' : 'text-text'}">
		{text}
	</span>
	{#if note}
		<span class="shrink-0 text-xs text-muted">{note}</span>
	{/if}
</div>
