/**
 * Colours for the next-step buckets.
 *
 * Shared by the floor board and the lot detail page, so a step is the same
 * colour wherever it appears — across a room that colour arrives before the
 * words do, and a lot page disagreeing with the wall would be worse than no
 * colour at all.
 *
 * They match the lot-state marks in `lotIcons.ts`: amber pergamino, green
 * almendra, orange roast, violet sorted-roasted, sky packing. A step and the
 * state it leads to are therefore the same colour.
 */
export const STEP_TONES: Record<string, string> = {
	trilla: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
	seleccionVerde: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
	tostion: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200',
	seleccionTostado: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
	empaque: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
	bodega: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
	neutral: 'bg-border/40 text-muted'
};
