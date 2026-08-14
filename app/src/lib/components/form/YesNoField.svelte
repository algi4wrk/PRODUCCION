<script lang="ts">
	/** Boolean toggle. Rendered as a pair of buttons so its state is readable at
	 *  a glance in a dense form, rather than as a checkbox. */
	import { optionClass } from './inputStyles';


	let {
		id,
		value = $bindable()
	}: {
		id: string;
		value: boolean;
	} = $props();

	const CHOICES = [
		{ label: 'Sí', on: true },
		{ label: 'No', on: false }
	];
</script>

<div class="flex gap-2" role="radiogroup" aria-labelledby={id}>
	{#each CHOICES as choice (choice.label)}
		<button
			type="button"
			role="radio"
			aria-checked={value === choice.on}
			onclick={() => (value = choice.on)}
			class={optionClass(value === choice.on)}
		>
			{choice.label}
		</button>
	{/each}
</div>
