/**
 * MOVIMIENTOS — the only writer of lineage.
 *
 * A movimiento is written when, and only when, coffee acquires an identity that
 * can no longer be attributed to exactly one parent: a lot is born, or weight
 * crosses between lots. Weight moving inside a single lot is a process event and
 * never comes through here.
 *
 * Process steps call `recordMovimiento` themselves, inside their own
 * transaction, so an operator never fills in a movimiento form for a split that
 * is inherent to a step. The form exists for the standalone cases.
 */

import { and, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "./db/index.ts";
import { ledger, lots, movements, orders, staff } from "./db/schema.ts";
import { postEntries } from "./ledger.ts";
import { nextEventCode } from "./eventCodes.ts";
import { lotCode } from "../domain/codes.ts";
import { nextLotLetter } from "./lots.ts";
import { isEmpty, summarise, totalOf } from "../domain/ledger.ts";
import { validateOriginCount } from "../domain/validation.ts";
import type { EventFilter } from "../domain/eventFilter.ts";
import { conditionsFor } from "./eventFilter.ts";
import { lotLabel, lotStatus } from "../domain/lotState.ts";
import { orderLedgers } from "./ledger.ts";
import {
  ACTIONS_CREATING_LOT,
  type EventType,
  type LedgerState,
  type MovementAction,
  type RawMaterial,
  type Screen,
  type SelectionMethods,
  type SelectionStage,
} from "../domain/vocabulary.ts";

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Weight taken from one origin lot. Several legs make an arbitrary-size combo.
 *
 * `state` is optional because a manual movimiento moves whatever the lot is
 * holding: the operator says which lot and how much, not which bucket. Process
 * steps, which do know, pass it explicitly.
 */
export type MovementLeg = {
  lotId: number;
  state?: LedgerState;
  selected?: boolean;
  kilos: number;
};

export type NewMovement = {
  orderId: number;
  action: MovementAction;
  legs: MovementLeg[];
  staffId: number;
  /** Existing destination. Required by TRANSFERIR, ignored by the other two. */
  destinationLotId?: number;
  /** The process step that emitted this, when one did. */
  event?: { type: EventType; id: number };
  date?: Date;
  /**
   * Fields to set on the lot this creates, beyond what it inherits from its
   * parent. A trilla's malla lot is almendra rather than pergamino, and carries
   * only the screen it was separated on.
   */
  lotOverrides?: Partial<{
    rawMaterial: RawMaterial;
    screens: Screen[];
    status: string;
    /** What the new lot is: "MALLA 14", "QUAKER". */
    kind: string;
    /** For a lot that is not going to be sorted at all — see the quaker lot. */
    selectionStages: SelectionStage[];
    selectionMethods: SelectionMethods | null;
    addQuaker: boolean | null;
  }>;
};

/**
 * Writes a movimiento: the header, its destination lot when it creates one, and
 * the ledger legs.
 *
 * The legs always balance — every kilo taken from an origin arrives at the
 * destination — which is the difference between a movimiento and a process step.
 * A step may lose weight; that loss is merma. Moving coffee between lots cannot
 * create or destroy any.
 */
export function recordMovimiento(tx: Db, input: NewMovement): number {
  if (input.legs.length === 0)
    throw new Error("Un movimiento necesita al menos un lote origen.");

  const originIds = [...new Set(input.legs.map((leg) => leg.lotId))];
  const creates = ACTIONS_CREATING_LOT.includes(input.action);

  // Ported from the workbook's Valid If, plus the floor of two: only a combo may
  // draw on several lots, and a combo of one is not a combo — it would mint a
  // new identity for coffee that still has exactly one parent.
  const countError = validateOriginCount(input.action, originIds.length);
  if (countError) throw new Error(countError);

  const total = input.legs.reduce((sum, leg) => sum + leg.kilos, 0);
  if (isEmpty(total) || total < 0)
    throw new Error("El peso del movimiento debe ser mayor que cero.");

  /**
   * Mixing is checked by status or by bucket, depending on what the caller was
   * able to say.
   *
   * Statuses are the right question when someone picks whole lots off a list.
   * They are the wrong one once a leg names its bucket: a lot part way through
   * a roast reads EN PROCESO TOSTION while the almendra it is handing over is
   * plain green, and refusing that would let the summary overrule the fact.
   *
   * What survives either way is the destination: a lot cannot be given coffee
   * unlike what it already holds, however the origin was described.
   */
  const named = input.legs.every((leg) => leg.state !== undefined || leg.selected !== undefined);
  if (!input.event) {
    if (named) {
      requireOneKind(input.legs);
      requireMatchingDestination(tx, input.legs, input.destinationLotId);
    } else {
      requireSameKind(tx, originIds, input.destinationLotId);
    }
  }

  const [order] = tx
    .select()
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1)
    .all();
  if (!order) throw new Error("La orden no existe.");

  const destinationId = creates
    ? createDestinationLot(
        tx,
        order.id,
        order.code,
        originIds[0],
        input.lotOverrides,
      )
    : input.destinationLotId;

  if (!destinationId) throw new Error("Seleccione el lote destino.");
  if (originIds.includes(destinationId)) {
    throw new Error("El lote destino no puede ser también el origen.");
  }

  // Where each leg takes its coffee from, when the caller did not say.
  const resolved = input.legs.map((leg) => resolveLeg(tx, leg));

  /*
   * Packed coffee does not move.
   *
   * EMPACADO is a form, not a place: the weight is in bags, labelled, against a
   * line of the client's packaging plan. Combining it into another lot, or
   * splitting it off, would describe bags that do not exist and leave the
   * empaque events pointing at coffee their lot no longer holds. The way back
   * is to undo the empaque, which puts the weight back in TOSTADO where a
   * movimiento can reach it.
   */
  if (resolved.some((leg) => leg.state === "EMPACADO")) {
    throw new Error(
      "El café empacado no se mueve: deshaga primero el empaque.",
    );
  }

  const date = input.date ?? new Date();

  const [created] = tx
    .insert(movements)
    .values({
      code: nextEventCode(
        tx,
        movements,
        movements.orderId,
        order.id,
        order.code,
        "MV",
      ),
      orderId: order.id,
      action: input.action,
      originLotIds: originIds,
      destinationLotId: destinationId,
      date,
      staffId: input.staffId,
      eventType: input.event?.type ?? null,
      eventId: input.event?.id ?? null,
    })
    .returning({ id: movements.id })
    .all();

  // Two entries per leg: out of the origin, into the destination. The coffee
  // keeps its form and its sorted flag — a movimiento moves weight, it does not
  // process it.
  postEntries(
    tx,
    resolved.flatMap((leg) => [
      {
        orderId: order.id,
        lotId: leg.lotId,
        state: leg.state,
        selected: leg.selected,
        kilos: -leg.kilos,
        eventType: "movimiento" as const,
        eventId: created.id,
      },
      {
        orderId: order.id,
        lotId: destinationId,
        state: leg.state,
        selected: leg.selected,
        kilos: leg.kilos,
        eventType: "movimiento" as const,
        eventId: created.id,
      },
    ]),
  );

  return created.id;
}

