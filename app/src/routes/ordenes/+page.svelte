<script lang="ts">
	/**
	 * Order queue. Clicking a row opens that order's page, and "+ Nueva orden"
	 * opens the creation form over the list rather than navigating away from it.
	 */
	import Badge from '$lib/components/Badge.svelte';
	import OrderCreate from '$lib/components/order/OrderCreate.svelte';
	import { formatDate } from '$lib/domain/derived';

	let { data } = $props();

	let creating = $state(false);
</script>

<div class="mb-6 flex items-center justify-between">
	<div>
		<h1 class="text-xl font-semibold text-text">Órdenes en Proceso</h1>
		<p class="mt-1 text-sm text-muted">
			{data.orders.length} en cola · prioridad primero, luego por fecha
		</p>
	</div>

	<button
		type="button"
		onclick={() => (creating = true)}
		class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
	>
		+ Nueva orden
	</button>
</div>

<div class="overflow-hidden rounded-lg border border-border bg-surface">
	{#if data.orders.length === 0}
		<p class="px-4 py-10 text-center text-sm text-muted">
			No hay órdenes todavía. Cree la primera con "Nueva orden".
		</p>
	{:else}
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b border-border text-left text-xs text-muted uppercase">
					<th class="px-4 py-3 font-medium">#</th>
					<th class="px-4 py-3 font-medium">Orden</th>
					<th class="px-4 py-3 font-medium">Cliente</th>
					<th class="px-4 py-3 font-medium">Tipo</th>
					<th class="px-4 py-3 font-medium">Fecha</th>
					<th class="px-4 py-3 font-medium">Lotes</th>
				</tr>
			</thead>
			<tbody>
				{#each data.orders as order (order.id)}
					<!--
						The whole row opens the order. A stretched link rather than a click
						handler on the <tr>, so it stays keyboard-reachable and reads as a
						link; the <tr> is the positioning context it stretches across.
					-->
					<tr
						class="group relative cursor-pointer border-b border-border/60 transition
							last:border-0 hover:bg-accent-soft/40"
					>
						<td class="px-4 py-3 text-muted tabular-nums">{order.position}</td>
						<td class="px-4 py-3">
							<a
								href="/ordenes/{order.code}"
								class="font-medium text-accent after:absolute after:inset-0
									group-hover:underline focus-visible:outline-2
									focus-visible:outline-offset-2 focus-visible:outline-accent"
							>
								{order.code}
							</a>
							{#if order.priority}
								<span class="ml-2"><Badge text="PRIORIDAD" tone="priority" /></span>
							{/if}
						</td>
						<td class="px-4 py-3 text-text">{order.label}</td>
						<td class="px-4 py-3 text-muted">{order.type}</td>
						<td class="px-4 py-3 text-muted tabular-nums">{formatDate(order.date)}</td>
						<td class="px-4 py-3 text-muted tabular-nums">{order.lotCount}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>

<OrderCreate {data} bind:open={creating} />
