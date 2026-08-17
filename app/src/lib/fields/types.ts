/**
 * Field definitions — the form spec.
 *
 * This is the one idea worth keeping from AppSheet: a form is described as
 * data, not written by hand per screen. The workbook already carried Type,
 * Values, Require?, Show? and Valid If for every column; those port directly
 * into the shape below.
 *
 * Adding trilla or tostión later means writing a definition file, not a form.
 */

/** The input types the generic renderer knows how to draw. */
export type FieldType =
	| 'text'
	| 'longtext'
	| 'number'
	| 'decimal'
	| 'percent'
	| 'enum'
	| 'enumlist'
	| 'combo'
	| 'ref'
	| 'computed'
	| 'yesno'
	| 'date';

/** An option in an enum or ref field. */
export type FieldOption = {
	value: string;
	label: string;
	/** Extra detail shown beside the label, e.g. a bag's description. */
	hint?: string;
	/**
	 * A lot's state, when the option is a lot. Drawn as its mark in the list, so
	 * a lot looks the same in a picker as it does on the board.
	 */
	status?: string;
};

/**
 * A row of form values, keyed by field name. Deliberately loose: the renderer
 * is generic, and each definition file supplies its own typed conversion.
 */
export type FormRow = Record<string, unknown>;

export type FieldDef = {
	/** Property name in the form row. */
	name: string;
	/** The database column this maps to, kept for traceability back to the sheet. */
	column: string;
	/** Spanish label shown to the user. */
	label: string;
	type: FieldType;

	/** Ports AppSheet's Require?, which could itself be an expression. */
	required?: boolean | ((row: FormRow) => boolean);
	/** Ports AppSheet's Show?. A hidden field is never validated. */
	visible?: (row: FormRow) => boolean;
	/** Ports AppSheet's Values, for enum and enumlist fields. */
	options?: readonly FieldOption[] | ((row: FormRow) => readonly FieldOption[]);
	/** Label of the "+ Nuevo" entry in a ref field's dropdown, e.g. "+ Nuevo cliente". */
	createLabel?: string;
	/** Note shown on a `combo` field when the typed value is not in its list. */
	newValueLabel?: string;
	/**
	 * For `computed` fields: derives the text to display from the row. These are
	 * the AppSheet columns that carried an App formula and `Show? = true` — read
	 * only, recalculated as the form is filled in, never stored.
	 */
	compute?: (row: FormRow) => string;
	/**
	 * For `computed` fields: an optional muted aside shown to the right of the
	 * value — used to state the percentage a yield estimate is applying, since
	 * the trilla factor changes with the beneficio.
	 */
	computeNote?: (row: FormRow) => string;
	/**
	 * Values in an `enumlist` that cannot coexist with any other — "NINGUNO" and
	 * "Ninguna". Selecting one clears the rest; selecting anything else clears
	 * it. The matching `validate` rule stays as a server-side backstop.
	 */
	exclusive?: readonly string[];
	/** Ports AppSheet's Valid If. Returns a Spanish message, or null when valid. */
	validate?: (value: unknown, row: FormRow) => string | null;

	/**
	 * Optional heading this field sits under. Consecutive fields sharing a group
	 * are rendered beneath one subheading, so a long form reads as a few short
	 * ones. A group whose fields are all hidden does not render its heading.
	 */
	group?: string;

	/** Helper text shown under the input. */
	hint?: string;
	/** Unit suffix rendered inside the input, e.g. "kg". */
	unit?: string;
	/** Read-only fields are displayed but not editable (autofilled values). */
	readonly?: boolean;
	/** Lets a field span the full width of a two-column form grid. */
	wide?: boolean;
	/**
	 * Renders this field tucked under the one before it, in the same cell,
	 * instead of taking a cell of its own.
	 *
	 * For a field that qualifies the previous answer rather than asking something
	 * new — the sorting method under the stages it applies to. Side by side they
	 * read as three separate questions; underneath, as one with its details.
	 */
	attach?: boolean;
};

/** Builds `FieldOption[]` from a plain list of strings. */
export function toOptions(values: readonly string[]): FieldOption[] {
	return values.map((value) => ({ value, label: value }));
}

/** Resolves a possibly-dynamic `required` into a boolean for the current row. */
export function isRequired(field: FieldDef, row: FormRow): boolean {
	return typeof field.required === 'function' ? field.required(row) : (field.required ?? false);
}

/** Resolves a possibly-dynamic `visible` into a boolean for the current row. */
export function isVisible(field: FieldDef, row: FormRow): boolean {
	return field.visible ? field.visible(row) : true;
}

/** Resolves a possibly-dynamic option list for the current row. */
export function resolveOptions(field: FieldDef, row: FormRow): readonly FieldOption[] {
	if (!field.options) return [];
	return typeof field.options === 'function' ? field.options(row) : field.options;
}

/** True when a value counts as "not filled in". */
export function isBlank(value: unknown): boolean {
	if (value === null || value === undefined || value === '') return true;
	if (Array.isArray(value)) return value.length === 0;
	return false;
}

/**
 * Validates a whole row against its field definitions.
 *
 * Hidden fields are skipped entirely — a field the user cannot see must never
 * block a save, which is a failure mode of conditional forms.
 *
 * Returns a map of field name to Spanish message; empty means the row is valid.
 */
export function validateRow(fields: FieldDef[], row: FormRow): Record<string, string> {
	const errors: Record<string, string> = {};

	for (const field of fields) {
		if (!isVisible(field, row)) continue;
		// Computed fields have no input, so there is nothing to validate.
		if (field.type === 'computed') continue;

		const value = row[field.name];

		if (isRequired(field, row) && isBlank(value)) {
			errors[field.name] = 'Este campo es obligatorio.';
			continue;
		}

		// An empty optional field has nothing further to check.
		if (isBlank(value)) continue;

		const message = field.validate?.(value, row);
		if (message) errors[field.name] = message;
	}

	return errors;
}
