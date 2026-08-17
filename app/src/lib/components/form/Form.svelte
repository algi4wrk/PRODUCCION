<script lang="ts">
	/**
	 * Renders a FieldDef[] as a two-column grid.
	 *
	 * Hidden fields (AppSheet's `Show?`) disappear entirely rather than being
	 * greyed out, and are never validated — a field the operator cannot see must
	 * never block a save.
	 *
	 * Fields carrying a `group` are rendered under a subheading, so a long form
	 * reads as a few short ones. A heading only appears if the group has at least
	 * one visible field.
	 *
	 * The `extra` snippet is the escape hatch: anything that does not fit the
	 * generic path is rendered by the caller instead of forcing this component
	 * to grow a special case.
	 */
	import type { Snippet } from 'svelte';
	import Field from './Field.svelte';
	import { isVisible, type FieldDef, type FormRow } from '$lib/fields/types';

	let {
		fields,
		row = $bindable(),
		errors = {},
		idPrefix = 'f',
		onCreateRef,
		extra
	}: {
		fields: FieldDef[];
		row: FormRow;
		errors?: Record<string, string>;
		idPrefix?: string;
		onCreateRef?: (fieldName: string) => void;
		extra?: Snippet;
	} = $props();

	const visibleFields = $derived(fields.filter((field) => isVisible(field, row)));

	/**
	 * Splits the visible fields into consecutive runs sharing a group. Ungrouped
	 * fields form a run with no heading, so a form that uses no groups renders
	 * exactly as before.
	 */
	const sections = $derived.by(() => {
		const result: { group?: string; fields: FieldDef[] }[] = [];
		for (const field of visibleFields) {
			const last = result.at(-1);
			if (last && last.group === field.group) last.fields.push(field);
			else result.push({ group: field.group, fields: [field] });
		}
		return result;
	});

	/**
	 * Groups each run of `attach` fields onto the field they follow, so the whole
	 * lot occupies one cell of the grid.
	 *
	 * An attached field with nothing before it (its leader hidden, say) becomes a
	 * cell of its own rather than disappearing — a question that has to be
	 * answered is never dropped for want of somewhere to put it.
	 */
	function cells(fields: FieldDef[]) {
		const result: { lead: FieldDef; attached: FieldDef[] }[] = [];
		for (const field of fields) {
			const last = result.at(-1);
			if (field.attach && last) last.attached.push(field);
			else result.push({ lead: field, attached: [] });
		}
		return result;
	}
</script>

<div class="flex flex-col gap-9">
	{#each sections as section, index (index)}
		<div>
			{#if section.group}
				<h4
					class="mb-4 border-b border-border pb-2 text-sm font-semibold tracking-wider
						text-accent uppercase"
				>
					{section.group}
				</h4>
			{/if}

		<div class="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
				{#each cells(section.fields) as cell (cell.lead.name)}
					<!-- `wide` spans both columns: option rows and long text need the
					     room, and wrap awkwardly inside half a form. -->
					<div class={cell.lead.wide ? 'sm:col-span-2' : ''}>
						<Field
							field={cell.lead}
							bind:row
							error={errors[cell.lead.name]}
							{idPrefix}
							{onCreateRef}
						/>

						{#if cell.attached.length > 0}
							<!-- Indented under their leader, against a rule that says which
							     answer they qualify. -->
							<div class="mt-3 flex flex-col gap-3 border-l-2 border-border pl-4">
								{#each cell.attached as field (field.name)}
									<Field {field} bind:row error={errors[field.name]} {idPrefix} {onCreateRef} />
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/each}

	{#if extra}
		{@render extra()}
	{/if}
</div>
