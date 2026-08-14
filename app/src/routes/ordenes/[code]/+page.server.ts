import { error, fail, redirect } from '@sveltejs/kit';
import {
	addLot,
	addReference,
	deleteOrder,
	deleteReference,
	getOrder,
	orderIdFor,
	setOrderPriority,
	setOrderStatus,
	updateOrder,
	updateReference,
	type NewLotInput,
	type NewReferenceInput
} from '$lib/server/orders';
import {
	bagOptions,
	clientOptions,
	createFarm,
	createStaff,
	farmOptions,
	listClients,
	empaqueOptions,
	movementOptions,
	seleccionOptions,
	tostionOptions,
	trillaOptions,
	varietyOptions
} from '$lib/server/lookups';
import { listTrillas, recordTrilla, undoTrilla, updateTrilla } from '$lib/server/trilla';
import {
	listSelecciones,
	recordSeleccion,
	undoSeleccion,
	updateSeleccion
} from '$lib/server/seleccion';
import { listTostiones, recordTostion, undoTostion, updateTostion } from '$lib/server/tostion';
import {
	listEmpaques,
	recordEmpaque,
	referenceProgress,
	undoEmpaque,
	updateEmpaque
} from '$lib/server/empaque';
import {
	lineageByLot,
	lineageGraph,
	listMovimientos,
	recordMovimiento,
	undoMovimiento,
	updateMovimiento
} from '$lib/server/movimientos';
import { db } from '$lib/server/db';
import { orderLedgers, orderSourceMerma } from '$lib/server/ledger';
import { sourceMermaFraction } from '$lib/domain/sourceMerma';
import { lotRow } from '$lib/domain/lotRow';
import { visibleSections } from '$lib/domain/derived';
import type { Actions } from './$types';

export async function load({ params }) {
	// The URL carries ID_ORDEN; everything below works in row ids.
	const id = await orderIdFor(params.code);
	const order = id === null ? null : await getOrder(id);
	if (!order) error(404, 'Orden no encontrada');

	const [clients, clientRows, movements, options, ledgers, farms, bags, varieties] =
		await Promise.all([
			clientOptions(),
			listClients(),
			listMovimientos({ orderId: order.id }),
			movementOptions(order.id),
			orderLedgers(order.id),
			farmOptions(),
			bagOptions(),
			varietyOptions()
		]);

	// The trilla section: what has been hulled, and which lots still can be.
	// Staff comes from `movementOptions` — one list, every form.
	const [trillas, trillaPickers] = await Promise.all([
		listTrillas({ orderId: order.id }),
		trillaOptions(order.id)
	]);

	// Selección happens twice, on either side of the roast; the event is the same
	// and only the eligible lots differ.
	const [greenSelecciones, roastedSelecciones, greenLots, roastedLots, tostiones, tostionLots] =
		await Promise.all([
			listSelecciones({ orderId: order.id }, 'VERDE'),
			listSelecciones({ orderId: order.id }, 'TOSTADO'),
			seleccionOptions(order.id, 'VERDE'),
			seleccionOptions(order.id, 'TOSTADO'),
			listTostiones({ orderId: order.id }),
			tostionOptions(order.id)
		]);

	// Empaque: what has been bagged, which lots still can be, and how far the
	// packaging plan has been filled — the plan travels into the form itself.
	const [empaques, empaqueLots, references] = await Promise.all([
		listEmpaques({ orderId: order.id }),
		empaqueOptions(order.id),
		referenceProgress(order.id)
	]);

	// Lineage twice over: by lot for the two columns, and as a graph for the
	// diagram. Same movimientos, two shapes.
	const [lineage, graph, sourceMerma] = await Promise.all([
		lineageByLot(),
		lineageGraph(order.id),
		orderSourceMerma(order.id)
	]);

	/** Merma belongs to the lot the client sent; derived lots report none. */
	const mermaFor = (lotId: number) => {
		const balance = sourceMerma.get(lotId);
		return balance
			? { lostKilos: balance.lostKilos, fraction: sourceMermaFraction(balance) }
			: null;
	};
	const letterOf = new Map(order.lots.map((lot) => [lot.id, lot.letter]));
	const letters = (ids: number[] | undefined) =>
		[...new Set(ids ?? [])].map((id) => letterOf.get(id) ?? '?').join(', ');

	// The order's merma: what the client sent, less what the order still holds.
	// Equal to the sum over original lots, with nothing counted twice.
	const mermaKilos = [...sourceMerma.values()].reduce((sum, b) => sum + b.lostKilos, 0);
	const receivedKilos = [...sourceMerma.values()].reduce((sum, b) => sum + b.receivedKilos, 0);

	return {
		order,
		merma: {
			kilos: mermaKilos,
			fraction: receivedKilos === 0 ? 0 : mermaKilos / receivedKilos
		},
		// The edit form reuses the creation field definitions, so it needs the
		// same option list and brand map.
		clients,
		brands: Object.fromEntries(clientRows.map((client) => [String(client.id), client.brand ?? ''])),
		movements,
		graph,
		trillas,
		trillaLots: trillaPickers.lots,
		greenSelecciones,
		roastedSelecciones,
		greenSeleccionLots: greenLots,
		roastedSeleccionLots: roastedLots,
		tostiones,
		tostionLots,
		empaques,
		empaqueLots,
		referenceProgress: references,
		// The "+ Nuevo" forms in the section headers reuse the creation form's
		// definitions, so they need the same option lists it does.
		farms,
		bags,
		varieties,
		lotVarieties: [...new Set(order.lots.map((lot) => lot.variety))],
		// Materia prima rows, projected exactly as the floor board projects them —
		// same columns, same rules, one definition.
		lotRows: order.lots.map((lot) => ({
			...lotRow(lot, {
				ledger: ledgers.get(lot.id),
				merma: mermaFor(lot.id),
				hasReferences: order.references.length > 0,
				originLots: letters(lineage.get(lot.id)?.origins),
				createdLots: letters(lineage.get(lot.id)?.created)
			})
		})),
		// Lots with what each is holding, plus the staff list — the movimiento
		// form needs both to cap a leg at the weight that actually exists.
		lotOptions: options.lots,
		staffOptions: options.staff,
		// Which process sections this order's page renders, decided by the lot
		// specifications rather than by whether events happen to exist.
		sections: visibleSections(order.lots)
	};
}

