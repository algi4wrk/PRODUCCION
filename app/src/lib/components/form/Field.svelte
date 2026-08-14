<script lang="ts">
	/**
	 * Dispatches one FieldDef to the input component for its type, wrapped in the
	 * shared label/hint/error shell.
	 *
	 * This is the only place that knows the mapping from `FieldType` to a
	 * component, so adding a new input type is a single case here plus its file.
	 */
	import FieldShell from './FieldShell.svelte';
	import TextField from './TextField.svelte';
	import DateField from './DateField.svelte';
	import NumberField from './NumberField.svelte';
	import EnumField from './EnumField.svelte';
	import EnumListField from './EnumListField.svelte';
	import Dropdown from './Dropdown.svelte';
	import ComputedField from './ComputedField.svelte';
	import YesNoField from './YesNoField.svelte';
	import { isRequired, resolveOptions, type FieldDef, type FormRow } from '$lib/fields/types';

	let {
		field,
		row = $bindable(),
		error,
		idPrefix = 'f',
		onCreateRef
	}: {
		field: FieldDef;
		row: FormRow;
		error?: string;
		idPrefix?: string;
		/** Called when a ref field's "+ Nuevo" is pressed, with the field name. */
		onCreateRef?: (fieldName: string) => void;
	} = $props();

	const id = $derived(`${idPrefix}-${field.name}`);
	const required = $derived(isRequired(field, row));
	const options = $derived(resolveOptions(field, row));

	// Percent fields hold the percentage as typed (10.4). Conversion to and from
	// the stored fraction (0.104) happens at the route boundary, so this
	// component stays a plain number input.
</script>

<FieldShell {id} label={field.label} {required} hint={field.hint} {error} wide={field.wide}>
	{#if field.type === 'text' || field.type === 'longtext'}
		<TextField
			{id}
			bind:value={row[field.name] as string}
			multiline={field.type === 'longtext'}
			readonly={field.readonly}
			{error}
		/>
	{:else if field.type === 'number'}
		<NumberField {id} bind:value={row[field.name] as number | null} step={1} unit={field.unit} {error} />
	{:else if field.type === 'decimal'}
		<NumberField
			{id}
			bind:value={row[field.name] as number | null}
			step={0.01}
			unit={field.unit}
			{error}
		/>
	{:else if field.type === 'percent'}
		<NumberField {id} bind:value={row[field.name] as number | null} step={0.1} unit="%" {error} />
	{:else if field.type === 'enum'}
		<EnumField
			{id}
			bind:value={row[field.name] as string}
			{options}
			{error}
			clearable={!required}
		/>
	{:else if field.type === 'combo'}
		<Dropdown
			{id}
			bind:value={row[field.name] as string}
			{options}
			{error}
			allowFree
			newValueLabel={field.newValueLabel}
		/>
	{:else if field.type === 'enumlist'}
		<EnumListField
			bind:value={row[field.name] as string[]}
			{options}
			exclusive={field.exclusive}
		/>
	{:else if field.type === 'computed'}
		{@const text = field.compute?.(row) ?? '—'}
		<ComputedField
			{text}
			note={field.computeNote?.(row)}
			tone={text.trim().startsWith('-') ? 'warn' : 'neutral'}
		/>
	{:else if field.type === 'date'}
		<DateField {id} bind:value={row[field.name] as string} {error} clearable={!required} />
	{:else if field.type === 'yesno'}
		<YesNoField {id} bind:value={row[field.name] as boolean} />
	{:else if field.type === 'ref'}
		<Dropdown
			{id}
			bind:value={row[field.name] as string}
			{options}
			{error}
			clearable={!required}
			createLabel={field.createLabel}
			onCreate={onCreateRef && field.createLabel ? () => onCreateRef(field.name) : undefined}
		/>
	{/if}
</FieldShell>
