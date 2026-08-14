/**
 * Order status vocabulary and presentation.
 *
 * Status is fully manual — four buttons, no automatic transitions. PRIORIDAD is
 * deliberately not in this list: it is a separate boolean, because an order can
 * be in process *and* urgent, and the current app loses one when you set the
 * other.
 */

import type { OrderStatus } from './vocabulary.ts';
import type { IconName } from '../icons.ts';

export type BadgeTone = 'neutral' | 'active' | 'paused' | 'done' | 'priority';

const TONES: Record<OrderStatus, BadgeTone> = {
	'EN PROCESO': 'active',
	PAUSADA: 'paused',
	TERMINADA: 'done'
};

export function statusTone(status: OrderStatus): BadgeTone {
	return TONES[status] ?? 'neutral';
}

/**
 * The pause control, as one button that toggles.
 *
 * There is no "En proceso" button: EN PROCESO is the default an order is born
 * in, so a button for it would only ever be the one already pressed. What is
 * actually needed is the way out and the way back, which is one control —
 * Pausar while running, Reanudar while not.
 *
 * TERMINADA also offers Reanudar, so finishing an order by mistake is not a
 * dead end.
 */
export function pauseAction(status: OrderStatus): {
	status: OrderStatus;
	label: string;
	icon: IconName;
} {
	return status === 'EN PROCESO'
		? { status: 'PAUSADA', label: 'Pausar', icon: 'pause' }
		: { status: 'EN PROCESO', label: 'Reanudar', icon: 'play' };
}

/**
 * Marking the order done, and taking it back.
 *
 * A toggle like the pause control: pressing it on a finished order reopens it.
 * Finishing is a judgement call, and judgement calls get made early or by
 * accident, so the way back has to be the same button that got you there — a
 * lit control that undoes itself needs no explaining.
 *
 * The label switches to the *state* once finished ("Terminada"), because that
 * is what the lit button is reporting; `hint` says what pressing it does.
 */
export function finishAction(status: OrderStatus): {
	status: OrderStatus;
	label: string;
	icon: IconName;
	hint: string;
} {
	return status === 'TERMINADA'
		? {
				status: 'EN PROCESO',
				label: 'Terminada',
				icon: 'check',
				hint: 'Reabrir la orden'
			}
		: { status: 'TERMINADA', label: 'Terminar', icon: 'check', hint: 'Marcar como terminada' };
}
