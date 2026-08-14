<script lang="ts">
	/**
	 * A calendar date, held as `yyyy-mm-dd`.
	 *
	 * The native picker, unlike `type="number"`, is safe here: a date input has
	 * one unambiguous wire format and the browser renders it in the reader's own
	 * convention, so a Colombian sees 14/08/2026 while the value stays sortable.
	 */
	import Icon from '$lib/components/Icon.svelte';
	import { inputClass } from './inputStyles';

	let {
		id,
		value = $bindable(),
		error,
		/** Adds the × that empties it, for fields an empty value is an answer to. */
		clearable = false
	}: {
		id: string;
		value: string;
		error?: string;
		clearable?: boolean;
	} = $props();
</script>

<!--
	Clicking anywhere in the field opens the calendar, not only the small icon at
	its right edge. `showPicker` is the browser's own control; the guard is for
	the ones that do not have it, where the icon still works.
-->
<div class="relative">
	<input
		{id}
		type="date"
	bind:value
		onclick={(event) => {
			const input = event.currentTarget as HTMLInputElement & { showPicker?: () => void };
			input.showPicker?.();
		}}
		class="{inputClass(!!error)} cursor-pointer
			[&::-webkit-calendar-picker-indicator]:cursor-pointer
			[&::-webkit-calendar-picker-indicator]:opacity-60
			[&::-webkit-calendar-picker-indicator]:hover:opacity-100 {clearable && value
			? 'pr-9'
			: ''}"
	/>

	<!-- Left of the calendar icon, so the browser's own control keeps its place. -->
	{#if clearable && value}
		<button
			type="button"
			onclick={() => (value = '')}
			aria-label="Quitar la fecha"
			title="Quitar"
			class="absolute inset-y-0 right-7 flex items-center text-muted transition
				hover:text-text"
		>
			<Icon name="close" size={14} />
		</button>
	{/if}
</div>
