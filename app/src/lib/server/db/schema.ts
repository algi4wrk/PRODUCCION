/**
 * Drizzle schema.
 *
 * Database column names are preserved exactly as they exist in the AppSheet
 * workbook so the client stays fluent in their own data. TypeScript property
 * names are English. Every table carries a hidden integer `id` primary key;
 * human-facing codes (ID_ORDEN, ID_LOTE) are unique columns, generated once at
 * creation and never recomputed.
 *
 * Deletes are soft: `borrado_en` holds a timestamp instead of removing a row.
 */

import { sqliteTable, integer, text, real, index } from 'drizzle-orm/sqlite-core';
import type {
	OrderType,
	ProductLine,
	OrderStatus,
	RawMaterial,
	SelectionStage,
	RoastType,
	ProcessType,
	Screen,
	GrindType,
	PackingInspection,
	LedgerState,
	EventType,
	MovementAction
} from '../../domain/vocabulary.ts';

/** Timestamp column helper — SQLite stores these as epoch milliseconds. */
const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

/** Boolean column helper — SQLite has no native boolean. */
const boolean = (name: string) => integer(name, { mode: 'boolean' });

/**
 * Clients. Client and brand share one table, mirroring the current MARCA sheet.
 * PREFIJO is the stored 3-letter code fragment used when generating ID_ORDEN,
 * so renaming a brand never changes previously issued order codes.
 */
export const clients = sqliteTable('clientes', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	code: text('ID_MARCA').notNull().unique(),
	name: text('CLIENTE').notNull(),
	brand: text('NOMBRE MARCA'),
	owner: text('PROPIETARIO'),
	country: text('PAIS DE REGISTRO'),
	prefix: text('PREFIJO').notNull(),
	deletedAt: timestamp('borrado_en')
});

/** Farms. Currently keyed on the farm name; now a real id with a unique name. */
export const farms = sqliteTable('fincas', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('NOMBRE FINCA').notNull().unique(),
	municipality: text('MUNICIPIO'),
	department: text('DEPARTAMENTO'),
	farmer: text('AGRICULTOR'),
	deletedAt: timestamp('borrado_en')
});

/** Bag catalogue. ID_BOLSA stays the human-facing code (BO04, BE01, Cliente…). */
export const bags = sqliteTable('bolsas', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	code: text('ID_BOLSA').notNull().unique(),
	description: text('DESCRIPCION BOLSA'),
	/** Bag capacity in grams. Null for variable-size bags such as BOLSA CLIENTE. */
	sizeGrams: integer('TAMAÑO (g)'),
	deletedAt: timestamp('borrado_en')
});

/** Staff. Referenced by process events as the responsible operator. */
export const staff = sqliteTable('personal', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('NOMBRE').notNull().unique(),
	position: text('POSICION'),
	deletedAt: timestamp('borrado_en')
});

/**
 * Orders — the aggregate root. An order holds lots (materia prima) and
 * references (the packaging plan the client expects).
 *
 * ESTADO ACTUAL is manual, set by buttons. PRIORIDAD is split out of it because
 * priority is orthogonal to status: an order can be in process *and* urgent.
 */
export const orders = sqliteTable(
	'ordenes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		code: text('ID_ORDEN').notNull().unique(),
		date: timestamp('FECHA').notNull(),
		type: text('TIPO DE ORDEN').$type<OrderType>().notNull(),
		clientId: integer('cliente_id')
			.notNull()
			.references(() => clients.id),
		/** Denormalised brand label captured at creation, as the sheet does today. */
		brand: text('MARCA'),
		peelStick: boolean('PEEL STICK').notNull().default(false),
		productLine: text('LINEA DE PRODUCTO').$type<ProductLine>(),
		notes: text('NOTAS'),
		status: text('ESTADO ACTUAL').$type<OrderStatus>().notNull().default('EN PROCESO'),
		priority: boolean('PRIORIDAD').notNull().default(false),
		deletedAt: timestamp('borrado_en')
	},
	(t) => [index('orders_client_idx').on(t.clientId), index('orders_date_idx').on(t.date)]
);

