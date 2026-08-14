<script lang="ts">
	/**
	 * The printable document.
	 *
	 * Laid out for paper rather than for the app: no cards, no accent colour, one
	 * column, rules instead of borders. On screen it is the same page with a bar
	 * across the top — what you print is what you were looking at, which is the
	 * point of printing the page rather than generating a file from it.
	 *
	 * `print:` variants do the rest: the bar goes, the nav rail goes, and tables
	 * are told not to break a row across a page.
	 */
	import { page } from '$app/state';

	let { data } = $props();

	const title = $derived(data.full ? 'Historial completo' : 'Orden de producción');

	/** A section only prints if it has something in it. */
	const has = (rows: unknown[]) => rows.length > 0;
</script>

<svelte:head>
	<title>{data.order.code} — {title}</title>
</svelte:head>

<!-- Screen only: the way back, and the button that opens the print dialogue. -->
<div class="mb-6 flex flex-wrap items-center gap-3 print:hidden">
	<a href="/ordenes/{data.order.code}" class="text-sm text-muted transition hover:text-accent">
		← {data.order.code}
	</a>
	<div class="ml-auto flex items-center gap-2">
		<a
			href="?tipo={data.full ? 'produccion' : 'historial'}"
			class="rounded-md border border-border px-3 py-2 text-sm text-muted transition
				hover:text-text"
		>
			Ver {data.full ? 'orden de producción' : 'historial completo'}
		</a>
		<button
			type="button"
			onclick={() => window.print()}
			class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition
				hover:opacity-90"
		>
			Imprimir o guardar PDF
		</button>
	</div>
</div>

