<script lang="ts">
	/**
	 * LOTES ACTIVOS — the floor board, for a wall monitor.
	 *
	 * Designed to be read standing several metres away rather than clicked:
	 * larger type than the rest of the app, and PASO SIGUIENTE colour-coded,
	 * because at that distance colour carries further than text.
	 *
	 * One table for every order, with orders as full-width group rows, so the
	 * columns line up down the whole board. Separate tables per order let each
	 * size its own columns, and the misalignment is obvious on a big screen.
	 *
	 * It refreshes itself, since nobody is going to walk over and reload it.
	 */
	import { invalidateAll } from '$app/navigation';
	import { formatDate } from '$lib/domain/derived';
	import FullscreenButton from '$lib/components/FullscreenButton.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import LotMark from '$lib/components/LotMark.svelte';
	import { STEP_TONES } from '$lib/stepTones';
	import { LOT_ROW_COLUMNS } from '$lib/domain/lotRow';
	import { liveRefresh } from '$lib/realtime';

	let { data } = $props();

	/**
	 * Orders whose lots are hidden, by id.
	 *
	 * Collapsed rather than open is what gets stored, so an order arriving in a
	 * later refresh shows its lots by default — the board's job is to show work,
	 * and a new order appearing folded shut could go unnoticed. The state lives
	 * in the component, so it survives a refetch but not a reload; nothing about
	 * one screen's folding belongs in the database.
	 */
	let collapsed = $state(new Set<number>());

	function toggle(orderId: number) {
		// Reassigned rather than mutated: a Set is not deeply reactive.
		const next = new Set(collapsed);
		if (!next.delete(orderId)) next.add(orderId);
		collapsed = next;
	}

	/**
	 * Breaks the one step long enough to need it, before "MALLA(S)".
	 *
	 * The box can only hug wrapped text if the break is explicit: an inline-block
	 * that wraps on its own takes the full column width, leaving dead space to
	 * the right. With a real newline plus `w-max`, the box is exactly as wide as
	 * its longest line.
	 */
	function withBreaks(step: string): string {
		return step
			.replace(' MALLA(S) ', '\nMALLA(S) ')
			// "TERMINAR SELECCION VERDE" is the longest step there is, and the column
			// is a fifteenth of the board.
			.replace(/^TERMINAR /, 'TERMINAR\n');
	}


	/**
	 * Vista amplia — the board read from across the room.
	 *
	 * Drops every column after Tostión and enlarges what is left. The columns
	 * that go are the ones nobody reads at four metres: reception facts that
	 * never change, merma, and lineage. What stays is what the floor acts on —
	 * which lot, what it needs next, what it is holding, and how it is to be
	 * sorted and roasted.
	 *
	 * Kept in `localStorage` rather than in the URL: it is a property of *this
	 * screen*, not of what is being looked at, and the wall monitor has to come
	 * back the way it was after a reload or a power cut without anybody driving
	 * to the mill to press a button.
	 */
	const WIDE_KEY = 'lotes:vista-amplia';
	let wide = $state(false);

	// No reactive dependencies, so it runs once, on mount.
	$effect(() => {
		wide = localStorage.getItem(WIDE_KEY) === '1';
	});

	function toggleWide() {
		wide = !wide;
		localStorage.setItem(WIDE_KEY, wide ? '1' : '0');
	}

	/**
	 * The columns come from `LOT_ROW_COLUMNS`, shared with the order page's
	 * Materia prima table; only the widths are the board's own, since it is the
	 * one that has a whole monitor to fill.
	 */
	const WIDTHS: Record<string, string> = {
		lote: 'w-[16%]',
		step: 'w-[15%]',
		greenKilos: 'w-[6%]',
		roastedKilos: 'w-[6%]',
		selection: 'w-[8%]',
		roastType: 'w-[11%]',
		rawMaterial: 'w-[6%]',
		initialWeight: 'w-[6%]',
		merma: 'w-[6%]',
		mermaPercent: 'w-[6%]',
		originLots: 'w-[7%]',
		createdLots: 'w-[7%]'
	};

	/** The six that survive vista amplia, re-proportioned to fill the width. */
	const WIDE_WIDTHS: Record<string, string> = {
		lote: 'w-[26%]',
		step: 'w-[22%]',
		greenKilos: 'w-[9%]',
		roastedKilos: 'w-[9%]',
		selection: 'w-[14%]',
		roastType: 'w-[20%]'
	};

	// Only the keys with a width belong on the board; the rest are the order
	// page's business.
	const COLUMNS = $derived.by(() => {
		const widths = wide ? WIDE_WIDTHS : WIDTHS;
		return LOT_ROW_COLUMNS.filter((column) => widths[column.key]).map((column) => ({
			...column,
			width: widths[column.key]
		}));
	});

	/**
	 * The type scale, in one place: every size on the board moves together, so
	 * the two modes are one design at two distances rather than two designs.
	 */
	const SIZES = $derived(
		wide
			? {
					table: 'text-2xl',
					head: 'px-4 py-3 text-base',
					cell: 'px-4 py-3.5',
					step: 'text-lg',
					group: 'text-lg',
					code: 'text-base',
					mark: 24
				}
			: {
					table: 'text-sm',
					head: 'px-3 py-2.5 text-xs',
					cell: 'px-3 py-2',
					step: 'text-xs',
					group: 'text-sm',
					code: 'text-xs',
					mark: 16
				}
	);

	/**
	 * Keeps itself current: at once for other windows of this browser, and on a
	 * timer for anything a broadcast cannot reach — the second computer, a phone.
	 * Nobody is going to walk over to the wall monitor and press reload.
	 *
	 * TEMPORARY, the timer half — see `liveRefresh`. It becomes a subscription
	 * the day a write can be announced from the server.
	 */
	const REFRESH_MS = 15_000;

	$effect(() => liveRefresh(() => invalidateAll(), REFRESH_MS));
