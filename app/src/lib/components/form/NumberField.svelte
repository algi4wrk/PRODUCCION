<script lang="ts">
	/**
	 * Numeric input for counts, weights and percentages.
	 *
	 * Deliberately a text input rather than `type="number"`. A native number
	 * input silently *discards* a comma regardless of browser locale — typing
	 * "10,4" yields 104, a tenfold error with no warning — and Colombia writes
	 * decimals with a comma. Verified in Chromium under both es-CO and en-US.
	 *
	 * So both separators are accepted, and the value is shown back in the
	 * Colombian convention once the field loses focus.
	 */
	import { inputClass } from './inputStyles';

	let {
		id,
		value = $bindable(),
		step = 1,
		unit,
		error
	}: {
		id: string;
		value: number | null;
		/** 1 for whole numbers, smaller for decimals. Drives display precision. */
		step?: number;
		unit?: string;
		error?: string;
	} = $props();

	let text = $state(format(value));
	let focused = $state(false);

	// Keep the display in sync when the value changes from elsewhere — a reset,
	// or a row loaded for editing — but never while the user is typing, which
	// would fight their cursor.
	$effect(() => {
		const next = value;
		if (!focused) text = format(next);
	});

	/** Formats for display using the comma as decimal separator. */
	function format(input: number | null): string {
		if (input === null || input === undefined || Number.isNaN(input)) return '';
		return input.toLocaleString('es-CO', {
			minimumFractionDigits: 0,
			maximumFractionDigits: step < 1 ? 2 : 0
		});
	}

	/**
	 * Parses what was typed, accepting either separator.
	 *
	 * When both appear the last one is the decimal separator, so "1.234,5" and
	 * "1,234.5" both read as 1234.5. A single separator is always decimal.
	 */
	function parse(input: string): number | null {
		const clean = input.replace(/\s/g, '');
		if (!clean) return null;

		const lastComma = clean.lastIndexOf(',');
		const lastDot = clean.lastIndexOf('.');

		let normalised: string;
		if (lastComma >= 0 && lastDot >= 0) {
			const decimalAt = Math.max(lastComma, lastDot);
			normalised =
				clean.slice(0, decimalAt).replace(/[.,]/g, '') + '.' + clean.slice(decimalAt + 1);
		} else {
			normalised = clean.replace(',', '.');
		}

		const parsed = Number(normalised);
		return Number.isFinite(parsed) ? parsed : null;
	}

	function onInput(event: Event) {
		text = (event.currentTarget as HTMLInputElement).value;
		value = parse(text);
	}

	function onBlur() {
		focused = false;
		// Show the parsed value back, so what is stored is visibly what was meant.
		text = format(value);
	}
</script>

<div class="relative">
	<!--
		`autocomplete="off"` because this is a text input by necessity — type=number
		drops the comma — and the browser therefore offers back every weight ever
		typed into a field with this name. A weight is measured, not recalled: last
		week's 46,00 is noise, and worse, one careless click enters it.
	-->
	<input
		{id}
		type="text"
		inputmode="decimal"
		autocomplete="off"
		autocorrect="off"
		spellcheck="false"
		value={text}
		oninput={onInput}
		onfocus={() => (focused = true)}
		onblur={onBlur}
		class="{inputClass(!!error)} {unit ? 'pr-10' : ''}"
	/>
	{#if unit}
		<span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
			{unit}
		</span>
	{/if}
</div>
