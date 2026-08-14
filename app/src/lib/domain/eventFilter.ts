/**
 * How the event lists are narrowed.
 *
 * The same five lists serve three views — an order, a lot, and a person — so
 * rather than a list function per view they take the filter. All three fields
 * are optional and they combine, which is what lets a person's page ask "every
 * trilla by this operator" without a query of its own.
 */
export type EventFilter = {
	orderId?: number;
	lotId?: number;
	staffId?: number;
	/** The client whose orders these belong to. */
	clientId?: number;
	/** Inclusive date range, as HISTORIAL's filter asks for it. */
	from?: Date;
	to?: Date;
};