/**
 * Refuses a combo of different coffees.
 *
 * The origin half of the same rule: naming buckets makes each leg precise, and
 * two precise legs can still be almendra and tostado. A destination check does
 * not catch it — SEPARAR and COMBINAR create their destination, so there is
 * nothing yet to disagree with.
 */
function requireOneKind(legs: MovementLeg[]): void {
  const kinds = new Set(legs.map((leg) => `${leg.state}·${leg.selected ?? false}`));
  if (kinds.size > 1) {
    throw new Error(
      "No se puede mezclar café de distinta clase en un mismo movimiento.",
    );
  }
}

/**
 * Refuses to pour coffee into a lot that is holding something else.
 *
 * The bucket-level half of `requireSameKind`, for legs that named what they are
 * moving. An empty lot — or one this movimiento is about to create — takes
 * whatever it is given.
 */
function requireMatchingDestination(
  tx: Db,
  legs: MovementLeg[],
  destinationId?: number,
): void {
  if (!destinationId) return;

  const entries = tx
    .select()
    .from(ledger)
    .where(eq(ledger.lotId, destinationId))
    .all();
  const { balances } = summarise(entries);
  if (isEmpty(totalOf(balances))) return;

  const held = new Set(
    (
      [
        ["VERDE", false, balances.verde],
        ["VERDE", true, balances.verdeSel],
        ["TOSTADO", false, balances.tostado],
        ["TOSTADO", true, balances.tostadoSel],
        ["EMPACADO", false, balances.empacado],
      ] as const
    )
      .filter(([, , kilos]) => !isEmpty(kilos))
      .map(([state, selected]) => `${state}·${selected}`),
  );

  for (const leg of legs) {
    if (leg.state && !held.has(`${leg.state}·${leg.selected ?? false}`)) {
      throw new Error(
        "El lote destino tiene café de otra clase: no se pueden mezclar.",
      );
    }
  }
}

