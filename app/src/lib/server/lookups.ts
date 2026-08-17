/**
 * Lookup tables that feed the reference (`ref`) fields in forms: clients, farms
 * and bags. Kept separate from order queries so the forms have one obvious
 * place to get their option lists.
 */

import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from './db/index.ts';
import { bags, clients, farms, lots, staff } from './db/schema.ts';
import { clientPrefix } from '../domain/codes.ts';
import { VARIETIES } from '../domain/vocabulary.ts';
import { formatKilos } from '../domain/derived.ts';
import { greenOf, NO_LEDGER, roastedOf, totalOf, type LotLedger } from '../domain/ledger.ts';
import { estimatedGreenKilos } from '../domain/estimates.ts';
import { lotLabel, lotStatus } from '../domain/lotState.ts';
import { orderLedgers } from './ledger.ts';
import type { FieldOption } from '../fields/types.ts';
import type { BagOption } from '../fields/reference.ts';

/** Every live client, alphabetically. */
export async function listClients() {
	return db.select().from(clients).where(isNull(clients.deletedAt)).orderBy(asc(clients.name));
}

/**
 * Client options. The dropdown shows the client name only — the brand appears
 * in its own field once a client is picked, so repeating it here is noise.
 */
export async function clientOptions(): Promise<FieldOption[]> {
	const rows = await listClients();
	return rows.map((client) => ({
		value: String(client.id),
		label: client.name
	}));
}

/** Farm options for the lot form. */
export async function farmOptions(): Promise<FieldOption[]> {
	const rows = await db
		.select()
		.from(farms)
		.where(isNull(farms.deletedAt))
		.orderBy(asc(farms.name));

	return rows.map((farm) => ({
		value: String(farm.id),
		label: farm.name,
		hint: farm.farmer ?? undefined
	}));
}

/**
 * Bag options for the reference form. Carries `sizeGrams` so the size-match
 * rule can be checked without a second lookup.
 */
export async function bagOptions(): Promise<BagOption[]> {
	const rows = await db.select().from(bags).where(isNull(bags.deletedAt)).orderBy(asc(bags.code));

	return rows.map((bag) => ({
		value: String(bag.id),
		label: bag.description ?? bag.code,
		hint: bag.sizeGrams ? `${bag.sizeGrams} g` : undefined,
		sizeGrams: bag.sizeGrams,
		code: bag.code
	}));
}

/**
 * Variety suggestions.
 *
 * Variedad is not a table — it is a plain string on a lot. So instead of
 * maintaining a catalogue, the suggestions are the varieties already recorded,
 * merged with a seed list for a database with no lots yet. Typing a new variety
 * therefore makes it appear in every later dropdown, with nothing to administer.
 */
export async function varietyOptions(): Promise<FieldOption[]> {
	const used = await db
		.selectDistinct({ variety: lots.variety })
		.from(lots)
		.where(isNull(lots.deletedAt));

	const merged = new Set<string>([...VARIETIES, ...used.map((row) => row.variety)]);

	return [...merged]
		.filter((variety) => variety && variety !== 'OTRO')
		.sort((a, b) => a.localeCompare(b, 'es'))
		.map((variety) => ({ value: variety, label: variety }));
}

/** Creates a farm from the inline "+ Nueva finca" form. */
export async function createFarm(input: {
	name: string;
	municipality?: string | null;
	department?: string | null;
	farmer?: string | null;
}): Promise<number> {
	const [created] = await db
		.insert(farms)
		.values({
			name: input.name,
			municipality: input.municipality ?? null,
			department: input.department ?? null,
			farmer: input.farmer ?? null
		})
		.returning({ id: farms.id });

	return created.id;
}

/**
 * Creates a client from the inline "+ Nuevo" form. The prefix is computed once
 * and stored, so renaming the brand later never changes issued order codes.
 */
export async function createClient(input: {
	name: string;
	brand?: string | null;
	owner?: string | null;
	country?: string | null;
}): Promise<number> {
	const [created] = await db
		.insert(clients)
		.values({
			code: crypto.randomUUID().slice(0, 8),
			name: input.name,
			brand: input.brand ?? null,
			owner: input.owner ?? null,
			country: input.country ?? null,
			prefix: clientPrefix(input.name, input.brand)
		})
		.returning({ id: clients.id });

	return created.id;
}

