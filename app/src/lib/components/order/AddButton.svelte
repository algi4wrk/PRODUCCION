<script lang="ts">
	/**
	 * The "+ Nuevo" trigger at the foot of each section on the order page.
	 *
	 * Deliberately quiet: no border, no fill, muted until hovered. Adding a lot
	 * is an occasional act, and three filled buttons down the page would compete
	 * with the tables they belong to.
	 *
	 * Always "+ Nuevo", never "+ Nuevo lote": the section it sits in already says
	 * what is being added, and three different labels down one page read as three
	 * different kinds of action.
	 */
	let { onclick }: { onclick: () => void } = $props();
</script>

<button
	type="button"
	{onclick}
	class="rounded-md px-2 py-1 text-xs font-medium text-muted transition
		hover:bg-accent-soft hover:text-accent"
>
	+ Nuevo
</button>
