/**
 * Human-facing code generation for orders and lots.
 *
 * Ported from the AppSheet `Initial value` formulas, with two bugs fixed:
 *
 *  1. The date segment was `MONTH() & DAY()` unpadded, so Nov 5 and Jan 15 both
 *     produced "115". It is now zero-padded MMDD.
 *
 *  2. The sequence letter never advanced. The original formula compared against
 *     `[_THISROW].[ID_ORDEN]` while that value was still blank, so the inner
 *     lookup always returned empty, every letter looked free, and every order
 *     in the database ends in "A". Letters are now derived from the codes that
 *     actually exist.
 *
 * Codes are generated once at creation and stored. They are never recomputed,
 * so a later correction to a client name or order date cannot corrupt the
 * codes already printed on bags — which is how `-M728A-LT-A` and
 * `TIE-M727-LT-A` ended up in the current data.
 */

import type { OrderType } from './vocabulary.ts';

/**
 * Words skipped when deriving a prefix from a brand.
 *
 * Articles, because "La Amapola" is Amapola; and café, because half the brands
 * in this trade begin with it — a prefix of CAF would tell you only that the
 * client sells coffee, which is not a distinction in a coffee mill. Both
 * spellings, since the accent is optional in practice.
 */
const SKIPPED_WORDS = ['EL', 'LA', 'LOS', 'LAS', 'CAFE', 'CAFÉ', 'CAFES', 'CAFÉS'];

/** The letter each order type contributes to its code. */
const TYPE_LETTERS: Record<OrderType, string> = {
	Maquila: 'M',
	Exportacion: 'E',
	'Nacional/Interno': 'N'
};

/**
 * Derives the 3-letter prefix for a client.
 *
 * Uses the brand when there is one, skipping a leading article so "La Amapola"
 * yields AMA rather than LA_. Falls back to the client's own name for clients
 * with no brand, which is why Gonzalo Garcia's orders read GON.
 *
 * Stored on the client at creation so that renaming a brand later never changes
 * the codes of orders already issued.
 */
export function clientPrefix(clientName: string, brand?: string | null): string {
	const source = brand?.trim()
		? pickBrandWord(brand.trim())
		: clientName.trim();
	return source.slice(0, 3).toUpperCase();
}

/**
 * The first word of a brand that says something — "Café La Esperanza" is
 * Esperanza. Skips as many leading words as it has to, but never the last one:
 * a brand that is only skippable words still needs a prefix, and "Café" is a
 * better one than nothing.
 */
function pickBrandWord(brand: string): string {
	const words = brand.split(/\s+/);
	const first = words.findIndex((word) => !SKIPPED_WORDS.includes(word.toUpperCase()));
	return first === -1 ? words[words.length - 1] : words[first];
}

/**
 * Builds an order code: PREFIX-<type letter><MM><DD><letter>, e.g. TIE-M0727A.
 *
 * `existingCodes` should be every order code already issued for the same
 * client, type and date — the sequence letter advances past the highest one
 * found so that two orders on the same day cannot collide.
 */
export function orderCode(
	prefix: string,
	type: OrderType,
	date: Date,
	existingCodes: string[] = []
): string {
	const stem = `${prefix}-${TYPE_LETTERS[type]}${datePart(date)}`;
	const used = existingCodes
		.filter((code) => code.startsWith(stem))
		.map((code) => code.slice(stem.length));
	return stem + nextLetter(used);
}

/** Zero-padded MMDD. The padding is what prevents Nov 5 / Jan 15 collisions. */
function datePart(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return month + day;
}

/**
 * Builds a lot code: <order code>-LT-<letter>, e.g. TIE-M0727A-LT-C.
 */
export function lotCode(orderCode: string, letter: string): string {
	return `${orderCode}-LT-${letter}`;
}

/**
 * Returns the next letter in sequence, past the highest one already used.
 *
 * Deliberately does not fill gaps. If lot C was created and later voided, the
 * next lot is D — reusing C would mean two different lots sharing a code that
 * someone may already have written on a bag.
 *
 * Counts A…Z, then AA, AB… so it cannot run out.
 */
export function nextLetter(used: string[]): string {
	const highest = used.reduce((max, letter) => Math.max(max, letterToIndex(letter)), -1);
	return indexToLetter(highest + 1);
}

/** "A" -> 0, "Z" -> 25, "AA" -> 26. Returns -1 for anything unparseable. */
function letterToIndex(letter: string): number {
	const clean = letter.trim().toUpperCase();
	if (!/^[A-Z]+$/.test(clean)) return -1;
	return [...clean].reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0) - 1;
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
function indexToLetter(index: number): string {
	let result = '';
	let n = index;
	while (n >= 0) {
		result = String.fromCharCode(65 + (n % 26)) + result;
		n = Math.floor(n / 26) - 1;
	}
	return result;
}