/** What a lot is holding, bucket by bucket, when it holds more than one. */
/**
 * What a movimiento could actually move: everything the lot holds except the
 * part already in bags. Packed coffee is still the lot's weight — it is on the
 * board and in the totals — but it is bagged against a line of the packaging
 * plan, and moving it would describe bags that do not exist.
 */
function movableKilos(ledger: LotLedger): number {
	return totalOf(ledger.balances) - ledger.balances.empacado;
}

function portionsOf(ledger: LotLedger) {
	const held = [
		{ state: 'VERDE' as const, selected: false, label: 'Verde', kilos: ledger.balances.verde },
		{
			state: 'VERDE' as const,
			selected: true,
			label: 'Verde seleccionado',
			kilos: ledger.balances.verdeSel
		},
		{ state: 'TOSTADO' as const, selected: false, label: 'Tostado', kilos: ledger.balances.tostado },
		{
			state: 'TOSTADO' as const,
			selected: true,
			label: 'Tostado seleccionado',
			kilos: ledger.balances.tostadoSel
		},
		{
			state: 'EMPACADO' as const,
			selected: false,
			label: 'Empacado',
			kilos: ledger.balances.empacado
		}
	]
		.filter((portion) => portion.kilos > 0.0005)
		// Packed coffee is shown — a lot that is half bagged should say so while
		// someone decides what to do with the rest — but it cannot be moved, and
		// the form draws it as a fact rather than as a choice.
		.map((portion) => ({ ...portion, movable: portion.state !== 'EMPACADO' }));

	// Always the full list, even when there is one entry: what a lot *is* —
	// green, roasted, sorted — is the question a movimiento actually asks, and a
	// status is only a summary of it. A lot part way through a roast holds the
	// same roasted coffee as a lot that reads TOSTADO.
	return held;
}

/**
 * The pickers a movimiento form needs: this order's live lots with what each is
 * holding, and the staff list.
 *
 * `availableKilos` is what caps a leg. It is the lot's whole balance rather than
 * one bucket, because the form moves coffee in whatever form the lot is holding
 * — changing form is a process step's job, never a movimiento's.
 */
export async function movementOptions(orderId: number) {
	const [lotRows, staffRows, ledgers] = await Promise.all([
		db
			.select()
			.from(lots)
			.where(and(eq(lots.orderId, orderId), isNull(lots.deletedAt))),
		db.select().from(staff).where(isNull(staff.deletedAt)),
		orderLedgers(orderId)
	]);

	return {
		// Lots holding nothing are left out. An emptied lot has been combined away:
		// there is nothing to move from it and nothing sensible to move into it, so
		// offering it is offering a mistake. Its history stays on its own page.
		//
		// The other pickers already do this by asking for a specific bucket —
		// trilla wants pergamino, tostión green, empaque roasted — and a lot at
		// zero has none of them. This list is the general one, so it says it.
		// A lot whose whole weight is already in bags is left out for the same
		// reason an emptied one is: nothing can leave it and nothing can arrive.
		lots: lotRows
			.filter((lot) => movableKilos(ledgers.get(lot.id) ?? NO_LEDGER) > 0.0005)
			.map((lot) => {
				const ledger = ledgers.get(lot.id) ?? NO_LEDGER;
				const status = lotStatus(lot, ledger);
				return {
					value: String(lot.id),
					// ID_LOTE, for the callers that build links out of these.
					code: lot.code,
					label: lotLabel({ ...lot, status }),
					// Carried twice over: the form refuses to mix kinds of coffee with
					// it — pergamino and almendra are both "green" in the ledger, so the
					// balances alone cannot tell them apart — and the picker draws its
					// mark from it.
					status,
					// What a movimiento may draw on — everything except what is already
					// in bags, which is where the cap has to be for the form to refuse
					// a leg before the server has to.
					availableKilos: movableKilos(ledger),
					hint: `${formatKilos(movableKilos(ledger))} kg`,
					/**
					 * The buckets this lot is holding, when it is holding more than one.
					 *
					 * A movimiento takes coffee, not a lot, and a lot half way through a
					 * roast or a selección is holding two different things at once. The
					 * form asks which; with one bucket there is nothing to ask.
					 */
					portions: portionsOf(ledger)
				};
			}),
		staff: staffRows.map((person) => ({ value: String(person.id), label: person.name }))
	};
}