</script>

<div data-board-header class="mb-4 flex flex-wrap items-center justify-between gap-3">
	<h1 class="text-xl font-semibold text-text">Lotes Activos</h1>
	<div class="flex items-center gap-3">
		<p class="text-sm text-muted">Actualizado {formatDate(data.refreshedAt)}</p>
		<!-- Menos columnas y letra más grande, para leer el tablero de lejos. -->
		<button
			type="button"
			onclick={toggleWide}
			title={wide ? 'Mostrar todas las columnas' : 'Menos columnas, letra más grande'}
			class="rounded-md border px-3 py-1.5 text-xs transition
				{wide
				? 'border-accent/40 text-accent'
				: 'border-border text-muted hover:border-accent/40 hover:text-accent'}"
		>
			▤ Vista amplia
		</button>
		<FullscreenButton />
	</div>
</div>

{#if data.orders.length === 0}
	<div class="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
		<p class="text-base text-muted">No hay órdenes en proceso.</p>
	</div>
{:else}
	<div data-board-card class="overflow-hidden rounded-lg border border-border bg-surface">
		<table class="w-full table-fixed {SIZES.table}">
			<thead class="sticky top-0 z-10 bg-surface">
				<tr class="border-b border-border text-left tracking-wide text-muted uppercase">
					{#each COLUMNS as column (column.key)}
						<!--
							Headers all align left. A faint left divider on each marks where
							the column starts, so the eye can follow one down the board
							without ruling every row, which reads as noise at this size.
						-->
						<th
							class="border-l border-border/50 font-medium first:border-l-0
								{SIZES.head} {column.width}"
						>
							{column.label}
						</th>
					{/each}
				</tr>
			</thead>

			{#each data.orders as order (order.id)}
				<tbody>
					<!--
						Order group header, spanning the full width. Deliberately quiet: it
						only says which order the rows below belong to, and the lots are what
						the floor reads. A louder bar competes with PASO SIGUIENTE.
					-->
					<tr
						class="cursor-pointer border-y border-border bg-border/25 transition
							hover:bg-accent-soft/40"
						onclick={() => toggle(order.id)}
					>
						<td colspan={COLUMNS.length} class={SIZES.cell}>
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="flex flex-wrap items-center gap-2.5">
								<!--
									Folds an order away when the floor is not working it, so a long
									board still fits one screen.

									The whole row is the control now: on a wall monitor nobody is
									aiming at a chevron, and the order name led somewhere the board
									is not for — this page is the floor, not the paperwork.
								-->
								<button
									type="button"
									onclick={() => toggle(order.id)}
									aria-expanded={!collapsed.has(order.id)}
									title={collapsed.has(order.id) ? 'Mostrar lotes' : 'Ocultar lotes'}
									class="rounded p-0.5 text-muted transition hover:bg-accent-soft hover:text-accent"
								>
									<Icon name={collapsed.has(order.id) ? 'chevronRight' : 'chevronDown'} size={16} />
								</button>

								<span class="font-medium text-muted {SIZES.group}">{order.label}</span>
								<span class="font-mono text-muted/80 {SIZES.code}">{order.code}</span>
								{#if order.priority}
									<span
										class="rounded-full bg-red-100 px-2 py-0.5 text-[0.7rem] font-semibold
											text-red-800 dark:bg-red-950 dark:text-red-300"
									>
										PRIORIDAD
									</span>
								{/if}
								<span class="ml-auto text-xs text-muted/80">
									{order.lots.length}
									{order.lots.length === 1 ? 'lote' : 'lotes'}
								</span>
							</div>
						</td>
					</tr>

					{#if collapsed.has(order.id)}
						<!-- Folded: the group row above stands in for its lots. -->
					{:else if order.lots.length === 0}
						<tr>
							<td colspan={COLUMNS.length} class="px-3 py-4 text-center text-muted">
								Sin lotes activos en esta orden.
							</td>
						</tr>
					{:else}
						{#each order.lots as lot (lot.id)}
							<tr class="border-b border-border/60">
								{#each COLUMNS as column (column.key)}
									{@const value = lot[column.key as keyof typeof lot]}
									<td
										class="{SIZES.cell} {'numeric' in column && column.numeric
											? 'tabular-nums'
											: ''}"
									>
										{#if column.key === 'step'}
											<!--
												One box around the whole step. `w-max` + an explicit newline
												sizes it to its longest line; without the newline a wrapped
												inline-block fills the column and leaves dead space right.
											-->
											<span
												class="inline-block w-max rounded px-2 py-0.5 font-semibold
													whitespace-pre-line {SIZES.step} {STEP_TONES[lot.stepTone]}"
											>
												{withBreaks(String(value))}
											</span>
										{:else if column.key === 'lote'}
											<span class="flex items-center gap-2 font-medium text-text">
												<LotMark status={lot.status} size={SIZES.mark} />
												{value}
											</span>
										{:else}
											<span class="text-muted">{value}</span>
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					{/if}
				</tbody>
			{/each}
		</table>
	</div>
{/if}