/**
 * Lots. A lot is a quantity of coffee defined by the process it requires — if
 * part of an order needs different treatment, it becomes its own lot.
 *
 * Only the 18 genuinely stored columns exist here. The 37 computed columns from
 * the AppSheet sheet are derived at render instead.
 *
 * PROCESO SELECCION and MALLAS A SEPARAR are multi-select in the source app and
 * are stored as JSON arrays.
 */
export const lots = sqliteTable(
	'lotes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		code: text('ID_LOTE').notNull().unique(),
		orderId: integer('orden_id')
			.notNull()
			.references(() => orders.id),
		/** Sequence letter within the order (A, B, C…). Never reused. */
		letter: text('LETRA').notNull(),

		// Lineage columns (LOTE(S) ORIGEN, LOTE CREADO, ROOT LOT) are deliberately
		// absent until movimientos exists — they have no writer yet, and an
		// unfilled column invites guessing about what it means.

		// Reception facts — what physically arrived.
		rawMaterial: text('MATERIA PRIMA INICIAL').$type<RawMaterial>().notNull(),
		initialWeight: real('PESO INICIAL (kg)').notNull(),
		variety: text('VARIEDAD').notNull(),
		process: text('BENEFICIO').$type<ProcessType>().notNull(),
		humidity: real('HUMEDAD').notNull(),
		farmId: integer('finca_id').references(() => farms.id),

		// Specification — what the client asked to have done. Not observed state.
		selectionStages: text('PROCESO SELECCION', { mode: 'json' })
			.$type<SelectionStage[]>()
			.notNull(),
		roastType: text('TIPO DE TOSTION').$type<RoastType>().notNull(),
		screens: text('MALLAS A SEPARAR', { mode: 'json' }).$type<Screen[]>(),
		addQuaker: boolean('AGREGAR QUAKER'),
		storeInWarehouse: boolean('GUARDAR EN BODEGA').notNull().default(false),

		/** Seeded from MATERIA PRIMA INICIAL, as the sheet does. Becomes derived
		 *  from the ledger once REGISTRO exists. */
		status: text('ESTADO ACTUAL').notNull(),
		/**
		 * What this lot *is*, when it is a by-product rather than coffee received
		 * from the client: "MALLA 14", "QUAKER". Set by the step that separated it
		 * and shown in the lot's name.
		 *
		 * Stored rather than inferred. The workbook read this out of
		 * ETIQUETA DETALLADA by testing for a blank MATERIA PRIMA INICIAL, which
		 * only worked because that column could be blank; ours cannot.
		 */
		kind: text('CLASE'),
		deletedAt: timestamp('borrado_en')
	},
	(t) => [index('lots_order_idx').on(t.orderId)]
);

/**
 * References — the packaging plan. What the client expects to receive, as an
 * estimate, recorded at order creation. EMPAQUE events later execute against it.
 *
 * PESO KILO is not stored: it is gramos × cantidad ÷ 1000, derived at render.
 */
export const references = sqliteTable(
	'referencias',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		code: text('ID_REF').notNull().unique(),
		orderId: integer('orden_id')
			.notNull()
			.references(() => orders.id),
		grams: integer('REFERENCIAS (g)').notNull(),
		quantity: integer('Cantidad').notNull(),
		grind: text('Tipo de Molienda').$type<GrindType>().notNull(),
		variety: text('VARIEDAD').notNull(),
		bagId: integer('bolsa_id').references(() => bags.id),
		deletedAt: timestamp('borrado_en')
	},
	(t) => [index('references_order_idx').on(t.orderId)]
);

/**
 * MOVIMIENTOS — lineage. The only writer of "this coffee came from that lot".
 *
 * A header naming what moved where; the per-lot weights are `registro` legs,
 * which is what lets one combo draw partial weight from any number of origins.
 * That arbitrary-size combo is the thing the source app could not express.
 *
 * A movimiento exists only when lineage actually changes — a lot is born, or
 * coffee crosses between lots. Weight moving inside one lot is a process event
 * and writes ledger rows alone.
 *
 * LOTE CREADO from the workbook is not carried over: it existed only to
 * generate a name through the ALPHABET HELPER SHEET formula. The destination lot
 * is created here, in the same transaction, and referenced by id.
 */
