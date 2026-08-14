/**
 * Order queries.
 *
 * All reads exclude soft-deleted rows. Creation writes the order and both child
 * tables in a single transaction, so an abandoned form leaves nothing behind.
 */

import { and, eq, isNull, like } from 'drizzle-orm';
import { db } from './db/index.ts';
import { clients, lots, orders, references, type Order } from './db/schema.ts';
import { orderCode, lotCode, nextLetter } from '../domain/codes.ts';
import type { OrderType, ProductLine, OrderStatus } from '../domain/vocabulary.ts';
import { logChange } from './audit.ts';
import { postReception } from './ledger.ts';
import { nextLotLetter } from './lots.ts';

/** An order with the client fields the list and detail pages need. */
export type OrderWithClient = Order & { clientName: string; clientBrand: string | null };

/** Loads every live order together with its client, newest data first. */
export async function listOrders(): Promise<(OrderWithClient & { lotCount: number })[]> {
	const rows = await db
		.select({
			order: orders,
			clientName: clients.name,
			clientBrand: clients.brand
		})
		.from(orders)
		.innerJoin(clients, eq(orders.clientId, clients.id))
		.where(isNull(orders.deletedAt));

	const counts = await db
		.select({ orderId: lots.orderId, id: lots.id })
		.from(lots)
		.where(isNull(lots.deletedAt));

	const countByOrder = new Map<number, number>();
	for (const lot of counts) {
		countByOrder.set(lot.orderId, (countByOrder.get(lot.orderId) ?? 0) + 1);
	}

	return rows.map(({ order, clientName, clientBrand }) => ({
		...order,
		clientName,
		clientBrand,
		lotCount: countByOrder.get(order.id) ?? 0
	}));
}

/** Loads one order with its client, lots and references. Null when not found. */
/**
 * The order id behind a URL segment.
 *
 * URLs carry ID_ORDEN — `TIE-M0727A` — rather than the row id, because that is
 * what the client and the floor call an order; a link is then legible on its
 * own and survives being pasted into a message. A bare number is still accepted:
 * codes never look like one, so there is nothing to confuse, and old links keep
 * resolving.
 */
export async function orderIdFor(param: string): Promise<number | null> {
	if (/^\d+$/.test(param)) return Number(param);

	const [order] = await db
		.select({ id: orders.id })
		.from(orders)
		.where(eq(orders.code, param))
		.limit(1);
	return order?.id ?? null;
}

export async function getOrder(id: number) {
	const [row] = await db
		.select({ order: orders, clientName: clients.name, clientBrand: clients.brand })
		.from(orders)
		.innerJoin(clients, eq(orders.clientId, clients.id))
		.where(and(eq(orders.id, id), isNull(orders.deletedAt)))
		.limit(1);

	if (!row) return null;

	const orderLots = await db
		.select()
		.from(lots)
		.where(and(eq(lots.orderId, id), isNull(lots.deletedAt)));

	const orderReferences = await db
		.select()
		.from(references)
		.where(and(eq(references.orderId, id), isNull(references.deletedAt)));

	return {
		...row.order,
		clientName: row.clientName,
		clientBrand: row.clientBrand,
		lots: orderLots,
		references: orderReferences
	};
}

export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrder>>>;

/** The lot values supplied by the nested form, before codes are assigned. */
export type NewLotInput = Omit<
	typeof lots.$inferInsert,
	'id' | 'code' | 'orderId' | 'letter' | 'status'
>;

/** The reference values supplied by the nested form. */
export type NewReferenceInput = Omit<
	typeof references.$inferInsert,
	'id' | 'code' | 'orderId'
>;

export type NewOrderInput = {
	type: OrderType;
	clientId: number;
	productLine?: ProductLine | null;
	peelStick: boolean;
	notes?: string | null;
	lots: NewLotInput[];
	references: NewReferenceInput[];
};

/**
 * Creates an order with its lots and references in one transaction.
 *
 * Codes are generated here, once, from the data that exists at this moment —
 * never recomputed afterwards. That is what stops a later edit from corrupting
 * codes already written on bags, which is how `TIE-M727-LT-A` came to sit under
 * order `TIE-M727A`.
 */