<article class="mx-auto max-w-4xl bg-surface px-8 py-8 text-text print:max-w-none print:px-0 print:py-0">
	<header class="flex items-start justify-between gap-6 border-b-2 border-text pb-3">
		<div class="flex items-center gap-4">
			<!--
				The client's mark, from `static/logo.png`. Hidden when the file is not
				there rather than left as a broken image: the document has to print
				either way, and a missing logo is no reason to hand someone a page with
				a torn-paper icon on it.
			-->
			<img
				src="/logo.png"
				alt=""
				onerror={(event) => ((event.currentTarget as HTMLImageElement).style.display = 'none')}
				class="h-16 w-16 shrink-0 object-contain print:h-14 print:w-14"
			/>
			<div>
				<h1 class="text-2xl font-semibold tracking-tight">PRODUCCIÓN</h1>
				<p class="mt-0.5 text-sm text-muted">{title}</p>
			</div>
		</div>
		<div class="text-right">
			<p class="font-mono text-lg font-semibold">{data.order.code}</p>
			<p class="text-sm text-muted">{data.order.date}</p>
		</div>
	</header>

	<!-- Who it is for and what kind of order it is. -->
	<dl class="mt-5 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
		{#each [['Cliente', data.order.client], ['Marca', data.order.brand], ['Tipo', data.order.type], ['Línea', data.order.productLine], ['Peel stick', data.order.peelStick], ['Estado', data.order.status]] as [label, value] (label)}
			<div>
				<dt class="text-xs tracking-wide text-muted uppercase">{label}</dt>
				<dd class="mt-0.5">{value}</dd>
			</div>
		{/each}
	</dl>

	{#if data.order.notes}
		<p class="mt-4 border-l-2 border-border pl-3 text-sm whitespace-pre-wrap text-muted">
			{data.order.notes}
		</p>
	{/if}

	{#snippet table(
		heading: string,
		columns: string[],
		rows: string[][],
		note?: string
	)}
		<section class="mt-7 break-inside-avoid">
			<h2 class="text-sm font-semibold tracking-wide uppercase">{heading}</h2>
			{#if note}<p class="mt-0.5 text-xs text-muted">{note}</p>{/if}

			<table class="mt-2 w-full border-collapse text-sm">
				<thead>
					<tr class="border-b border-text/60 text-left text-xs tracking-wide text-muted uppercase">
						{#each columns as column (column)}
							<th class="py-1.5 pr-4 font-medium last:pr-0">{column}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each rows as row, index (index)}
						<tr class="break-inside-avoid border-b border-border/70 last:border-0">
							{#each row as cell, cellIndex (cellIndex)}
								<td class="py-1.5 pr-4 align-top last:pr-0">{cell}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/snippet}

	<!-- What the client sent. -->
	{@render table(
		'Materia prima',
		['Lote', 'Materia prima', 'Beneficio', 'Humedad', 'Peso inicial', 'Peso actual', 'Estado'],
		data.lots.map((lot) => [
			lot.lot,
			lot.rawMaterial,
			lot.process,
			lot.humidity,
			`${lot.initial} kg`,
			`${lot.current} kg`,
			lot.status
		])
	)}

	<!-- What they asked for, against what came back. -->
	{#if has(data.plan)}
		{@render table(
			'Empaque solicitado',
			['Presentación', 'Variedad', 'Solicitado', 'Empacado', 'Pendiente', 'Peso solicitado'],
			data.plan.map((line) => [
				line.presentation,
				line.variety,
				line.planned,
				line.packed,
				line.pending,
				`${line.kilos} kg`
			])
		)}
	{/if}

	{#if has(data.packed)}
		{@render table(
			'Empacado',
			['Fecha', 'Lote', 'Presentación', 'Cantidad', 'Peso', 'Bolsa', 'Inspección'],
			data.packed.map((event) => [
				event.date,
				event.lot,
				event.presentation,
				event.quantity,
				`${event.kilos} kg`,
				event.bag,
				event.inspection
			])
		)}
	{/if}

	<!-- The account in one line each. -->
	<section class="mt-7 break-inside-avoid border-t-2 border-text pt-3">
		<h2 class="text-sm font-semibold tracking-wide uppercase">Resumen</h2>
		<dl class="mt-2 grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm sm:grid-cols-3">
			{#each [['Café recibido', `${data.totals.received} kg`], ['Estimado tostado', `${data.totals.estimated} kg`], ['Merma', data.totals.merma], ['Empaque solicitado', `${data.totals.planned} kg`], ['Empacado', `${data.totals.packed} kg`]] as [label, value] (label)}
				<div class="flex justify-between gap-4 border-b border-border/70 py-0.5">
					<dt class="text-muted">{label}</dt>
					<dd class="font-medium tabular-nums">{value}</dd>
				</div>
			{/each}
		</dl>
	</section>

	<!-- The mill's own record, only on the full document. -->
	{#if data.full}
		{#if has(data.events.trillas)}
			{@render table(
				'Trilla',
				['Fecha', 'Lote', 'Pergamino', 'Almendra', 'Mallas', 'Cisco', 'Responsable'],
				data.events.trillas.map((event) => [
					event.date,
					event.lot,
					`${event.parchment} kg`,
					`${event.green} kg`,
					event.screens,
					`${event.merma} kg`,
					event.staff
				])
			)}
		{/if}

		{#if has(data.events.selecciones)}
			{@render table(
				'Selección',
				['Fecha', 'Lote', 'Etapa', 'Entra', 'Seleccionado', 'Retirado', 'Responsable'],
				data.events.selecciones.map((event) => [
					event.date,
					event.lot,
					event.stage,
					`${event.total} kg`,
					`${event.net} kg`,
					`${event.removed} kg`,
					event.staff
				])
			)}
		{/if}

		{#if has(data.events.tostiones)}
			{@render table(
				'Tostión',
				['Fecha', 'Lote', 'Tueste', 'Bache', 'Tostado', 'Merma', 'Responsable'],
				data.events.tostiones.map((event) => [
					event.date,
					event.lot,
					event.roastType,
					`${event.batch} kg`,
					`${event.roasted} kg`,
					`${event.merma} kg`,
					event.staff
				])
			)}
		{/if}

		{#if has(data.events.movements)}
			{@render table(
				'Movimientos de lotes',
				['Fecha', 'Acción', 'Origen', 'Destino', 'Peso', 'Responsable', 'Registro'],
				data.events.movements.map((movement) => [
					movement.date,
					movement.action,
					movement.origins,
					movement.destination,
					`${movement.kilos} kg`,
					movement.staff,
					movement.source
				])
			)}
		{/if}
	{/if}

	<footer class="mt-8 border-t border-border pt-2 text-xs text-muted">
		Impreso el {data.printedOn} · {page.url.host}
	</footer>
</article>
