<script lang="ts">
	/**
	 * Multi-choice enum, for PROCESO SELECCION and MALLAS A SEPARAR.
	 *
	 * Values listed in `exclusive` ("NINGUNO", "Ninguna") mean *none of the
	 * others*, so they are made unreachable in combination rather than rejected
	 * afterwards: picking one clears the rest, and picking anything else clears
	 * it. The equivalent `validate` rule remains as a server-side backstop.
	 */
	import { optionClass } from './inputStyles';
	import type { FieldOption } from '$lib/fields/types';

	let {
		value = $bindable(),
		options,
		exclusive = []
	}: {
		value: string[];
		options: readonly FieldOption[];
		exclusive?: readonly string[];
	} = $props();

	function toggle(option: string) {
		if (value.includes(option)) {
			value = value.filter((item) => item !== option);
			return;
		}

		// An exclusive choice replaces everything; any other choice removes them.
		value = exclusive.includes(option)
			? [option]
			: [...value.filter((item) => !exclusive.includes(item)), option];
	}
</script>

<div class="flex flex-wrap gap-2">
	{#each options as option (option.value)}
		{@const selected = value.includes(option.value)}
		<button
			type="button"
			aria-pressed={selected}
			onclick={() => toggle(option.value)}
			class={optionClass(selected)}
		>
			{option.label}
		</button>
	{/each}
</div>
