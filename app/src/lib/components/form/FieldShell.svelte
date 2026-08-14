<script lang="ts">
	/**
	 * Shared wrapper for every field: label, required marker, hint and error.
	 * Keeps the individual input components down to just their input.
	 */
	import type { Snippet } from 'svelte';

	let {
		label,
		required = false,
		hint,
		error,
		wide = false,
		id,
		children
	}: {
		label: string;
		required?: boolean;
		hint?: string;
		error?: string;
		wide?: boolean;
		id: string;
		children: Snippet;
	} = $props();
</script>

<div class="flex flex-col gap-1.5 {wide ? 'sm:col-span-2' : ''}">
	<label for={id} class="text-sm font-medium text-text">
		{label}
		{#if required}<span class="text-accent" aria-hidden="true">*</span>{/if}
	</label>

	{@render children()}

	{#if error}
		<p class="text-xs text-red-600 dark:text-red-400">{error}</p>
	{:else if hint}
		<p class="text-xs text-muted">{hint}</p>
	{/if}
</div>
