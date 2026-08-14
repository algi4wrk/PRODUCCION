<script lang="ts">
	/** App shell: the three top-level tabs the whole app lives inside. */
	import '../app.css';
	import { page } from '$app/state';
	import Icon from '$lib/components/Icon.svelte';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	/**
	 * Each tab decides for itself which paths belong to it, rather than the nav
	 * testing a prefix of `href`.
	 *
	 * A lot page lives at /lotes/[id] but is reached by drilling into an order,
	 * and its way back is that order — so ÓRDENES stays lit while you are down
	 * there. A prefix test lights LOTES ACTIVOS instead, which reads as though
	 * the floor board had opened.
	 */
	const TABS = [
		{
			href: '/ordenes',
			label: 'ÓRDENES',
			icon: 'clipboard',
			owns: (path: string) => path.startsWith('/ordenes') || path.startsWith('/lotes/')
		},
		{
			href: '/lotes',
			label: 'LOTES ACTIVOS',
			icon: 'box',
			owns: (path: string) => path === '/lotes'
		},
		{
			href: '/historial',
			label: 'HISTORIAL',
			icon: 'history',
			owns: (path: string) => path.startsWith('/historial')
		}
	] as const;

	const currentPath = $derived(page.url.pathname);

	/**
	 * The floor board is a wide table on a wall monitor, so it opts out of the
	 * reading-width container the rest of the app uses. Everything else stays
	 * capped, because a form stretched across 1920 px is unreadable — including
	 * /lotes/[id], which is a reading page rather than the board.
	 */
	const wide = $derived(currentPath === '/lotes');
	const container = $derived(wide ? 'max-w-none' : 'max-w-6xl');

	/**
	 * The hidden rail's arrow. Bigger everywhere it has margin to sit in, small
	 * on the board — that page runs its table to the edge, and a full-size arrow
	 * would sit on top of it.
	 */
	const arrowSize = $derived(wide ? 12 : 18);
</script>

<!--
	An icon rail down the left edge, hidden until the pointer reaches that edge.

	Nothing permanent is spent on chrome: the rail overlays the page rather than
	sitting in the flow, so every page is centred on the screen itself and a wide
	table never reflows when a mouse crosses the edge.

	A transparent strip along the edge is the trigger. It and the rail share a
	`group`, so moving from the strip onto the rail keeps it out.
-->
<div class="min-h-screen bg-bg">
	<!-- print:hidden — the rail is a way of getting around, and paper has none. -->
	<div data-app-nav class="group pointer-events-none fixed inset-y-0 left-0 z-30 flex print:hidden">
		<!-- The rail, parked off-screen. No `overflow-hidden`: the hover labels
		     have to escape its 56 px. -->
		<nav
			class="pointer-events-auto flex h-screen w-14 -translate-x-full flex-col items-center
				gap-1 border-r border-border bg-surface py-3 shadow-lg transition-transform
				duration-200 group-hover:translate-x-0"
		>
			{#each TABS as tab (tab.href)}
				{@const active = tab.owns(currentPath)}
				<!--
					Each entry is its own positioning context. Without the wrapper the
					labels are absolutely positioned flex children, which the spec places
					at the flex container's start corner — so all three land on top of
					each other in the top-left.
				-->
				<div class="group/tab relative flex shrink-0 items-center">
					<a
						href={tab.href}
						aria-label={tab.label}
						aria-current={active ? 'page' : undefined}
						class="flex h-10 w-10 items-center justify-center rounded-md transition-colors
							{active
							? 'bg-accent-soft text-accent'
							: 'text-muted hover:bg-accent-soft/50 hover:text-text'}"
					>
						<Icon name={tab.icon} size={18} />
					</a>

					<!-- The name, beside its own icon on hover. Not focusable, not
					     hit-testable: it only ever explains the icon it belongs to. -->
					<span
						class="pointer-events-none absolute left-full ml-3 rounded-md border
							border-border bg-surface px-2 py-1 text-xs font-medium tracking-wide
							whitespace-nowrap text-text opacity-0 shadow-sm transition-opacity
							group-hover/tab:opacity-100"
					>
						{tab.label}
					</span>
				</div>
			{/each}

			<!--
				The wordmark, set on its side at the foot of the rail. The rotation
				reads bottom-to-top, the convention for vertical type in Latin scripts —
				the way a book spine is set.
			-->
			<span
				class="mt-auto mb-6 shrink-0 text-lg font-semibold tracking-[0.25em] text-accent/70
					[writing-mode:vertical-rl] [transform:rotate(180deg)]"
			>
				PRODUCCIÓN
			</span>
		</nav>

		<!--
			The trigger: an invisible strip 100 px along the edge, so the rail opens
			as the pointer approaches rather than only when it lands on the edge.

			It follows the rail in the flex row, so the negative margin has to pull
			back the rail's whole width to land the strip on the edge itself — a
			smaller one would leave it floating where the rail's right side is.
		-->
		<div class="pointer-events-auto -ml-14 w-[100px]"></div>

		<!--
			The only permanent mark: a small tab on the edge, holding the three lines
			that mean "menu" and a chevron for which way it opens. It fades as the
			rail arrives, so the two are never both on screen, and it never takes a
			click — the strip behind it does that.
		-->
		<span
			class="pointer-events-none absolute top-1/2 left-0 flex -translate-y-1/2 items-center
				gap-0.5 rounded-r-md border border-l-0 border-border bg-surface py-2 pr-0.5 pl-1
				text-muted/70 shadow-sm transition-opacity duration-200 group-hover:opacity-0"
		>
			<Icon name="menu" size={arrowSize} />
			<!-- The chevron is the first thing dropped on the board, where the table
			     runs to within 24 px of the edge and the tab has to fit inside that. -->
			{#if !wide}
				<Icon name="chevronRight" size={arrowSize - 4} />
			{/if}
		</span>
	</div>

	<main class="mx-auto {container} px-6 py-8">
		{@render children()}
	</main>
</div>
