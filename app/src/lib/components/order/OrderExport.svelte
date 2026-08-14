<script lang="ts">
	/**
	 * Exports the order as a document to print or hand over.
	 *
	 * Two documents, and the choice is really "who is this for". The client's
	 * copy is an account of their coffee — what they sent, what they asked to
	 * have packed, what came back. The mill's copy adds every process event and
	 * movimiento, which answers questions about the *work* and mostly says things
	 * a client has no use for.
	 *
	 * The modal asks that once and then opens the document, where the browser's
	 * own print dialogue writes the PDF.
	 */
	import Modal from '$lib/components/Modal.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let { code }: { code: string } = $props();

	let open = $state(false);
	let kind = $state<'produccion' | 'historial'>('produccion');

	const OPTIONS = [
		{
			value: 'produccion' as const,
			label: 'Orden de producción',
			note: 'Para el cliente: los lotes que envió, el empaque que pidió y lo que se empacó.'
		},
		{
			value: 'historial' as const,
			label: 'Historial completo',
			note: 'Lo anterior más trilla, selección, tostión y movimientos de lotes.'
		}
	];
</script>

<button
	type="button"
	onclick={() => (open = true)}
	class="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted transition
		hover:bg-accent-soft hover:text-accent"
>
	<Icon name="download" />
	Exportar
</button>

<Modal title="Exportar orden" bind:open>
	<div class="flex flex-col gap-2">
		{#each OPTIONS as option (option.value)}
			<button
				type="button"
				onclick={() => (kind = option.value)}
				aria-pressed={kind === option.value}
				class="rounded-md border px-4 py-3 text-left transition
					{kind === option.value
					? 'border-accent bg-accent-soft'
					: 'border-border hover:border-accent/40'}"
			>
				<span class="text-sm font-medium {kind === option.value ? 'text-accent' : 'text-text'}">
					{option.label}
				</span>
				<span class="mt-0.5 block text-xs text-muted">{option.note}</span>
			</button>
		{/each}
	</div>

	<div class="mt-5 flex gap-2">
		<!--
			A link, not a fetch: the document is a page of its own, so it can be
			printed, saved, sent as a URL, or simply read. It opens in a new tab so
			the order stays where it was.
		-->
		<a
			href="/ordenes/{code}/documento?tipo={kind}"
			target="_blank"
			rel="noopener"
			onclick={() => (open = false)}
			class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition
				hover:opacity-90"
		>
			Abrir documento
		</a>
		<button
			type="button"
			onclick={() => (open = false)}
			class="rounded-md border border-border px-4 py-2 text-sm text-muted transition
				hover:text-text"
		>
			Cancelar
		</button>
	</div>
</Modal>
