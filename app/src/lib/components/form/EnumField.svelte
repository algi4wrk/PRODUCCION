<script lang="ts">
	/**
	 * Single-choice enum.
	 *
	 * Short lists render as buttons, matching the AppSheet "Input mode: Buttons"
	 * setting on TIPO DE ORDEN — faster to hit and shows every option at once.
	 * Longer lists fall back to the shared Dropdown.
	 */
	import Dropdown from './Dropdown.svelte';
	import { optionClass } from './inputStyles';
	import type { FieldOption } from '$lib/fields/types';

	let {
		id,
		value = $bindable(),
		options,
		error,
		/**
		 * Whether pressing the chosen option again clears it.
		 *
		 * Only where an empty value means something. On a required field the
		 * choice has to be one of the options, and a press that quietly emptied it
		 * would be a way to break the form by clicking the answer twice.
		 */
		clearable = false
	}: {
		id: string;
		value: string;
		options: readonly FieldOption[];
		error?: string;
		clearable?: boolean;
	} = $props();

	const BUTTON_LIMIT = 4;
	const asButtons = $derived(
		options.length <= BUTTON_LIMIT && options.every((option) => option.label.length <= 18)
	);
</script>

{#if asButtons}
	<div class="flex flex-wrap gap-2" role="radiogroup" aria-labelledby={id}>
		{#each options as option (option.value)}
			<button
				type="button"
				role="radio"
				aria-checked={value === option.value}
				onclick={() =>
					(value = clearable && value === option.value ? '' : option.value)}
				class={optionClass(value === option.value)}
			>
				{option.label}
			</button>
		{/each}
	</div>
{:else}
	<Dropdown {id} bind:value {options} {error} {clearable} />
{/if}
