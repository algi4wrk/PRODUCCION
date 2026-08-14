/**
 * Shared input styling, kept in one place so every field type looks identical
 * without repeating the class list in seven components.
 */

export const INPUT_CLASS =
	'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text ' +
	'outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25 ' +
	'disabled:cursor-not-allowed disabled:opacity-60';

export const INPUT_ERROR_CLASS = 'border-red-500 focus:border-red-500 focus:ring-red-500/25';

/**
 * Option buttons — the pill rows used by enum, enumlist and yes/no fields.
 * Deliberately smaller than a text input: they are choices to scan, not fields
 * to type into, and a form with four of them reads as a wall otherwise.
 */
const OPTION_BASE = 'rounded-md border px-3 py-1 text-sm transition';

export const OPTION_ON = `${OPTION_BASE} border-accent bg-accent-soft font-medium text-accent`;
export const OPTION_OFF = `${OPTION_BASE} border-border bg-surface text-muted hover:border-accent/40`;

/** Picks the on/off variant for an option button. */
export function optionClass(selected: boolean): string {
	return selected ? OPTION_ON : OPTION_OFF;
}

/** Combines the base input class with the error variant when needed. */
export function inputClass(hasError: boolean | undefined): string {
	return hasError ? `${INPUT_CLASS} ${INPUT_ERROR_CLASS}` : INPUT_CLASS;
}
