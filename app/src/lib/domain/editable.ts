/**
 * The lot list an edit form needs.
 *
 * A picker offers the lots a step *can* act on, which by definition excludes the
 * one the event being edited already acted on: a lot that has been hulled is no
 * longer pergamino, and a batch that has been roasted has taken its green with
 * it. Editing that event has to offer its own lot anyway, and has to let the
 * weight go back up to what it was — the server allows the edit only when
 * nothing stands on the event, so it reverses the old entries before checking
 * the new ones, and the form's cap must match that.
 *
 * So the event's own lot is added to the list with the weight it took returned
 * to it, or merged into the entry already there when the lot is still eligible —
 * a lot part way through roasting appears in both.
 */
export function editableLots<T extends { value: string; availableKilos: number }>(
	lots: readonly T[],
	own: T
): T[] {
	const existing = lots.find((lot) => lot.value === own.value);
	if (!existing) return [own, ...lots];

	return lots.map((lot) =>
		lot.value === own.value
			? { ...lot, availableKilos: lot.availableKilos + own.availableKilos }
			: lot
	);
}
