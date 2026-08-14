<script lang="ts">
	/**
	 * HISTORIAL — a query, and its results.
	 *
	 * The filter is a panel at the top rather than a modal behind a button: it is
	 * the subject of the page, not an aside to it. A modal would hide the current
	 * query behind a click at exactly the moment it matters — reading a table of
	 * 200 empaques and wondering which client it is for — and would need its own
	 * summary line to make up for it, which is the panel again with extra steps.
	 *
	 * Every change writes to the URL and the server re-runs the query. That keeps
	 * one source of truth, makes a query linkable, and is what the export will
	 * hand to a spreadsheet: same parameters, different renderer.
	 */
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { announceOnSuccess } from '$lib/enhanceWithAnnounce';
	import Section from '$lib/components/Section.svelte';
	import Table from '$lib/components/Table.svelte';
	import Form from '$lib/components/form/Form.svelte';
	import { historialFields } from '$lib/fields/historial';
	import { statusTone } from '$lib/domain/status';
	import type { FormRow } from '$lib/fields/types';
	import type { OrderStatus } from '$lib/domain/vocabulary';

	let { data } = $props();

	/**
	 * The panel's own state, re-seeded from the URL on every load — which is what
	 * makes the Back button work: the query is in the address, and the panel
	 * follows it rather than the other way round.
	 */
	let filter = $state<FormRow>({});

	$effect(() => {
		filter = { ...data.filter };
	});

	const fields = $derived(historialFields(data.options));

	/** The query as the URL spells it — blank fields drop out entirely. */
	function queryString(row: FormRow): string {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(row)) {
			const text = String(value ?? '').trim();
			// `ordenes` is the default view and needs no parameter.
			if (!text || (key === 'vista' && text === 'ordenes')) continue;
			params.set(key, text);
		}
		return params.toString();
	}

	/**
	 * Applies the panel to the URL when it actually changes.
	 *
	 * Compared as strings rather than tracked field by field: the panel is
	 * rewritten wholesale on every load, and anything finer would navigate in
	 * response to its own navigation.
	 */
	$effect(() => {
		const next = queryString(filter);
		if (next === page.url.searchParams.toString()) return;
		goto(next ? `?${next}` : '/historial', {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	});

	const clear = () => (filter = { vista: 'ordenes', cliente: '', orden: '', estado: '', desde: '', hasta: '' });

	/** True on the órdenes view, where a paused row can be resumed in place. */
	const showsOrders = $derived(data.result.statuses.length > 0);
</script>

<div class="mb-6">
	<h1 class="text-xl font-semibold text-text">Historial</h1>
	<p class="mt-1 text-sm text-muted">
		Todos los registros, en cualquier estado — por orden, cliente, fecha o proceso
	</p>
</div>

<div class="flex flex-col gap-6">
	<Section title="Filtro">
		<div class="px-4 py-4">
			<Form {fields} bind:row={filter} idPrefix="filtro" />

			<div class="mt-4 flex items-center justify-between">
				<p class="text-sm text-muted">
					{data.result.rows.length}
					{data.result.rows.length === 1 ? 'registro' : 'registros'}
				</p>
				<button
					type="button"
					onclick={clear}
					class="rounded-md border border-border px-3 py-1.5 text-sm text-muted transition
						hover:text-text"
				>
					Limpiar
				</button>
			</div>
		</div>
	</Section>

	<div class="overflow-hidden rounded-lg border border-border bg-surface">
		<!--
			The columns come with the rows: a trilla and an order share nothing worth
			putting in one table, so the view decides them. A row opens whatever it is
			about — the order, or the lot the event acted on.
		-->
		<!--
			Reanudar only exists for paused orders, so only the órdenes view passes
			the snippet at all: passing it always left every other view with an empty
			column reserved against a button that never comes, and the cells wrapping
			to two lines to pay for it.
		-->
		{#snippet resume(index: number)}
			{#if data.result.statuses[index] === 'PAUSADA'}
				<form method="POST" action="?/resume" use:enhance={announceOnSuccess}>
					<input type="hidden" name="id" value={data.result.ids[index]} />
					<button
						type="submit"
						class="rounded-md border border-accent/40 px-3 py-1 text-xs font-medium
							text-accent transition hover:border-accent"
					>
						Reanudar
					</button>
				</form>
			{/if}
		{/snippet}

		<Table
			columns={data.result.columns}
			rows={data.result.rows}
			empty="Ningún registro con este filtro."
			onRowClick={(index) => goto(data.result.links[index])}
			badge={(key, value) => (key === 'status' ? statusTone(value as OrderStatus) : undefined)}
			rowAction={showsOrders ? resume : undefined}
		/>
	</div>
</div>