/**
 * Refuses to mix kinds of coffee.
 *
 * Pergamino, almendra and tostado are different things, and a lot holding two of
 * them at once could not be described — its status is one string and its next
 * step one instruction. The ledger cannot catch this on its own: CPS and AV are
 * both unsorted green in the balances, and only the lot's status tells them
 * apart.
 *
 * The destination is included when it already holds something; an empty lot, or
 * one the movimiento is about to create, takes whatever it is given.
 */
function requireSameKind(
  tx: Db,
  originIds: number[],
  destinationId?: number,
): void {
  const ids = destinationId ? [...originIds, destinationId] : originIds;

  const kinds = new Map<string, string>();
  for (const id of ids) {
    const [lot] = tx.select().from(lots).where(eq(lots.id, id)).limit(1).all();
    if (!lot) throw new Error("El lote no existe.");

    const entries = tx.select().from(ledger).where(eq(ledger.lotId, id)).all();
    const summary = summarise(entries);

    // An empty destination is not yet any kind of coffee.
    if (id === destinationId && isEmpty(totalOf(summary.balances))) continue;

    kinds.set(
      lotLabel({ ...lot, status: lotStatus(lot, summary) }),
      lotStatus(lot, summary),
    );
  }

  const distinct = new Set(kinds.values());
  if (distinct.size > 1) {
    throw new Error(
      `No se puede mezclar café en distinto estado: ${[...distinct].join(" y ")}.`,
    );
  }
}

/**
 * Decides which bucket a leg draws from when the caller did not name one.
 *
 * A lot normally holds coffee in a single form, so this is unambiguous. When it
 * holds two at once — mid-roast, or half sorted — the movimiento is refused:
 * "move 5 kg" has no single answer there, and guessing would silently move the
 * wrong coffee.
 */
function resolveLeg(
  tx: Db,
  leg: MovementLeg,
): { lotId: number; state: LedgerState; selected: boolean; kilos: number } {
  if (leg.state) {
    return {
      lotId: leg.lotId,
      state: leg.state,
      selected: leg.selected ?? false,
      kilos: leg.kilos,
    };
  }

  const rows = tx
    .select()
    .from(ledger)
    .where(eq(ledger.lotId, leg.lotId))
    .all();
  const { balances } = summarise(rows);

  const held = (
    [
      ["VERDE", false, balances.verde],
      ["VERDE", true, balances.verdeSel],
      ["TOSTADO", false, balances.tostado],
      ["TOSTADO", true, balances.tostadoSel],
      ["EMPACADO", false, balances.empacado],
    ] as const
  ).filter(([, , kilos]) => !isEmpty(kilos));

  if (held.length === 0)
    throw new Error("El lote origen no tiene café disponible.");
  if (held.length > 1) {
    /**
     * A lot can hold coffee in more than one bucket for perfectly ordinary
     * reasons: half of it sorted and half not, or half roasted while the rest
     * waits for the next batch. Moving from such a lot is a real thing to want
     * — separate the part still unroasted, hand over the part already sorted —
     * and "move 5 kg" simply does not say which.
     *
     * So the leg names its bucket and this takes it from there. The new lot
     * then holds one kind of coffee and reads by what it received rather than
     * inheriting "en proceso" from a parent it only took half of.
     */
    const matches = held.filter(
      ([state, selected]) =>
        (leg.state === undefined || state === leg.state) &&
        (leg.selected === undefined || selected === leg.selected),
    );

    if (matches.length !== 1) {
      throw new Error(
        "El lote tiene café en más de un estado: indique cuál de las partes mueve.",
      );
    }

    const [state, selected] = matches[0];
    return { lotId: leg.lotId, state, selected, kilos: leg.kilos };
  }

  const [state, selected] = held[0];
  return { lotId: leg.lotId, state, selected, kilos: leg.kilos };
}

