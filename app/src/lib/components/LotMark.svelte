<script lang="ts">
	/**
	 * The little state mark that sits before a lot's name.
	 *
	 * Read across a room, shape and colour arrive before words do — the same
	 * reason PASO SIGUIENTE is colour-coded on the board.
	 */
	import Icon from './Icon.svelte';
	import { lotMark } from '$lib/lotIcons';

	let { status, size = 14 }: { status: string; size?: number } = $props();

	const mark = $derived(lotMark(status));
</script>

{#if mark}
	<span class={mark.class} title={status} aria-hidden="true">
		<Icon name={mark.icon} {size} />
	</span>
{/if}