/**
 * The lots a trilla may act on, with what the form fills itself in from.
 *
 * Ports the workbook's Valid If — pergamino, this order, not going to bodega —
 * but reads the *derived* status rather than the stored column, so the list
 * cannot disagree with what the lots are actually holding.
 */
export async function trillaOptions(orderId: number) {
	const [lotRows, ledgers] = await Promise.all([
		db.select().from(lots).where(and(eq(lots.orderId, orderId), isNull(lots.deletedAt))),
		orderLedgers(orderId)
	]);

	return {
		lots: lotRows
			.filter((lot) => {
				const ledger = ledgers.get(lot.id) ?? NO_LEDGER;
				return !lot.storeInWarehouse && lotStatus(lot, ledger) === 'CPS';
			})
			.map((lot) => {
				const ledger = ledgers.get(lot.id) ?? NO_LEDGER;
				const available = greenOf(ledger.balances);
				const status = lotStatus(lot, ledger);
				return {
					value: String(lot.id),
					label: lotLabel({ ...lot, status }),
					status,
					hint: `${formatKilos(available)} kg`,
					availableKilos: available,
					// What the beneficio predicts, which is what the form opens with.
					estimatedGreenKilos: estimatedGreenKilos({ ...lot, initialWeight: available }),
					screens: (lot.screens ?? []).filter((screen) => screen !== 'Ninguna')
				};
			})
	};
}

/**
 * The lots a selección may act on at one stage.
 *
 * Ports the workbook's Valid If on SELECCION.ID_LOTE, which asked two questions
 * at once: did the client request sorting at this stage, and is the coffee
 * currently in a form that can be sorted there.
 *
 *   verde   → PROCESO SELECCION contains VERDE, and the lot holds almendra
 *   tostado → PROCESO SELECCION contains TOSTADO, and the lot holds roasted
 *
 * Lots bound for bodega never appear, at either stage.
 */
export async function seleccionOptions(orderId: number, stage: 'VERDE' | 'TOSTADO') {
	const [lotRows, ledgers] = await Promise.all([
		db.select().from(lots).where(and(eq(lots.orderId, orderId), isNull(lots.deletedAt))),
		orderLedgers(orderId)
	]);

	return lotRows
		.filter((lot) => {
			if (lot.storeInWarehouse) return false;
			// Quakers are what a selección throws out; sorting them again is sorting
			// the rejects. The lot inherits PROCESO SELECCION from the one it came
			// out of, so nothing else would exclude it.
			if (lot.kind === 'QUAKER') return false;
			if (!lot.selectionStages.includes(stage)) return false;

			const ledger = ledgers.get(lot.id) ?? NO_LEDGER;
			const status = lotStatus(lot, ledger);

			// The status, not just the balance. Pergamino sits in the same VERDE
			// bucket as almendra, and pergamino cannot be sorted — it has to be
			// hulled first. This is the workbook's ESTADO ACTUAL = "AV".
			const sortableHere =
				stage === 'VERDE'
					? status === 'AV' || status === 'EN PROCESO SELECCION'
					: status === 'TOSTADO' ||
						status === 'EN PROCESO TOSTION' ||
						status === 'EN PROCESO SEL-TST';

			if (!sortableHere) return false;

			// And something unsorted left to sort.
			const balances = ledger.balances;
			return (stage === 'VERDE' ? balances.verde : balances.tostado) > 0.0005;
		})
		.map((lot) => {
			const ledger = ledgers.get(lot.id) ?? NO_LEDGER;
			const unsorted = stage === 'VERDE' ? ledger.balances.verde : ledger.balances.tostado;
			return {
				value: String(lot.id),
				label: lotLabel({ ...lot, status: lotStatus(lot, ledger) }),
				status: lotStatus(lot, ledger),
				hint: `${formatKilos(unsorted)} kg sin seleccionar`,
				availableKilos: unsorted,
				// The client's standing instruction: keep the quakers, or discard them.
				keepsQuakers: stage === 'TOSTADO' && lot.addQuaker === true,
				// And how they asked this stage to be sorted, which the form opens on.
				method: lot.selectionMethods?.[stage] ?? ''
			};
		});
}