/**
 * Creates the lot a SEPARAR or COMBINAR produces.
 *
 * Its descriptive fields are copied from the first origin, because they are
 * facts about the coffee rather than about the movimiento: same farm, same
 * variety, same beneficio, same specification. Only the identity is new.
 *
 * PESO INICIAL is zero: the lot's weight arrives through the ledger legs, and
 * the column means "what was received from the client", which for a lot born on
 * the floor is nothing.
 */
function createDestinationLot(
  tx: Db,
  orderId: number,
  orderCode: string,
  parentId: number,
  overrides: NewMovement["lotOverrides"] = {},
): number {
  const [parent] = tx
    .select()
    .from(lots)
    .where(eq(lots.id, parentId))
    .limit(1)
    .all();
  if (!parent) throw new Error("El lote origen no existe.");

  const letter = nextLotLetter(tx, orderId);

  const [created] = tx
    .insert(lots)
    .values({
      code: lotCode(orderCode, letter),
      orderId,
      letter,
      rawMaterial: parent.rawMaterial,
      initialWeight: 0,
      variety: parent.variety,
      process: parent.process,
      humidity: parent.humidity,
      farmId: parent.farmId,
      selectionStages: parent.selectionStages,
      selectionMethods: parent.selectionMethods,
      roastType: parent.roastType,
      screens: parent.screens,
      addQuaker: parent.addQuaker,
      storeInWarehouse: parent.storeInWarehouse,
      // Still written because the column exists; nothing reads it.
      status: parent.rawMaterial,
      ...overrides,
    })
    .returning({ id: lots.id })
    .all();

  return created.id;
}

/**
 * Whether a movimiento is still the latest thing to have happened to every lot
 * it touched — the one condition under which undoing it is safe.
 *
 * Shared by `undoMovimiento` and the list, so a row only offers an × when
 * pressing it will work. Entries that have been reversed, and the reversals
 * themselves, cancel out: undoing the newest movimiento leaves the one before
 * it undoable again.
 */
function isUndoable(
  tx: Db,
  id: number,
  legs: { id: number; lotId: number }[],
): boolean {
  if (legs.length === 0) return false;

  const involved = [...new Set(legs.map((leg) => leg.lotId))];
  const lastLegId = Math.max(...legs.map((leg) => leg.id));

  const newer = tx
    .select({ id: ledger.id, reversesId: ledger.reversesId })
    .from(ledger)
    .where(and(inArray(ledger.lotId, involved), gt(ledger.id, lastLegId)))
    .all();

  const reversed = new Set(
    tx
      .select({ id: ledger.reversesId })
      .from(ledger)
      .where(isNotNull(ledger.reversesId))
      .all()
      .map((row) => row.id),
  );

  return !newer.some(
    (entry) => entry.reversesId === null && !reversed.has(entry.id),
  );
}

/**
 * Undoes a movimiento.
 *
 * The ledger is append-only, so nothing is erased: the legs are posted again
 * with the opposite sign, which puts every kilo back where it came from. The
 * movimiento is then soft-deleted so it leaves the list, and the lot it created
 * goes with it — but only if that lot is now empty and nothing else ever touched
 * it. A lot that has since been roasted or split is somebody else's history now.
 *
 * Refused when the coffee has moved on, because putting it back would take it
 * from a lot that no longer has it — which the negative-balance check would
 * catch anyway, less legibly.
 */
export async function undoMovimiento(id: number): Promise<void> {
  return db.transaction((tx) => undoMovimientoIn(tx, id));
}

/**
 * Rewrites a movimiento, weights and lots included.
 *
 * Allowed under exactly the condition undoing is, and refused for the same
 * reasons — a movimiento a process step emitted belongs to that step, and is
 * edited by editing it. Unwinding and rewriting happens in one transaction, so
 * the ledger keeps its append-only shape: the old legs are reversed rather than
 * edited, and the destination lot is created afresh.
 */
