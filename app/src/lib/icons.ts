/**
 * The icon set, as data.
 *
 * A small hand-rolled set rather than an icon package: only a handful are
 * needed. It lives here, in plain TypeScript, rather than inside
 * `Icon.svelte`, so modules that only need to *name* an icon — the status
 * actions, for instance — can import the name type without importing a
 * component.
 *
 * All paths are drawn on the same 24×24 grid with a 2px stroke, which is what
 * makes them look like one family.
 */

export type IconName =
	| 'play'
	| 'pause'
	| 'check'
	| 'flag'
	| 'flagOff'
	| 'pencil'
	| 'trash'
	| 'chevronDown'
	| 'chevronRight'
	| 'menu'
	| 'close'
	| 'split'
	| 'clipboard'
	| 'box'
	| 'history'
	| 'egg'
	| 'leaf'
	| 'flame'
	| 'loader'
	| 'gem'
	| 'grind'
	| 'boxOpen'
	| 'merge'
	| 'download'
	| 'plus';

/** Path data per icon. Multiple subpaths are separate entries. */
export const ICON_PATHS: Record<IconName, string[]> = {
	// Triangle pointing right — work is running.
	play: ['M6 4.5 19 12 6 19.5Z'],
	// Two bars — work is held.
	pause: ['M9 5v14', 'M15 5v14'],
	// Tick inside a circle — done, and visibly final.
	check: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'm8.5 12 2.5 2.5 4.5-5'],
	// Pennant on a pole — flagged to the top of the queue.
	flag: ['M5 21V4', 'M5 4h12l-2.5 4L17 12H5'],
	// The same pole with the pennant struck through.
	flagOff: ['M5 21V4', 'M5 4h12l-2.5 4L17 12H5', 'M3 3l18 18'],
	// Pencil over its stroke — edit in place.
	pencil: ['M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z', 'm14.5 6.5 3 3'],
	// Bin with a lid — remove.
	trash: ['M4 7h16', 'M10 4h4', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
	// An order sheet on a clipboard — the queue.
	clipboard: ['M8 4H6v16h12V4h-2', 'M9 3h6v3H9z', 'M9 11h6', 'M9 15h4'],
	// A cube seen in three-quarter view — a sack of coffee, a lot.
	box: [
		'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z',
		'm3.3 7 8.7 5 8.7-5',
		'M12 22V12'
	],
	// A clock with an arrow winding back over it — looking at what already
	// happened, rather than at something filed away.
	history: ['M3 3v5h5', 'M3.05 13A9 9 0 1 0 6 5.3L3 8', 'M12 7v5l4 2'],
	// ── Lot states ────────────────────────────────────────────────────────────
	// Pergamino: the bean still in its shell.
	egg: ['M12 3c3.3 0 6 4.6 6 8.4A6 6 0 0 1 6 11.4C6 7.6 8.7 3 12 3Z'],
	// Almendra verde: the bean, out of its parchment.
	leaf: ['M20 4C10 4 4 9.5 4 17c0 1.6.4 2.4 1 3 7.5 0 15-5.5 15-16Z', 'M5 20c3.5-4 7.5-6.5 11-7.5'],
	// Roasted.
	flame: [
		'M12 3c3.6 3.8 6 6.2 6 10a6 6 0 0 1-12 0c0-2 .8-3.2 1.8-4.2.9 1.8 2 1.9 2.7.9C11.3 7.5 10.4 5.4 12 3Z'
	],
	// Part way through: an arc that has not closed.
	loader: ['M12 3a9 9 0 1 0 9 9'],
	// Sorted roasted coffee: the picked-over best of it.
	gem: ['M6 3h12l3 6-9 12L3 9l3-6Z', 'M3 9h18', 'M9 3l-3 6 6 12', 'M15 3l3 6-6 12'],
	// Ground.
	grind: ['M6 10h.01', 'M12 10h.01', 'M18 10h.01', 'M6 15h.01', 'M12 15h.01', 'M18 15h.01'],
	// A box still open: packing under way.
	boxOpen: ['M3 9l9 4 9-4', 'M3 9v7l9 4 9-4V9', 'M3 9l4-5h10l4 5'],
	// Two branches meeting: this lot was folded into another.
	merge: ['M6 4v5a4 4 0 0 0 4 4h8', 'M15 9l4 4-4 4'],
	// An arrow into a tray — taking the order out as a document.
	download: ['M12 3v12', 'M7 11l5 5 5-5', 'M4 20h16'],
	// A cross — undo, dismiss, remove.
	close: ['M6 6l12 12', 'M18 6L6 18'],
	// The same cross upright — add one more.
	plus: ['M12 5v14', 'M5 12h14'],
	// A path that forks in two — coffee leaving one lot for another.
	/*
	 * One path forking into two, with an arrowhead on each branch.
	 *
	 * Redrawn: the branches used to stop short of their own arrowheads and the
	 * lower one ended in mid-air, which reads as missing pixels once the icon is
	 * drawn larger than the 14 px it was checked at.
	 */
	split: ['M4 12h5l5-6h5', 'M4 12h5l5 6h5', 'm16 3 3 3-3 3', 'm16 15 3 3-3 3'],
	// Three lines — the universal sign for a menu.
	menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
	// Disclosure: down when the contents are showing, right when they are not.
	chevronDown: ['m6 9 6 6 6-6'],
	chevronRight: ['m9 6 6 6-6 6']
};

/** The one icon drawn as a solid shape; the rest read better as outlines. */
export const FILLED_ICONS: IconName[] = ['play'];
