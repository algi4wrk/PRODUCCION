/**
 * Links that know where they already are.
 *
 * A record names the things around it — its order, its lot, its responsable —
 * and each of those is a link. But a detail opened *from* the lot page names
 * that same lot, and a link back to the page underneath is worse than no link:
 * it looks like a way somewhere and goes nowhere, when closing the modal is
 * what the operator actually wants.
 *
 * So the href is dropped when it points at the current page. Read from the
 * router rather than passed down as a "which page am I on" prop, because the
 * answer is the same everywhere and the sections are three levels deep.
 */
import { page } from '$app/state';

/** The href, unless it is the page we are already on — then nothing. */
export function linkUnlessHere(href: string): string | undefined {
	return page.url.pathname === href ? undefined : href;
}
