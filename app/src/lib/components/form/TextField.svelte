<script lang="ts">
	/** Single-line and multi-line free text. Read-only fields render the same
	 *  control disabled, so autofilled values look consistent with the rest. */
	import { inputClass } from './inputStyles';

	let {
		id,
		value = $bindable(),
		multiline = false,
		readonly = false,
		error
	}: {
		id: string;
		value: string;
		multiline?: boolean;
		readonly?: boolean;
		error?: string;
	} = $props();
</script>

{#if multiline}
	<!-- Two rows: notes and observaciones are usually a line, and a taller box
	     only makes the modals it sits in longer. It still grows on drag. -->
	<textarea {id} bind:value rows="2" disabled={readonly} class={inputClass(!!error)}></textarea>
{:else}
	<input {id} type="text" bind:value disabled={readonly} class={inputClass(!!error)} />
{/if}
