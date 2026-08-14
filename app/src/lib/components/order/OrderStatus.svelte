<script lang="ts">
	/**
	 * The order's actions, as a row of bare controls for the page header.
	 *
	 * No boxes: they sit in the empty space beside the order code rather than in
	 * a bar of their own, so the page opens on its contents instead of on its
	 * chrome. The icon carries the meaning and the colour carries the state;
	 * hover is what tells you they are pressable.
	 *
	 * Status and priority are both entirely manual. Nothing derives TERMINADA
	 * from the lots, by explicit decision — the operator decides when an order
	 * is done.
	 */
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import { announceOnSuccess } from '$lib/enhanceWithAnnounce';
	import { announceChange } from '$lib/realtime';
	import { finishAction, pauseAction } from '$lib/domain/status';
	import type { OrderStatus } from '$lib/domain/vocabulary';

	import type { Snippet } from 'svelte';

	let {
		status,
		priority,
		code,
		edit
	}: {
		status: OrderStatus;
		priority: boolean;
		/** The order's code, so the delete confirmation names which one. */
		code: string;
		/** The edit control, passed in so this component stays about status. */
		edit?: Snippet;
	} = $props();

	/** Pausar while the order runs, Reanudar while it does not. */
	const pause = $derived(pauseAction(status));
	const finish = $derived(finishAction(status));
	const finished = $derived(status === 'TERMINADA');

	/** Shared shape. Only the hover colour differs between the actions. */
	const BARE =
		'flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition disabled:cursor-default';

	/** Guards the delete: nothing is posted until the dialog is confirmed. */
	let confirmingDelete = $state(false);
</script>

<div class="flex flex-wrap items-center gap-1">
	<!-- A finished order has nothing to pause, and the lit Terminada beside it is
	     already the way back, so the control would only repeat it. -->
	{#if !finished}
		<form method="POST" action="?/setStatus" use:enhance={announceOnSuccess}>
			<input type="hidden" name="status" value={pause.status} />
			<button type="submit" class="{BARE} text-muted hover:bg-accent-soft hover:text-accent">
				<Icon name={pause.icon} />
				{pause.label}
			</button>
		</form>
	{/if}

	<form method="POST" action="?/setStatus" use:enhance={announceOnSuccess}>
		<input type="hidden" name="status" value={finish.status} />
		<!-- Lit while finished, and still pressable: pressing it again reopens the
		     order, so finishing one by mistake is undone where it was done. -->
		<button
			type="submit"
			aria-pressed={finished}
			title={finish.hint}
			class="{BARE} {finished
				? 'bg-accent-soft font-medium text-accent'
				: 'text-muted hover:bg-accent-soft hover:text-accent'}"
		>
			<Icon name={finish.icon} />
			{finish.label}
		</button>
	</form>

	{#if edit}{@render edit()}{/if}

	<form method="POST" action="?/togglePriority" use:enhance={announceOnSuccess}>
		<input type="hidden" name="priority" value={String(!priority)} />
		<button
			type="submit"
			class="{BARE} {priority
				? 'bg-priority-soft font-medium text-priority'
				: 'text-muted hover:bg-priority-soft hover:text-priority'}"
		>
			<!-- The struck-through flag reads as "take it down", matching the label. -->
			<Icon name={priority ? 'flagOff' : 'flag'} />
			{priority ? 'Quitar prioridad' : 'Priorizar'}
		</button>
	</form>

	<form
		method="POST"
		action="?/delete"
		use:enhance={() => {
			// A delete redirects away, so announce here rather than on the result.
			announceChange();
		}}
	>
		<button
			type="button"
			onclick={() => (confirmingDelete = true)}
			class="{BARE} text-muted hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50"
		>
			<Icon name="trash" />
			Eliminar
		</button>

		<ConfirmDialog
			bind:open={confirmingDelete}
			title="Eliminar orden"
			subject="la orden {code}"
		/>
	</form>
</div>