export async function updateMovimiento(
  id: number,
  input: Omit<NewMovement, "orderId">,
): Promise<number> {
  return db.transaction((tx) => {
    const [movement] = tx
      .select()
      .from(movements)
      .where(eq(movements.id, id))
      .limit(1)
      .all();
    if (!movement) throw new Error("El movimiento no existe.");

    undoMovimientoIn(tx, id);
    return recordMovimiento(tx, { ...input, orderId: movement.orderId });
  });
}

/**
 * The work of undoing, inside a caller's transaction.
 *
 * `allowEmitted` is how a process step undoes the movimientos it created. From
 * the movimientos list those are refused: pulling a trilla's malla lot out from
 * under it would leave the trilla claiming a split that no longer exists. The
 * trilla's own undo passes this flag and takes both apart together.
 */
export function undoMovimientoIn(
  tx: Db,
  id: number,
  { allowEmitted = false }: { allowEmitted?: boolean } = {},
): void {
  {
    const [movement] = tx
      .select()
      .from(movements)
      .where(eq(movements.id, id))
      .limit(1)
      .all();
    if (!movement) throw new Error("El movimiento no existe.");
    if (movement.deletedAt) throw new Error("Ese movimiento ya fue deshecho.");

    if (movement.eventType && !allowEmitted) {
      throw new Error(
        `Este movimiento lo generó un paso del proceso (${movement.eventType}). ` +
          "Deshaga ese registro y el movimiento se va con él.",
      );
    }

    const legs = tx
      .select()
      .from(ledger)
      .where(and(eq(ledger.eventType, "movimiento"), eq(ledger.eventId, id)))
      .all();

    if (!isUndoable(tx, id, legs)) {
      throw new Error(
        "No se puede deshacer: alguno de estos lotes tiene movimientos o procesos posteriores. " +
          "Deshaga primero el más reciente.",
      );
    }

    postEntries(
      tx,
      legs.map((leg) => ({
        orderId: leg.orderId,
        lotId: leg.lotId,
        state: leg.state,
        selected: leg.selected,
        kilos: -leg.kilos,
        eventType: "movimiento" as const,
        eventId: id,
        reversesId: leg.id,
      })),
    );

    tx.update(movements)
      .set({ deletedAt: new Date() })
      .where(eq(movements.id, id))
      .run();

    // The lot it created has no reason to exist without it.
    if (ACTIONS_CREATING_LOT.includes(movement.action)) {
      const [created] = tx
        .select({ code: lots.code })
        .from(lots)
        .where(eq(lots.id, movement.destinationLotId))
        .limit(1)
        .all();

      tx.update(lots)
        .set({
          deletedAt: new Date(),
          // Retires the code as well as the letter. Codes are issued once and
          // never recomputed — but this one was never issued to anything real,
          // and ID_LOTE is unique, so the row has to stop holding the name
          // before it can be given to the next lot.
          code: `${created.code}-ANULADO-${movement.destinationLotId}`,
        })
        .where(eq(lots.id, movement.destinationLotId))
        .run();
    }
  }
}

/** A movimiento as the UI shows it, with lot codes instead of ids. */
export type MovementRow = {
  id: number;
  code: string;
  /** The order this belongs to, for the views that span several. */
  orderId: number;
  orderCode: string;
  action: MovementAction;
  date: Date;
  origins: string[];
  /** Ids alongside the letters, so a diagram can link to each lot. */
  originIds: number[];
  /** ID_LOTE per origin, in the same order — what their links are built from. */
  originCodes: string[];
  /** The full name of each origin, for the pickers an edit has to fill. */
  originLabels: string[];
  /** What each origin contributed, in the same order — a combo is rarely even. */
  originKilos: number[];
  destination: string;
  destinationId: number;
  destinationCode: string;
  /** Its full name, for the detail view — the table shows letters. */
  destinationLabel: string;
  kilos: number;
  staffName: string | null;
  /** Null when an operator entered it by hand. */
  emittedBy: EventType | null;
  /** False while a newer movimiento or process stands on top of this one. */
  canUndo: boolean;
  /** The movimiento as its form holds it, for editing. */
  edit: {
    action: MovementAction;
    destinationLotId: number;
    staffId: number;
    legs: { lotId: number; kilos: number }[];
  };
};