/** The order an action is acting on, from its URL. */
async function orderId(code: string): Promise<number> {
	const id = await orderIdFor(code);
	if (id === null) throw error(404, 'Orden no encontrada');
	return id;
}

export const actions: Actions = {
	/** Status is manual — these buttons are the only thing that changes it. */
	setStatus: async ({ request, params }) => {
		const form = await request.formData();
		const status = String(form.get('status'));
		if (!status) return fail(400, { error: 'Estado inválido.' });

		await setOrderStatus(await orderId(params.code), status as never);
		return { ok: true };
	},

	/** Priority sorts the order to the top of the queue. */
	togglePriority: async ({ request, params }) => {
		const form = await request.formData();
		await setOrderPriority(await orderId(params.code), form.get('priority') === 'true');
		return { ok: true };
	},

	/**
	 * Corrects the order's descriptive fields. Every change is audited, and
	 * ID_ORDEN is never recomputed — see updateOrder.
	 */
	update: async ({ request, params }) => {
		const form = await request.formData();
		const clientId = Number(form.get('clientId'));
		if (!clientId) return fail(400, { error: 'Seleccione un cliente.' });

		await updateOrder(await orderId(params.code), {
			type: String(form.get('type')) as never,
			clientId,
			productLine: (form.get('productLine') as never) || null,
			peelStick: form.get('peelStick') === 'true',
			notes: String(form.get('notes') ?? '') || null
		});

		return { ok: true };
	},

	/**
	 * Records a trilla: the event, its ledger entries, and one lot per screen it
	 * separated — all in one transaction. See recordTrilla.
	 */
	trilla: async ({ request }) => {
		const form = await request.formData();
		const row = JSON.parse(String(form.get('trilla') ?? '{}'));

		try {
			await recordTrilla({
				lotId: Number(row.lotId),
				parchmentKilos: Number(row.parchmentKilos),
				greenKilos: Number(row.greenKilos),
				screens: {
					'14': Number(row.screen14) || 0,
					'15/16': Number(row.screen1516) || 0,
					'17/18': Number(row.screen1718) || 0
				},
				staffId: Number(row.staffId),
				notes: String(row.notes ?? '') || null
			});
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}

		return { ok: true };
	},


	/** Creates a member of staff from any form's "+ Nuevo responsable". */
	createStaff: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'Ingrese el nombre.' });

		const createdStaffId = await createStaff({
			name,
			position: String(form.get('position') ?? '') || null
		});

		return { createdStaffId };
	},

	/** Records one roasting batch. */
	tostion: async ({ request }) => {
		const form = await request.formData();
		const row = JSON.parse(String(form.get('tostion') ?? '{}'));

		try {
			await recordTostion({
				lotId: Number(row.lotId),
				roastType: String(row.roastType) as never,
				batchKilos: Number(row.batchKilos),
				roastedKilos: Number(row.roastedKilos),
				staffId: Number(row.staffId),
				notes: String(row.notes ?? '') || null
			});
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}

		return { ok: true };
	},

	/**
	 * Rewrites one batch. Allowed only while nothing stands on it — the same
	 * condition undoing has, checked by the server, not by the form.
	 */
	editTostion: async ({ request }) => {
		const form = await request.formData();
		const row = JSON.parse(String(form.get('tostion') ?? '{}'));

		try {
			await updateTostion(Number(form.get('id')), {
				lotId: Number(row.lotId),
				roastType: String(row.roastType) as never,
				batchKilos: Number(row.batchKilos),
				roastedKilos: Number(row.roastedKilos),
				staffId: Number(row.staffId),
				notes: String(row.notes ?? '') || null
			});
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}

		return { ok: true };
	},

	/** Undoes one batch: the roasted coffee goes back to green. */
	undoTostion: async ({ request }) => {
		const form = await request.formData();
		try {
			await undoTostion(Number(form.get('id')));
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}
		return { ok: true };
	},

	/** Records one packing: bags filled from one lot's roasted coffee. */
	empaque: async ({ request }) => {
		const form = await request.formData();
		const row = JSON.parse(String(form.get('empaque') ?? '{}'));

		try {
			await recordEmpaque({
				lotId: Number(row.lotId),
				referenceId: Number(row.referenceId) || null,
				grams: Number(row.grams),
				quantity: Number(row.quantity),
				grind: String(row.grind) as never,
				bagId: Number(row.bagId) || null,
				inspection: String(row.inspection) as never,
				staffId: Number(row.staffId),
				notes: String(row.notes ?? '') || null
			});
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}

		return { ok: true };
	},

	/** Undoes one packing: the coffee comes back out of the bags. */
	undoEmpaque: async ({ request }) => {
		const form = await request.formData();
		try {
			await undoEmpaque(Number(form.get('id')));
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}
		return { ok: true };
	},

	/**
	 * Records a selección. Which stage it belongs to follows from what the lot is
	 * holding, so the form never asks.
	 */
	seleccion: async ({ request }) => {
		const form = await request.formData();
		const row = JSON.parse(String(form.get('seleccion') ?? '{}'));

		try {
			await recordSeleccion({
				lotId: Number(row.lotId),
				totalKilos: Number(row.totalKilos),
				netKilos: Number(row.netKilos),
				staffId: Number(row.staffId),
				notes: String(row.notes ?? '') || null
			});
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}

		return { ok: true };
	},

	/** Undoes a selección, and the quaker lot it separated with it. */
	undoSeleccion: async ({ request }) => {
		const form = await request.formData();
		try {
			await undoSeleccion(Number(form.get('id')));
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}
		return { ok: true };
	},

	/**
	 * Rewrites a trilla. Allowed only while nothing stands on any lot it touched
	 * — the same condition undoing has, enforced by the server.
	 */
	editTrilla: async ({ request }) => {
		const form = await request.formData();
		const row = JSON.parse(String(form.get('trilla') ?? '{}'));

		try {
			await updateTrilla(Number(form.get('id')), {
				lotId: Number(row.lotId),
				parchmentKilos: Number(row.parchmentKilos),
				greenKilos: Number(row.greenKilos),
				screens: {
					'14': Number(row.screen14) || 0,
					'15/16': Number(row.screen1516) || 0,
					'17/18': Number(row.screen1718) || 0
				},
				staffId: Number(row.staffId),
				notes: String(row.notes ?? '') || null
			});
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}

		return { ok: true };
	},

	/** Rewrites a selección, quaker lot included. */
	editSeleccion: async ({ request }) => {
		const form = await request.formData();
		const row = JSON.parse(String(form.get('seleccion') ?? '{}'));

		try {
			await updateSeleccion(Number(form.get('id')), {
				lotId: Number(row.lotId),
				totalKilos: Number(row.totalKilos),
				netKilos: Number(row.netKilos),
				staffId: Number(row.staffId),
				notes: String(row.notes ?? '') || null
			});
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}

		return { ok: true };
	},

	/** Rewrites one packing. */
	editEmpaque: async ({ request }) => {
		const form = await request.formData();
		const row = JSON.parse(String(form.get('empaque') ?? '{}'));

		try {
			await updateEmpaque(Number(form.get('id')), {
				lotId: Number(row.lotId),
				referenceId: Number(row.referenceId) || null,
				grams: Number(row.grams),
				quantity: Number(row.quantity),
				grind: String(row.grind) as never,
				bagId: Number(row.bagId) || null,
				inspection: String(row.inspection) as never,
				staffId: Number(row.staffId),
				notes: String(row.notes ?? '') || null
			});
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}

		return { ok: true };
	},

	/** Rewrites a movimiento: the old legs are reversed and the new ones posted. */
	editMovimiento: async ({ request }) => {
		const form = await request.formData();
		const legs = JSON.parse(String(form.get('legs') ?? '[]')) as {
			lotId: string;
			kilos: number | null;
		}[];

		try {
			await updateMovimiento(Number(form.get('id')), {
				action: String(form.get('action')) as never,
				destinationLotId: Number(form.get('destinationLotId')) || undefined,
				staffId: Number(form.get('staffId')),
				legs: legs.map((leg) => ({ lotId: Number(leg.lotId), kilos: Number(leg.kilos ?? 0) }))
			});
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}

		return { ok: true };
	},

	/** Corrects a reference. Ordinary CRUD on an estimate, audited field by field. */
	updateReference: async ({ request }) => {
		const form = await request.formData();
		const row = JSON.parse(String(form.get('reference') ?? '{}'));

		try {
			await updateReference(Number(form.get('id')), {
				grams: Number(row.grams),
				quantity: Number(row.quantity),
				grind: String(row.grind) as never,
				variety: String(row.variety),
				bagId: Number(row.bagId) || null
			});
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}

		return { ok: true };
	},

	/** Drops a line from the packaging plan. Soft, like every delete here. */
	deleteReference: async ({ request }) => {
		const form = await request.formData();
		await deleteReference(Number(form.get('id')));
		return { ok: true };
	},

	/** Undoes a trilla, and the lots it separated with it. */
	undoTrilla: async ({ request }) => {
		const form = await request.formData();
		try {
			await undoTrilla(Number(form.get('id')));
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}
		return { ok: true };
	},

	/**
	 * Adds a lot to an existing order. The same path order creation takes: the
	 * server assigns the letter and the code, and posts the reception entry.
	 */
	addLot: async ({ request, params }) => {
		const form = await request.formData();
		const lot = JSON.parse(String(form.get('lot') ?? '{}')) as NewLotInput;

		try {
			await addLot(await orderId(params.code), lot);
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}

		return { ok: true };
	},

	/** Adds a packaging reference to an existing order. */
	addReference: async ({ request, params }) => {
		const form = await request.formData();
		const reference = JSON.parse(String(form.get('reference') ?? '{}')) as NewReferenceInput;

		try {
			await addReference(await orderId(params.code), reference);
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}

		return { ok: true };
	},

	/**
	 * Creates a finca from inside the add-lot form, the same inline path the
	 * creation form offers.
	 */
	createFarm: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'Ingrese el nombre de la finca.' });

		const createdFarmId = await createFarm({
			name,
			farmer: String(form.get('farmer') ?? '') || null,
			municipality: String(form.get('municipality') ?? '') || null,
			department: String(form.get('department') ?? '') || null
		});

		return { createdFarmId };
	},

	/**
	 * Registers a movimiento by hand. Process steps will call the same function
	 * directly, without this action.
	 */
	movimiento: async ({ request, params }) => {
		const form = await request.formData();
		const legs = JSON.parse(String(form.get('legs') ?? '[]')) as {
			lotId: string;
			kilos: number | null;
		}[];

		const id = await orderId(params.code);

		try {
			db.transaction((tx) =>
				recordMovimiento(tx, {
					orderId: id,
					action: String(form.get('action')) as never,
					destinationLotId: Number(form.get('destinationLotId')) || undefined,
					staffId: Number(form.get('staffId')),
					// No state given: the movimiento takes whatever the lot is holding.
					// Changing the form of the coffee is a process step's job.
					legs: legs.map((leg) => ({
						lotId: Number(leg.lotId),
						kilos: Number(leg.kilos ?? 0)
					}))
				})
			);
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}

		return { ok: true };
	},


	/**
	 * Undoes a movimiento: compensating ledger entries, and the row leaves the
	 * list. Nothing is erased — see undoMovimiento.
	 */
	undoMovimiento: async ({ request }) => {
		const form = await request.formData();
		try {
			await undoMovimiento(Number(form.get('id')));
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}
		return { ok: true };
	},

	/** Soft delete — the row and its children stay in the database. */
	delete: async ({ params }) => {
		await deleteOrder(await orderId(params.code));
		redirect(303, '/ordenes');
	}
};