export async function createOrder(input: NewOrderInput): Promise<number> {
	const [client] = await db.select().from(clients).where(eq(clients.id, input.clientId)).limit(1);
	if (!client) throw new Error(`Cliente ${input.clientId} no existe.`);

	const now = new Date();

	return db.transaction((tx) => {
		// Sequence letter comes from codes that actually exist for this client,
		// type and date — the check the original formula was meant to perform.
		const stem = `${client.prefix}-`;
		const existing = tx
			.select({ code: orders.code })
			.from(orders)
			.where(like(orders.code, `${stem}%`))
			.all()
			.map((row) => row.code);

		const code = orderCode(client.prefix, input.type, now, existing);

		const [created] = tx
			.insert(orders)
			.values({
				code,
				date: now,
				type: input.type,
				clientId: client.id,
				brand: client.brand,
				peelStick: input.peelStick,
				productLine: input.productLine ?? null,
				notes: input.notes ?? null,
				status: 'EN PROCESO',
				priority: false
			})
			.returning({ id: orders.id })
			.all();

		// Lot letters advance A, B, C… within the order and are never reused.
		let usedLetters: string[] = [];
		for (const lot of input.lots) {
			const letter = nextLetter(usedLetters);
			usedLetters = [...usedLetters, letter];

			const [createdLot] = tx
				.insert(lots)
				.values({
					...lot,
					code: lotCode(code, letter),
					orderId: created.id,
					letter,
					// Still written because the column exists; nothing reads it. Status
					// is derived from the ledger — see lotStatus.
					status: lot.rawMaterial
				})
				.returning({ id: lots.id })
				.all();

			// The lot's arrival, as a ledger entry. Without it a received lot would
			// have a status but no weight, and every projection would need a
			// "nothing has happened yet" branch.
			postReception(tx, {
				id: createdLot.id,
				orderId: created.id,
				rawMaterial: lot.rawMaterial,
				initialWeight: lot.initialWeight
			});
		}

		for (const [index, reference] of input.references.entries()) {
			tx.insert(references)
				.values({ ...reference, code: `${code}-REF-${index + 1}`, orderId: created.id })
				.run();
		}

		return created.id;
	});
}

/** The order fields an operator may correct after creation. */
export type OrderEdit = {
	type: OrderType;
	clientId: number;
	productLine?: ProductLine | null;
	peelStick: boolean;
	notes?: string | null;
};

/**
 * Updates an order's descriptive fields, logging every change to `auditoria`.
 *
 * `ID_ORDEN` is deliberately not recomputed, even when the client changes: codes
 * are issued once and stored, and rewriting one would orphan anything already
 * written on a bag or referenced on paper. The same rule is why lot codes keep
 * the order code they were born with.
 *
 * This is ordinary CRUD — descriptive data, corrected in place. Weight is not
 * editable here and never will be; that is what compensating events are for.
 */
export async function updateOrder(id: number, input: OrderEdit, user?: string) {
	const [before] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
	if (!before) throw new Error(`Orden ${id} no existe.`);

	const [client] = await db.select().from(clients).where(eq(clients.id, input.clientId)).limit(1);
	if (!client) throw new Error(`Cliente ${input.clientId} no existe.`);

	const next = {
		type: input.type,
		clientId: client.id,
		// Follows the client, as it does at creation.
		brand: client.brand,
		productLine: input.productLine ?? null,
		peelStick: input.peelStick,
		notes: input.notes ?? null
	};

	await db.update(orders).set(next).where(eq(orders.id, id));

	// One audit row per field that actually moved; logChange no-ops on equality.
	const columns: Record<keyof typeof next, string> = {
		type: 'TIPO DE ORDEN',
		clientId: 'cliente_id',
		brand: 'MARCA',
		productLine: 'LINEA DE PRODUCTO',
		peelStick: 'PEEL STICK',
		notes: 'NOTAS'
	};

	for (const [key, column] of Object.entries(columns) as [keyof typeof next, string][]) {
		const from = before[key];
		const to = next[key];
		await logChange(
			'ordenes',
			id,
			column,
			from === null || from === undefined ? null : String(from),
			to === null || to === undefined ? null : String(to),
			user
		);
	}
}

/** Sets an order's status. Manual only — nothing computes this. */
export async function setOrderStatus(id: number, status: OrderStatus, user?: string) {
	const [before] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
	if (!before) return;

	await db.update(orders).set({ status }).where(eq(orders.id, id));
	await logChange('ordenes', id, 'ESTADO ACTUAL', before.status, status, user);
}

