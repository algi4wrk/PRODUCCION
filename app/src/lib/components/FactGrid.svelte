<script lang="ts">
	/**
	 * A grid of label/value pairs — the top of any detail view.
	 *
	 * Shared by the order and lot summaries so the two read identically. A
	 * definition list rather than a table: these are facts about one record, not
	 * rows to compare.
	 */
	export type Fact = {
		label: string;
		value: string;
		/** Codes and ids, which line up better in a monospace face. */
		mono?: boolean;
		/**
		 * Where this fact points, when it names something with a page of its own.
		 * Lots do: a record that mentions a lot is a way into it.
		 */
		href?: string;
		/**
		 * For a fact that names *several* things — the lots one lot came from, the
		 * lots it created. Each gets its own link; `value` is the fallback when the
		 * list is empty.
		 */
		links?: { label: string; href?: string }[];
	};

	let { facts }: { facts: readonly Fact[] } = $props();
</script>

<dl class="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
	<!-- Keyed by position, not by label: labels are display text and two of them
	     can legitimately coincide — a movimiento lists a leg per origin. -->
	{#each facts as fact, index (index)}
		<div>
			<dt class="text-xs tracking-wide text-muted uppercase">{fact.label}</dt>
			<dd class="mt-0.5 text-sm {fact.mono ? 'font-mono' : ''}">
				{#if fact.links && fact.links.length > 0}
					{#each fact.links as part, index (index)}
						{#if index > 0}<span class="text-muted">, </span>{/if}
						{#if part.href}
							<a
								href={part.href}
								class="text-accent transition hover:underline focus-visible:outline-2
									focus-visible:outline-offset-2 focus-visible:outline-accent"
							>
								{part.label}
							</a>
						{:else}
							<span class="text-text">{part.label}</span>
						{/if}
					{/each}
				{:else if fact.href}
					<a
						href={fact.href}
						class="text-accent transition hover:underline focus-visible:outline-2
							focus-visible:outline-offset-2 focus-visible:outline-accent"
					>
						{fact.value}
					</a>
				{:else}
					<span class="text-text">{fact.value}</span>
				{/if}
			</dd>
		</div>
	{/each}
</dl>
