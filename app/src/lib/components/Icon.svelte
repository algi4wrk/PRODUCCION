<script lang="ts">
	/**
	 * Renders one icon from the set in `$lib/icons`.
	 *
	 * Inline SVG rather than an icon font or an image, so the stroke picks up
	 * `currentColor` and an icon always matches the text of the button it sits in.
	 */
	import { FILLED_ICONS, ICON_PATHS, type IconName } from '$lib/icons';

	let {
		name,
		/** Pixel size; buttons use the default, which matches their text size. */
		size = 14
	}: { name: IconName; size?: number } = $props();

	const filled = $derived(FILLED_ICONS.includes(name));
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	class="shrink-0"
>
	{#each ICON_PATHS[name] as d (d)}
		<path {d} fill={filled ? 'currentColor' : 'none'} />
	{/each}
</svg>