/**
 * Movimientos of one order, newest first. Optionally narrowed to a single lot,
 * which is what the lot page shows: everything that touched *this* lot, whether
 * it arrived or left.
 */
export async function listMovimientos(
  filter: EventFilter,
): Promise<MovementRow[]> {
  const rows = await db
    .select({
      movement: movements,
      staffName: staff.name,
      orderCode: orders.code,
    })
    .from(movements)
    .innerJoin(orders, eq(movements.orderId, orders.id))
    .leftJoin(staff, eq(movements.staffId, staff.id))
    .where(
      and(
        isNull(movements.deletedAt),
        // A movimiento names no single lot column, so `lotId` is applied below
        // against both ends of it.
        ...conditionsFor(
          { orderId: filter.orderId, staffId: filter.staffId },
          movements,
        ),
      ),
    );

  // Lots of every order these movimientos touch: a person's page spans orders.
  const orderIds = [...new Set(rows.map(({ movement }) => movement.orderId))];
  const lotRows = orderIds.length
    ? await db
        .select({
          id: lots.id,
          code: lots.code,
          letter: lots.letter,
          variety: lots.variety,
          kind: lots.kind,
        })
        .from(lots)
        .where(and(inArray(lots.orderId, orderIds), isNull(lots.deletedAt)))
    : [];

  const nameOf = new Map(lotRows.map((lot) => [lot.id, lot.letter]));
  const codeOf = new Map(lotRows.map((lot) => [lot.id, lot.code]));
  // The name a lot reads by everywhere else, for the edit form's picker.
  const labelOf = new Map(
    lotRows.map((lot) => [
      lot.id,
      `${lot.letter} - ${lot.variety}${lot.kind ? ` ${lot.kind}` : ""}`,
    ]),
  );

  // Weight per movimiento: the positive legs, which is what arrived at the
  // destination and therefore what the movimiento moved.
  const entries = orderIds.length
    ? await db
        .select({
          id: ledger.id,
          eventId: ledger.eventId,
          lotId: ledger.lotId,
          kilos: ledger.kilos,
          reversesId: ledger.reversesId,
        })
        .from(ledger)
        .where(
          and(
            inArray(ledger.orderId, orderIds),
            eq(ledger.eventType, "movimiento"),
          ),
        )
    : [];

  const kilosOf = new Map<number, number>();
  // Per origin, too: the diagram shows what each lot gave, not just the total.
  const takenFrom = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kilos > 0) {
      kilosOf.set(
        entry.eventId,
        (kilosOf.get(entry.eventId) ?? 0) + entry.kilos,
      );
    } else {
      const key = `${entry.eventId}·${entry.lotId}`;
      takenFrom.set(key, (takenFrom.get(key) ?? 0) - entry.kilos);
    }
  }

  const legsOf = new Map<number, { id: number; lotId: number }[]>();
  for (const entry of entries) {
    const list = legsOf.get(entry.eventId) ?? [];
    list.push({ id: entry.id, lotId: entry.lotId });
    legsOf.set(entry.eventId, list);
  }

  return rows
    .filter(
      ({ movement }) =>
        filter.lotId === undefined ||
        movement.destinationLotId === filter.lotId ||
        movement.originLotIds.includes(filter.lotId),
    )
    .map(({ movement, staffName, orderCode }) => ({
      id: movement.id,
      code: movement.code,
      orderId: movement.orderId,
      orderCode,
      action: movement.action,
      date: movement.date,
      origins: movement.originLotIds.map((id) => nameOf.get(id) ?? "—"),
      originIds: movement.originLotIds,
      originCodes: movement.originLotIds.map((id) => codeOf.get(id) ?? ""),
      originLabels: movement.originLotIds.map((id) => labelOf.get(id) ?? "—"),
      originKilos: movement.originLotIds.map(
        (lotId) => takenFrom.get(`${movement.id}·${lotId}`) ?? 0,
      ),
      destination: nameOf.get(movement.destinationLotId) ?? "—",
      destinationId: movement.destinationLotId,
      destinationCode: codeOf.get(movement.destinationLotId) ?? "",
      destinationLabel: labelOf.get(movement.destinationLotId) ?? "—",
      kilos: kilosOf.get(movement.id) ?? 0,
      staffName,
      emittedBy: movement.eventType,
      // Emitted movimientos are undone through the step that made them.
      canUndo:
        movement.eventType === null &&
        isUndoable(db, movement.id, legsOf.get(movement.id) ?? []),
      edit: {
        action: movement.action,
        destinationLotId: movement.destinationLotId,
        staffId: movement.staffId,
        legs: movement.originLotIds.map((lotId) => ({
          lotId,
          kilos: takenFrom.get(`${movement.id}·${lotId}`) ?? 0,
        })),
      },
    }))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