export const movements = sqliteTable(
	'movimientos',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		code: text('ID_MOVIMIENTO').notNull().unique(),
		orderId: integer('orden_id')
			.notNull()
			.references(() => orders.id),
		action: text('ACCION/PROCESO').$type<MovementAction>().notNull(),
		/** Origin lot ids. More than one only when combining. */
		originLotIds: text('LOTE ORIGEN', { mode: 'json' }).$type<number[]>().notNull(),
		destinationLotId: integer('LOTE DESTINO')
			.notNull()
			.references(() => lots.id),
		date: timestamp('FECHA').notNull(),
		/** Required: coffee never changes lot without someone accountable. */
		staffId: integer('responsable_id')
			.notNull()
			.references(() => staff.id),
		/**
		 * The process step that emitted this movimiento. Both null when an
		 * operator entered it by hand, which is how "manual" is known without a
		 * separate flag.
		 */
		eventType: text('evento_tipo').$type<EventType>(),
		eventId: integer('evento_id'),
		/**
		 * Undone movimientos are soft-deleted, and their weight is put back by
		 * compensating ledger entries rather than by removing the originals. The
		 * row stays so the correction is still legible afterwards.
		 */
		deletedAt: timestamp('borrado_en')
	},
	(t) => [index('movements_order_idx').on(t.orderId)]
);

/**
 * TRILLA — hulling. Pergamino goes in, almendra comes out, and the screens the
 * client asked for are separated into lots of their own.
 *
 * The event holds what was measured; what it did to the balances is in
 * `registro`, and the lots it created are in `movimientos`. Ported from the
 * workbook's TRILLA sheet, minus its four computed display columns.
 */
export const trilla = sqliteTable(
	'trilla',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		code: text('ID_EVENTO').notNull().unique(),
		orderId: integer('orden_id')
			.notNull()
			.references(() => orders.id),
		lotId: integer('lote_id')
			.notNull()
			.references(() => lots.id),
		date: timestamp('FECHA').notNull(),
		/** What went in. Defaults to everything the lot is holding. */
		parchmentKilos: real('PESO PERGAMINO').notNull(),
		/** What came out as almendra, excluding the separated screens. */
		greenKilos: real('PESO ALMENDRA').notNull(),
		screen14: real('MALLA 14'),
		screen1516: real('MALLA 15/16'),
		screen1718: real('MALLA 17/18'),
		staffId: integer('responsable_id')
			.notNull()
			.references(() => staff.id),
		notes: text('OBSERVACIONES'),
		/** Undone events are soft-deleted; their weight is put back by
		 *  compensating ledger entries, never by removing the originals. */
		deletedAt: timestamp('borrado_en')
	},
	(t) => [index('trilla_lot_idx').on(t.lotId), index('trilla_order_idx').on(t.orderId)]
);

/**
 * SELECCION — sorting, before roasting or after it.
 *
 * Good coffee stays in the lot and is marked as sorted; defects leave as merma.
 * Quakers are the exception: when the client asked for them (AGREGAR QUAKER),
 * they are separated into a lot of their own so they can be combined back into
 * a lesser-quality lot rather than thrown away.
 *
 * The workbook's LOTES ADICIONALES is not carried over. It let one selección
 * cover several lots and quietly combined them into a new one — which is a
 * combo, and combos belong to movimientos. Select a batch by combining it
 * first.
 */
export const seleccion = sqliteTable(
	'seleccion',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		code: text('ID_EVENTO').notNull().unique(),
		orderId: integer('orden_id')
			.notNull()
			.references(() => orders.id),
		lotId: integer('lote_id')
			.notNull()
			.references(() => lots.id),
		date: timestamp('FECHA').notNull(),
		/** Which side of the roast this sorting happened on. */
		stage: text('TIPO DE CAFE').$type<SelectionStage>().notNull(),
		/** What went in. */
		totalKilos: real('PESO TOTAL').notNull(),
		/** What came out sorted. */
		netKilos: real('PESO NETO (kg)').notNull(),
		/** Separated into their own lot; null when the client does not want them. */
		/**
		 * What was picked out, whatever became of it. Stored rather than derived:
		 * the three weights come off separate scales, so `total − neto` is the
		 * usual answer and not necessarily the measured one — and what the three
		 * fail to account for is merma.
		 */
		removedKilos: real('PESO DEFECTOS (kg)'),
		quakerKilos: real('QUAKERS (kg)'),
		staffId: integer('responsable_id')
			.notNull()
			.references(() => staff.id),
		notes: text('OBSERVACIONES'),
		deletedAt: timestamp('borrado_en')
	},
	(t) => [index('seleccion_lot_idx').on(t.lotId), index('seleccion_order_idx').on(t.orderId)]
);