/** Toggles the priority flag, which sorts an order to the top of the queue. */
export async function setOrderPriority(id: number, priority: boolean, user?: string) {
	const [before] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
	if (!before) return;

	await db.update(orders).set({ priority }).where(eq(orders.id, id));
	await logChange('ordenes', id, 'PRIORIDAD', String(before.priority), String(priority), user);
}

/**
 * Soft-deletes an order. The row and its children stay in the database — in a
 * traceability system an order that vanishes without trace is worse than a
 * cluttered list.
 */
export async function deleteOrder(id: number, user?: string) {
	await db.update(orders).set({ deletedAt: new Date() }).where(eq(orders.id, id));
	await logChange('ordenes', id, 'borrado_en', null, new Date().toISOString(), user);
}

/** Restores a soft-deleted order, backing the undo toast. */
export async function restoreOrder(id: number, user?: string) {
	await db.update(orders).set({ deletedAt: null }).where(eq(orders.id, id));
	await logChange('ordenes', id, 'borrado_en', 'borrado', null, user);
}

/**
 * Adds one lot to an existing order.
 *
 * The same three things `createOrder` does per lot — letter, code, reception
 * entry — because a lot added on Tuesday is not different from a lot added at
 * creation. Letters continue from the ones already issued and are never reused,
 * so a lot deleted from an order does not free its letter.
 */
export async function addLot(orderId: number, input: NewLotInput): Promise<number> {
	return db.transaction((tx) => {
		const [order] = tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).all();
		if (!order) throw new Error('La orden no existe.');

		const letter = nextLotLetter(tx, orderId);

		const [created] = tx
			.insert(lots)
			.values({
				...input,
				code: lotCode(order.code, letter),
				orderId,
				letter,
				status: input.rawMaterial
			})
			.returning({ id: lots.id })
			.all();

		postReception(tx, {
			id: created.id,
			orderId,
			rawMaterial: input.rawMaterial,
			initialWeight: input.initialWeight
		});

		return created.id;
	});
}

/**
 * Adds one packaging reference to an existing order.
 *
 * The code counts every reference the order has ever had, deleted ones
 * included, so a code is never reissued to a different row.
 */
export async function addReference(orderId: number, input: NewReferenceInput): Promise<number> {
	return db.transaction((tx) => {
		const [order] = tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).all();
		if (!order) throw new Error('La orden no existe.');

		const issued = tx
			.select({ id: references.id })
			.from(references)
			.where(eq(references.orderId, orderId))
			.all().length;

		const [created] = tx
			.insert(references)
			.values({ ...input, code: `${order.code}-REF-${issued + 1}`, orderId })
			.returning({ id: references.id })
			.all();

		return created.id;
	});
}

/**
 * Corrects a reference.
 *
 * Ordinary CRUD: a reference is an *estimate* of what the client expects, not a
 * record of anything that happened, so it is edited in place and audited. Its
 * ID_REF is not recomputed, for the same reason no other code is.
 */
export async function updateReference(id: number, input: NewReferenceInput, user?: string) {
	const [before] = await db.select().from(references).where(eq(references.id, id)).limit(1);
	if (!before) throw new Error('La referencia no existe.');

	const next = {
		grams: input.grams,
		quantity: input.quantity,
		grind: input.grind,
		variety: input.variety,
		bagId: input.bagId ?? null
	};

	await db.update(references).set(next).where(eq(references.id, id));

	const columns: Record<keyof typeof next, string> = {
		grams: 'REFERENCIAS (g)',
		quantity: 'Cantidad',
		grind: 'Tipo de Molienda',
		variety: 'VARIEDAD',
		bagId: 'bolsa_id'
	};

	for (const [key, column] of Object.entries(columns) as [keyof typeof next, string][]) {
		const from = before[key];
		const to = next[key];
		await logChange(
			'referencias',
			id,
			column,
			from === null || from === undefined ? null : String(from),
			to === null || to === undefined ? null : String(to),
			user
		);
	}
}

/**
 * Removes a reference from the packaging plan.
 *
 * Soft, like every delete here: the row stays so that empaques recorded against
 * it still resolve. Those keep pointing at it and go on counting as packed —
 * dropping a line from the plan does not unpack the coffee.
 */
export async function deleteReference(id: number, user?: string) {
	await db.update(references).set({ deletedAt: new Date() }).where(eq(references.id, id));
	await logChange('referencias', id, 'borrado_en', null, new Date().toISOString(), user);
}
