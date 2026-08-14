<script lang="ts">
	/**
	 * A nested child table inside a parent form — MATERIA PRIMA (lots) and
	 * TIPOS DE EMPAQUE (references).
	 *
	 * Rows are held in form state and only written when the parent order is
	 * saved, so abandoning the form leaves no orphan lots behind. That orphan
	 * case is unavoidable in AppSheet, where a child row is written the moment
	 * its sub-form is submitted.
	 *
	 * Arbitrary row counts are the whole point: this is the "dynamic data size"
	 * the source app could not express.
	 */
	import Form from './Form.svelte';
	import Modal from '../Modal.svelte';
	import { validateRow, type FieldDef, type FormRow } from '$lib/fields/types';

	let {
		title,
		fields,
		rows = $bindable(),
		columns,
		formatRow,
		newRow,
		emptyMessage = 'Aún no hay registros.',
		addLabel = '+ Nuevo',
		idPrefix,
		onCreateRef,
		draft = $bindable(null)
	}: {
		title: string;
		fields: FieldDef[];
		rows: FormRow[];
		columns: readonly { key: string; label: string; unit?: string }[];
		/** Turns a stored row into the strings shown in the summary table. */
		formatRow: (row: FormRow, index: number) => Record<string, string>;
		/** Produces a blank row with sensible defaults. */
		newRow: () => FormRow;
		emptyMessage?: string;
		addLabel?: string;
		idPrefix: string;
		/** Forwarded to the sub-form so its ref fields can offer "+ Nuevo". */
		onCreateRef?: (fieldName: string) => void;
		/**
		 * The row currently open in the sub-form, or null when it is closed.
		 * Bindable so the page can write into it — needed when an inline "+ Nuevo"
		 * creates a record that should then be selected in the open draft.
		 */
		draft?: FormRow | null;
	} = $props();

	/** Index being edited; null means the draft is a new row. */
	let editingIndex = $state<number | null>(null);
	let errors = $state<Record<string, string>>({});

	function openNew() {
		draft = newRow();
		editingIndex = null;
		errors = {};
	}

	function openEdit(index: number) {
		draft = { ...rows[index] };
		editingIndex = index;
		errors = {};
	}

	function cancel() {
		// Blur first: a focused field's blur handler writes back into the draft
		// (NumberField reformats there), and if the draft is already gone that
		// write lands on null and throws.
		(document.activeElement as HTMLElement | null)?.blur?.();

		draft = null;
		editingIndex = null;
		errors = {};
	}

	function save() {
		if (!draft) return;
		errors = validateRow(fields, draft);
		if (Object.keys(errors).length > 0) return;

		if (editingIndex === null) {
			rows = [...rows, draft];
		} else {
			rows = rows.map((row, index) => (index === editingIndex ? draft! : row));
		}
		cancel();
	}

	function remove(index: number) {
		rows = rows.filter((_, i) => i !== index);
	}
</script>

<section class="rounded-lg border border-border bg-surface">
	<header class="flex items-center justify-between border-b border-border px-4 py-3">
		<h3 class="text-sm font-semibold tracking-wide text-text uppercase">{title}</h3>
		<button
			type="button"
			onclick={openNew}
			class="rounded-md border border-accent/40 bg-accent-soft px-3 py-1.5 text-sm
				font-medium text-accent transition hover:border-accent"
		>
			{addLabel}
		</button>
	</header>

	{#if rows.length === 0}
		<p class="px-4 py-6 text-center text-sm text-muted">{emptyMessage}</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-border text-left text-xs text-muted uppercase">
						{#each columns as column (column.key)}
							<th class="px-4 py-2 font-medium">{column.label}</th>
						{/each}
						<th class="px-4 py-2"><span class="sr-only">Acciones</span></th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row, index (index)}
						{@const cells = formatRow(row, index)}
						<tr class="border-b border-border/60 last:border-0">
							{#each columns as column (column.key)}
								<td class="px-4 py-2 text-text">
									{cells[column.key] ?? '—'}{column.unit && cells[column.key]
										? ` ${column.unit}`
										: ''}
								</td>
							{/each}
							<td class="px-4 py-2 text-right whitespace-nowrap">
								<button
									type="button"
									onclick={() => openEdit(index)}
									class="text-xs text-muted transition hover:text-accent">Editar</button
								>
								<button
									type="button"
									onclick={() => remove(index)}
									class="ml-3 text-xs text-muted transition hover:text-red-600">Quitar</button
								>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

</section>

<!-- The sub-form opens in a modal so a long row of fields never pushes the rest
     of the order off screen, and so editing a row feels the same as adding one. -->
<Modal
	title={editingIndex === null ? `${title} — nuevo` : `${title} — editar`}
	open={draft !== null}
	onClose={cancel}
	size="wide"
>
	{#if draft}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			onkeydown={(event) => {
				const target = event.target as HTMLElement;
				if (event.key === 'Enter' && target.tagName !== 'TEXTAREA') event.preventDefault();
			}}
		>
			<Form {fields} bind:row={draft} {errors} idPrefix={`${idPrefix}-draft`} {onCreateRef} />
		</div>

		<div class="mt-5 flex gap-2">
			<button
				type="button"
				onclick={save}
				class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition
					hover:opacity-90"
			>
				{editingIndex === null ? 'Agregar' : 'Guardar cambios'}
			</button>
			<button
				type="button"
				onclick={cancel}
				class="rounded-md border border-border px-4 py-2 text-sm text-muted transition
					hover:text-text"
			>
				Cancelar
			</button>
		</div>
	{/if}
</Modal>