/**
 * TOSTION — roasting, one batch at a time.
 *
 * The roaster holds ROASTER_BATCH_KILOS, so a large lot is roasted over several
 * events and holds green and roasted coffee in between. That is what
 * EN PROCESO TOSTION means, and it needs no flag: it is what the balances say.
 *
 * LOTES ADICIONALES is not carried over, for the same reason selección's was
 * not — roasting several lots as one batch is a combo, and combos belong to
 * movimientos.
 */
export const tostion = sqliteTable(
	'tostion',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		code: text('ID_EVENTO').notNull().unique(),
		orderId: integer('orden_id')
			.notNull()
			.references(() => orders.id),
		lotId: integer('lote_id')
			.notNull()
			.references(() => lots.id),
		date: timestamp('FECHA').notNull(),
		/** The profile actually run, which may differ from what was specified. */
		roastType: text('TUESTE').$type<RoastType>().notNull(),
		/** Green the lot held when this batch was loaded, kept as a record. */
		greenKilos: real('PESO LOTE VERDE').notNull(),
		/** What went into the roaster. */
		batchKilos: real('PESO DEL BACHE (kg)').notNull(),
		/** What came out. The difference is the roast loss. */
		roastedKilos: real('PESO TOSTADO (kg)').notNull(),
		/** Whether the green that went in had already been sorted. */
		fromSorted: boolean('SELECCIONADO').notNull().default(false),
		staffId: integer('responsable_id')
			.notNull()
			.references(() => staff.id),
		notes: text('OBSERVACIONES'),
		deletedAt: timestamp('borrado_en')
	},
	(t) => [index('tostion_lot_idx').on(t.lotId), index('tostion_order_idx').on(t.orderId)]
);

/**
 * EMPAQUE — packing roasted coffee into bags.
 *
 * One event is one presentation packed from one lot: 40 bags of 250 g. Packing
 * does not consume coffee, it changes its form — the ledger moves weight from
 * TOSTADO to EMPACADO on the same lot, and the total the lot holds is unchanged.
 *
 * `referencia_id` is the line of the packaging plan this event fills, ported
 * from the workbook's ID_REF. It is nullable on purpose: the plan is an estimate
 * made before the coffee was roasted, and what actually gets packed is whatever
 * the lot yielded. An event that matches no planned line is a fact about the
 * order, not an error.
 *
 * Dropped from the sheet: VARIEDAD, DESCRIPCION BOLSA, LABEL, PESO FINAL,
 * PESO ACTUAL (kg), REFS, REFS USADAS, ID_BOLSA, ID ORDEN and LOTE were all
 * App formulas — lookups onto the lot, the bag or the order, or the running
 * balance that the ledger now answers. PESO EMPAQUE (kg) is likewise not stored:
 * it is gramos × cantidad ÷ 1000, exactly as REFERENCIAS.PESO KILO is derived.
 */
