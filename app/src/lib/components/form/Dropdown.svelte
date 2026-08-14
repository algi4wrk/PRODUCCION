<script lang="ts">
	/**
	 * The single dropdown control, used by every picker in the app:
	 *
	 *   ref    — cliente, finca, bolsa. Pick only, may offer "+ Nuevo".
	 *   enum   — long option lists such as tipo de tostión. Pick only.
	 *   combo  — variedad. Pick, or type a value that is not in the list.
	 *
	 * Built rather than using a native `<select>` for two reasons: native popups
	 * position unreliably inside a fixed-position modal, and they cannot be
	 * styled to match the rest of the form. Typing filters the list in every
	 * mode, which matters for the 38-entry bag catalogue.
	 *
	 * `value` holds what gets stored — an id for ref fields, the value itself
	 * otherwise — while `query` is only ever what is displayed.
	 */
	import Icon from '$lib/components/Icon.svelte';
	import LotMark from '$lib/components/LotMark.svelte';
	import { inputClass } from './inputStyles';
	import type { FieldOption } from '$lib/fields/types';

	let {
		id,
		value = $bindable(),
		options,
		error,
		allowFree = false,
		createLabel,
		onCreate,
		clearable = false,
		placeholder,
		newValueLabel = 'Se agregará como valor nuevo.'
	}: {
		id: string;
		value: string;
		options: readonly FieldOption[];
		error?: string;
		/** Combo mode: a typed value that matches nothing is kept as-is. */
		allowFree?: boolean;
		createLabel?: string;
		onCreate?: () => void;
		/**
		 * Offers an × to unset the value. Opt-in, because most pickers in this app
		 * are required fields where an empty state is not a useful thing to aim
		 * for — a lot origin is the exception, since the choice narrows what the
		 * other rows may pick.
		 */
		clearable?: boolean;
		placeholder?: string;
		/** Note shown in combo mode when the typed value is not in the list. */
		newValueLabel?: string;
	} = $props();

	let open = $state(false);
	let highlighted = $state(-1);
	let query = $state('');
	let typing = $state(false);
	let wrapper = $state<HTMLDivElement | null>(null);

	const selected = $derived(options.find((option) => option.value === value) ?? null);

	/** What the input shows: the typed text while typing, the selection otherwise. */
	const display = $derived(
		typing ? query : allowFree ? (value ?? '') : (selected?.label ?? '')
	);

	const matches = $derived.by(() => {
		const needle = typing ? query.trim().toLowerCase() : '';
		if (!needle) return options;
		return options.filter(
			(option) =>
				option.label.toLowerCase().includes(needle) ||
				option.hint?.toLowerCase().includes(needle)
		);
	});

	/** Combo mode only: the typed text is a value that does not exist yet. */
	const isNew = $derived(
		allowFree &&
			(value ?? '').trim().length > 0 &&
			!options.some((option) => option.label.toLowerCase() === value.trim().toLowerCase())
	);

	function choose(option: FieldOption) {
		value = option.value;
		query = '';
		typing = false;
		open = false;
		highlighted = -1;
	}

	function onInput(event: Event) {
		const text = (event.currentTarget as HTMLInputElement).value;
		query = text;
		typing = true;
		open = true;
		highlighted = -1;
		// In combo mode what is typed is itself the value; in pick-only mode the
		// text is just a filter and the value changes only on selection.
		if (allowFree) value = text;
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			open = true;
			highlighted = Math.min(highlighted + 1, matches.length - 1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			highlighted = Math.max(highlighted - 1, 0);
		} else if (event.key === 'Enter') {
			// Never let Enter reach the surrounding form.
			event.preventDefault();
			if (open && highlighted >= 0 && matches[highlighted]) choose(matches[highlighted]);
			else close();
		} else if (event.key === 'Escape' && open) {
			// Close the list, not the modal around it.
			event.stopPropagation();
			close();
		}
	}

	function close() {
		open = false;
		typing = false;
		query = '';
		highlighted = -1;
	}

	/** Closes when focus leaves the control entirely. */
	function onFocusOut(event: FocusEvent) {
		const next = event.relatedTarget as Node | null;
		if (next && wrapper?.contains(next)) return;
		close();
	}
</script>

<div class="relative" bind:this={wrapper} onfocusout={onFocusOut}>
	<input
		{id}
		type="text"
		role="combobox"
		aria-expanded={open}
		aria-controls="{id}-lista"
		aria-autocomplete="list"
		autocomplete="off"
		readonly={!allowFree && options.length <= 8}
		value={display}
		placeholder={placeholder ?? (allowFree ? 'Escriba o elija…' : 'Elija…')}
		onfocus={() => (open = true)}
		onclick={() => (open = true)}
		oninput={onInput}
		onkeydown={onKeydown}
		class="{inputClass(!!error)} cursor-default {clearable && value ? 'pr-14' : 'pr-8'}"
	/>

	{#if clearable && value}
		<!-- Sits left of the chevron, so the two never overlap. -->
		<button
			type="button"
			tabindex="-1"
			aria-label="Quitar selección"
			title="Quitar selección"
			onclick={() => {
				value = '';
				query = '';
				close();
			}}
			class="absolute top-1/2 right-7 -translate-y-1/2 rounded p-0.5 text-muted transition
				hover:text-red-600"
		>
			<Icon name="close" size={12} />
		</button>
	{/if}

	<button
		type="button"
		tabindex="-1"
		aria-label={open ? 'Cerrar opciones' : 'Ver opciones'}
		onclick={() => (open ? close() : (open = true))}
		class="absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted transition hover:text-accent"
	>
		{open ? '▲' : '▼'}
	</button>

	{#if open}
		<ul
			id="{id}-lista"
			role="listbox"
			class="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border
				border-border bg-surface py-1 shadow-lg"
		>
			{#if onCreate && createLabel}
				<li>
					<button
						type="button"
						onclick={() => {
							close();
							onCreate();
						}}
						class="block w-full px-3 py-1.5 text-left text-sm font-medium text-accent
							transition hover:bg-accent-soft"
					>
						{createLabel}
					</button>
				</li>
				<li aria-hidden="true"><hr class="my-1 border-border" /></li>
			{/if}

			{#each matches as option, index (option.value)}
				<li>
					<button
						type="button"
						role="option"
						aria-selected={value === option.value}
						onclick={() => choose(option)}
						onmouseenter={() => (highlighted = index)}
						class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition
							{index === highlighted ? 'bg-accent-soft text-accent' : 'text-text'}"
					>
						<!-- A lot looks the same here as on the board. -->
						{#if option.status}
							<LotMark status={option.status} size={13} />
						{/if}
						<span>
							{option.label}
							{#if option.hint}
								<span class="ml-1 text-xs text-muted">· {option.hint}</span>
							{/if}
						</span>
					</button>
				</li>
			{/each}

			{#if matches.length === 0}
				<li class="px-3 py-1.5 text-sm text-muted">Sin coincidencias</li>
			{/if}
		</ul>
	{/if}
</div>

{#if isNew}
	<p class="text-xs text-muted">{newValueLabel}</p>
{/if}
