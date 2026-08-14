<script lang="ts">
	/**
	 * The detail view of one row — an event, a movimiento, a reference.
	 *
	 * Every table in the app lists a handful of columns and drops the rest; this
	 * is where the rest lives, opened by clicking the row. The same arrangement
	 * the order and lot pages use — facts first, actions after — so a record
	 * reads the same whether it has a page of its own or not.
	 *
	 * The actions are a snippet rather than props: what can be done to a record
	 * differs by kind, and a reference is deleted where an event is undone.
	 */
	import type { Snippet } from 'svelte';
	import Modal from './Modal.svelte';
	import FactGrid, { type Fact } from './FactGrid.svelte';

	let {
		open = $bindable(false),
		title,
		facts,
		/** Free text kept out of the grid, where a long note would stretch a column. */
		notes,
		/**
		 * Anything the grid cannot say in label/value pairs — a movimiento's legs,
		 * which are a list of lots and weights rather than facts about one thing.
		 */
		body,
		/** For callers whose `open` is derived from which row is showing. */
		onClose,
		actions
	}: {
		open?: boolean;
		title: string;
		facts: readonly Fact[];
		notes?: string | null;
		body?: Snippet;
		onClose?: () => void;
		actions?: Snippet;
	} = $props();
</script>

<Modal {title} bind:open {onClose} size="wide">
	<FactGrid {facts} />

	{#if body}{@render body()}{/if}

	{#if notes}
		<div class="mt-4 rounded-md border border-border bg-bg/60 px-3 py-2.5">
			<p class="text-xs tracking-wide text-muted uppercase">Observaciones</p>
			<p class="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-text">{notes}</p>
		</div>
	{/if}

	{#if actions}
		<div class="mt-5 flex flex-wrap gap-2">{@render actions()}</div>
	{/if}
</Modal>