export const empaque = sqliteTable(
	'empaque',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		code: text('ID_EVENTO').notNull().unique(),
		orderId: integer('orden_id')
			.notNull()
			.references(() => orders.id),
		lotId: integer('lote_id')
			.notNull()
			.references(() => lots.id),
		date: timestamp('FECHA').notNull(),
		/** The planned line being filled, when this packing answers to one. */
		referenceId: integer('referencia_id').references(() => references.id),
		/** Presentation size. Spelled as the sheet has it, in grams. */
		grams: integer('PESO (g)').notNull(),
		quantity: integer('CANTIDAD').notNull(),
		bagId: integer('bolsa_id').references(() => bags.id),
		grind: text('MOLIENDA').$type<GrindType>().notNull(),
		/** Whether the roasted coffee packed had been sorted. */
		fromSorted: boolean('SELECCIONADO').notNull().default(false),
		/**
		 * Ports INSPECCION EMPAQUE: Aceptado or Rechazado, both named rather than
		 * the sheet's one-sided Yes/No. Descriptive — a rejected batch is still
		 * coffee in bags, and the weight moves either way. Unpacking it is a
		 * correction, which is an undo.
		 */
		inspection: text('INSPECCION EMPAQUE').$type<PackingInspection>().notNull(),
		staffId: integer('responsable_id')
			.notNull()
			.references(() => staff.id),
		notes: text('OBSERVACIONES'),
		deletedAt: timestamp('borrado_en')
	},
	(t) => [index('empaque_lot_idx').on(t.lotId), index('empaque_order_idx').on(t.orderId)]
);

/**
 * REGISTRO — the append-only weight ledger.
 *
 * Never user-facing. Every row is a *signed* change, so a balance is a SUM and
 * nothing depends on row order. Corrections are compensating rows, never edits:
 * deleting an entry with newer entries in front of it causes exactly the
 * problems an append-only log exists to prevent.
 *
 * There is no MOTIVO column. Every distinction one would draw is already in
 * `evento_tipo`: weight leaving through a movimiento crossed to another lot, and
 * weight lost inside a trilla, selección or tostión is merma. Defects and
 * quakers need no code of their own — weight that left during selección is
 * merma by definition.
 *
 * Merma is likewise never stored. It is `PESO INICIAL − peso actual`, which is
 * why trilla, selección and tostión are allowed to post rows that do not
 * balance, while movimientos and empaques must.
 */
export const ledger = sqliteTable(
	'registro',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** Denormalised so an order's whole ledger is one indexed read. */
		orderId: integer('orden_id')
			.notNull()
			.references(() => orders.id),
		lotId: integer('lote_id')
			.notNull()
			.references(() => lots.id),
		/** The form the coffee is in. EMPACADO is a form, not an exit. */
		state: text('ESTADO').$type<LedgerState>().notNull(),
		/** The quality flag, split out of the old ESTADO ACTUAL string. */
		selected: boolean('SELECCIONADO').notNull().default(false),
		/** Signed: negative takes weight out of the bucket. */
		kilos: real('PESO (kg)').notNull(),
		eventType: text('evento_tipo').$type<EventType>().notNull(),
		/** Row in the table named by `evento_tipo`; resolved in code, not by a FK. */
		eventId: integer('evento_id').notNull(),
		/** Set on compensating rows, pointing at the entry they undo. */
		reversesId: integer('revierte_id')
	},
	(t) => [
		index('ledger_lot_idx').on(t.lotId),
		index('ledger_order_idx').on(t.orderId),
		index('ledger_event_idx').on(t.eventType, t.eventId)
	]
);

/**
 * Generic audit log. Replaces CHANGELOG, which only recorded a lot's previous
 * status string — no weights, no operator, no field values.
 *
 * This table handles descriptive field edits only. Weight and lot lineage are
 * corrected by compensating events in the ledger, not by unwinding rows.
 */
export const audit = sqliteTable(
	'auditoria',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		table: text('tabla').notNull(),
		rowId: integer('fila_id').notNull(),
		field: text('campo').notNull(),
		previousValue: text('valor_previo'),
		newValue: text('valor_nuevo'),
		user: text('usuario'),
		date: timestamp('fecha').notNull()
	},
	(t) => [index('audit_row_idx').on(t.table, t.rowId)]
);

export type Client = typeof clients.$inferSelect;
export type Farm = typeof farms.$inferSelect;
export type Bag = typeof bags.$inferSelect;
export type Staff = typeof staff.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Lot = typeof lots.$inferSelect;
export type Reference = typeof references.$inferSelect;
export type Movement = typeof movements.$inferSelect;
export type Trilla = typeof trilla.$inferSelect;
export type Seleccion = typeof seleccion.$inferSelect;
export type Tostion = typeof tostion.$inferSelect;
export type LedgerEntry = typeof ledger.$inferSelect;
