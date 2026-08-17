<script lang="ts">
	/**
	 * Read-only data table used across the order detail page and list views.
	 *
	 * Scrolls inside its own container so a wide table never makes the page
	 * scroll sideways.
	 *
	 * Everything aligns left, headers included — the same convention as the floor
	 * board. Numeric columns only get `tabular-nums`, so their digits still line
	 * up under each other without the column jumping to the right edge.
	 */
	import type { Snippet } from 'svelte';
	import Badge from './Badge.svelte';
	import type { BadgeTone } from '$lib/domain/status';

	let {
		columns,
		rows,
		empty = 'Sin registros.',
		onRowClick,
		badge,
		rowAction,
		rowActionLabel,
		rowMark
	}: {
		columns: readonly { key: string; label: string; unit?: string; numeric?: boolean }[];
		rows: Record<string, string>[];
		empty?: string;
		onRowClick?: (index: number) => void;
		/**
		 * Which cells read as a state rather than as a value, and in what tone.
		 * Returning a tone draws the cell as a badge; returning nothing leaves it
		 * as text. A function rather than a list of columns, because the tone
		 * depends on the value — PAUSADA is not the same colour as TERMINADA.
		 */
		badge?: (key: string, value: string) => BadgeTone | undefined;
		/**
		 * A control at the end of every row — a lot's next step, HISTORIAL's
		 * Reanudar. `rowActionLabel` heads the column when the control is a value
		 * in its own right; without one the column stays unheaded, which suits a
		 * button that only says what it does.
		 */
		rowAction?: Snippet<[number]>;
		rowActionLabel?: string;
		/**
		 * A mark drawn before the first cell — the lot-state icons. Given the row,
		 * so the table itself stays ignorant of what it is listing.
		 */
		rowMark?: Snippet<[Record<string, string>]>;
	} = $props();
</script>

{#if rows.length === 0}
	<p class="px-4 py-6 text-center text-sm text-muted">{empty}</p>
{:else}
	<div class="overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b border-border text-left text-xs text-muted uppercase">
					{#each columns as column (column.key)}
						<th class="px-4 py-2 font-medium whitespace-nowrap">{column.label}</th>
					{/each}
					{#if rowAction}
						<th class="px-2 py-2 font-medium whitespace-nowrap">
							{#if rowActionLabel}
								{rowActionLabel}
							{:else}
								<span class="sr-only">Acciones</span>
							{/if}
						</th>
					{/if}
				</tr>
			</thead>
			<tbody>
				{#each rows as row, index (index)}
					<!-- `group` so a row action can appear only while this row is hovered. -->
					<tr
						class="group border-b border-border/60 last:border-0 {onRowClick
							? 'cursor-pointer hover:bg-accent-soft/40'
							: ''}"
						onclick={onRowClick ? () => onRowClick(index) : undefined}
					>
						{#each columns as column, columnIndex (column.key)}
							{@const tone = badge?.(column.key, row[column.key] ?? '')}
							<!-- No wrapping: a table of many columns wraps every cell to two
							     lines long before it runs out of room, and this one already
							     scrolls sideways when it genuinely does. -->
							<td
								class="px-4 py-2 whitespace-nowrap text-text {column.numeric
									? 'tabular-nums'
									: ''}"
							>
								{#if tone}
									<Badge text={row[column.key] ?? '—'} {tone} />
								{:else if columnIndex === 0 && rowMark}
									<span class="flex items-center gap-2">
										{@render rowMark(row)}
										<span>{row[column.key] ?? '—'}</span>
									</span>
								{:else}
									{row[column.key] ?? '—'}{column.unit && row[column.key]
										? ` ${column.unit}`
										: ''}
								{/if}
							</td>
						{/each}
						{#if rowAction}
							<!-- z-10 so it stays clickable above a row that is itself a link. -->
							<!-- Left, like every other column: these read as a cell's value
							     (a lot's next step), not as a control parked at the edge. -->
							<td class="relative z-10 px-2 py-2 text-left">
								{@render rowAction(index)}
							</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