/** Lineage for the board: which lots fed this one, and which it fed. */
export async function lineageByLot(): Promise<
  Map<number, { origins: number[]; created: number[] }>
> {
  const rows = await db
    .select()
    .from(movements)
    .where(isNull(movements.deletedAt));
  const map = new Map<number, { origins: number[]; created: number[] }>();

  const entryFor = (lotId: number) => {
    const existing = map.get(lotId);
    if (existing) return existing;
    const fresh = { origins: [] as number[], created: [] as number[] };
    map.set(lotId, fresh);
    return fresh;
  };

  for (const movement of rows) {
    entryFor(movement.destinationLotId).origins.push(...movement.originLotIds);
    for (const originId of movement.originLotIds) {
      entryFor(originId).created.push(movement.destinationLotId);
    }
  }

  return map;
}

/** A lot as a node in the lineage diagram. */
export type LineageNode = {
  id: number;
  /** ID_LOTE, which is what the diagram's links are built from. */
  code: string;
  letter: string;
  label: string;
  status: string;
};

/** A movimiento as an edge: coffee crossing from one lot to another. */
export type LineageEdge = { from: number; to: number; kilos: number };

export type LineageGraph = { nodes: LineageNode[]; edges: LineageEdge[] };

/**
 * The whole order's lineage, as a directed graph.
 *
 * Per-order rather than per-lot because the interesting shapes only appear
 * across two hops: a lot split into D and then recombined with D is a diamond,
 * and the neighbourhood of any single lot cannot show it.
 *
 * Only lots that actually take part appear — an order where nothing has been
 * split or combined has no diagram to draw.
 */
export async function lineageGraph(orderId: number): Promise<LineageGraph> {
  const [rows, lotRows, entries] = await Promise.all([
    db
      .select()
      .from(movements)
      .where(and(eq(movements.orderId, orderId), isNull(movements.deletedAt))),
    db
      .select()
      .from(lots)
      .where(and(eq(lots.orderId, orderId), isNull(lots.deletedAt))),
    db
      .select({
        eventId: ledger.eventId,
        lotId: ledger.lotId,
        kilos: ledger.kilos,
      })
      .from(ledger)
      .where(
        and(eq(ledger.orderId, orderId), eq(ledger.eventType, "movimiento")),
      ),
  ]);

  // What each origin gave to each movimiento, so an edge can carry its weight.
  const gave = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kilos < 0) {
      const key = `${entry.eventId}·${entry.lotId}`;
      gave.set(key, (gave.get(key) ?? 0) - entry.kilos);
    }
  }

  const edges: LineageEdge[] = rows.flatMap((movement) =>
    movement.originLotIds.map((originId) => ({
      from: originId,
      to: movement.destinationLotId,
      kilos: gave.get(`${movement.id}·${originId}`) ?? 0,
    })),
  );

  const involved = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  const byId = new Map(lotRows.map((lot) => [lot.id, lot]));

  const ledgers = await orderLedgers(orderId);

  const nodes: LineageNode[] = [...involved]
    .map((id) => byId.get(id))
    .filter((lot) => lot !== undefined)
    .map((lot) => ({
      id: lot.id,
      code: lot.code,
      letter: lot.letter,
      label: `${lot.letter} - ${lot.variety}${lot.kind ? ` ${lot.kind}` : ""}`,
      status: lotStatus(lot, ledgers.get(lot.id)),
    }));

  return { nodes, edges };
}
