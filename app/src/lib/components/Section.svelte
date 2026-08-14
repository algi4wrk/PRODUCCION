<script lang="ts">
	/** A collapsible page section. Used for the order summary and each process
	 *  section on the order detail page. */
	import type { Snippet } from 'svelte';

	let {
		title,
		open = $bindable(true),
		collapsible = true,
		count,
		action,
		children
	}: {
		title: string;
		open?: boolean;
		collapsible?: boolean;
		/** Optional badge showing how many records the section holds. */
		count?: number;
		/**
		 * A control that adds to what this section lists — "+ Nuevo". Sits at the
		 * foot of the contents, so it reads as "and one more", and disappears with
		 * them when the section is collapsed: there is nothing to add to a list you
		 * are not looking at.
		 */
		action?: Snippet;
		children: Snippet;
	} = $props();
</script>

<section class="overflow-hidden rounded-lg border border-border bg-surface">
	<!--
		The whole header is the control, not just the word at the end of it: the
		title is what the eye goes to, and a strip that says "Ocultar" behaves as
		though only three centimetres of itself are pressable.

		It is one <button> rather than a div with a handler, so it keeps the
		keyboard and screen-reader behaviour for free. That is also why Ocultar is
		a <span> now — a button inside a button is not valid, and clicking it would
		toggle twice on the way up.
	-->
	{#snippet heading()}
		<div class="flex items-center gap-2">
			<h2 class="text-sm font-semibold tracking-wide text-text uppercase">{title}</h2>
			{#if count !== undefined}
				<span class="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">{count}</span>
			{/if}
		</div>
	{/snippet}

	{#if collapsible}
		<button
			type="button"
			onclick={() => (open = !open)}
			aria-expanded={open}
			class="group flex w-full items-center justify-between border-b border-border px-4 py-3
				text-left transition hover:bg-accent-soft/30"
		>
			{@render heading()}
			<span class="text-xs text-muted transition group-hover:text-accent">
				{open ? 'Ocultar' : 'Mostrar'}
			</span>
		</button>
	{:else}
		<header class="flex items-center justify-between border-b border-border px-4 py-3">
			{@render heading()}
		</header>
	{/if}

	{#if open}
		{@render children()}

		{#if action}
			<!-- No rule above it: the button belongs to the list, and a divider
			     would set it apart as its own thing. A thin strip, since the button
			     is the whole content. -->
			<div class="flex justify-end px-3 py-1">
				{@render action()}
			</div>
		{/if}
	{/if}
</section>