/**
 * The lots that can go into the roaster.
 *
 * Ports TOSTION.ID_LOTE's Valid If, whose last clause is the one that matters:
 *
 *   NOT(AND(IN("VERDE", [PROCESO SELECCION]), [ESTADO ACTUAL] = "AV"))
 *
 * A lot the client asked to have sorted green, still sitting unsorted, must be
 * sorted before it is roasted — otherwise the sorting it was promised can never
 * happen. Once sorted it reads AV SELECCIONADO and becomes eligible.
 */
export async function tostionOptions(orderId: number) {
	const [lotRows, ledgers] = await Promise.all([
		db.select().from(lots).where(and(eq(lots.orderId, orderId), isNull(lots.deletedAt))),
		orderLedgers(orderId)
	]);

	return lotRows
		.filter((lot) => {
			if (lot.storeInWarehouse) return false;
			if (lot.roastType === 'Ninguno') return false;

			const ledger = ledgers.get(lot.id) ?? NO_LEDGER;
			const status = lotStatus(lot, ledger);

			// The states the sheet listed. Pergamino is excluded by being absent
			// from it: it holds green weight but has to be hulled first, and the
			// balance alone cannot tell the two apart.
			const roastable =
				status === 'AV' ||
				status === 'AV SELECCIONADO' ||
				status === 'EN PROCESO TOSTION' ||
				status === 'EN PROCESO SEL-TST';
			if (!roastable) return false;

			// Still owes a green selección.
			if (lot.selectionStages.includes('VERDE') && status === 'AV') return false;

			return greenOf(ledger.balances) > 0.0005;
		})
		.map((lot) => {
			const ledger = ledgers.get(lot.id) ?? NO_LEDGER;
			const status = lotStatus(lot, ledger);
			const green = greenOf(ledger.balances);
			return {
				value: String(lot.id),
				label: lotLabel({ ...lot, status }),
				status,
				hint: `${formatKilos(green)} kg verdes`,
				availableKilos: green,
				roastType: lot.roastType
			};
		});
}

/** Creates a member of staff from the inline "+ Nuevo responsable". */
export async function createStaff(input: {
	name: string;
	position?: string | null;
}): Promise<number> {
	const [created] = await db
		.insert(staff)
		.values({ name: input.name, position: input.position ?? null })
		.returning({ id: staff.id });

	return created.id;
}

/**
 * The lots that can be packed.
 *
 * Ports EMPAQUE.ID_LOTE's Valid If — this order, not bound for bodega, and in
 * one of the states the sheet listed:
 *
 *   TOSTADO · TST SELECCIONADO · MOLIDO CON QUAKER · EN PROCESO EMPAQUE
 *
 * MOLIDO CON QUAKER is not carried over: it was a state of the old ESTADO
 * ACTUAL string that our buckets cannot produce, since grinding is a property
 * of the presentation (MOLIENDA) and not of the lot. EN PROCESO SEL-TST takes
 * its place in the list — a lot part way through a roasted selección is holding
 * roasted coffee, which is what the sheet was testing for.
 *
 * `availableKilos` is roasted coffee only. Green is not packable, and packed
 * coffee is already in bags.
 */
export async function empaqueOptions(orderId: number) {
	const [lotRows, ledgers] = await Promise.all([
		db.select().from(lots).where(and(eq(lots.orderId, orderId), isNull(lots.deletedAt))),
		orderLedgers(orderId)
	]);

	return lotRows
		.filter((lot) => {
			if (lot.storeInWarehouse) return false;

			const ledger = ledgers.get(lot.id) ?? NO_LEDGER;
			const status = lotStatus(lot, ledger);

			const packable =
				status === 'TOSTADO' ||
				status === 'TST SELECCIONADO' ||
				status === 'EN PROCESO SEL-TST' ||
				status === 'EN PROCESO EMPAQUE';
			if (!packable) return false;

			return roastedOf(ledger.balances) > 0.0005;
		})
		.map((lot) => {
			const ledger = ledgers.get(lot.id) ?? NO_LEDGER;
			const status = lotStatus(lot, ledger);
			const roasted = roastedOf(ledger.balances);
			return {
				value: String(lot.id),
				label: lotLabel({ ...lot, status }),
				status,
				hint: `${formatKilos(roasted)} kg tostados`,
				availableKilos: roasted,
				// The plan's lines are per variety, so the form can propose the line
				// that matches the lot being packed.
				variety: lot.variety
			};
		});
}
