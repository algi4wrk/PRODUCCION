import { error, fail, redirect } from '@sveltejs/kit';
import { deleteLot, getLot, lotIdFor, updateLot } from '$lib/server/lots';
import { db } from '$lib/server/db';
import { lots as lotsTable } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import {
	lineageByLot,
	lineageGraph,
	listMovimientos,
	recordMovimiento,
	undoMovimiento,
	updateMovimiento
} from '$lib/server/movimientos';
import {
	bagOptions,
	createStaff,
	empaqueOptions,
	farmOptions,
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
import { orderSourceMerma } from '$lib/server/ledger';
import { sourceMermaFraction } from '$lib/domain/sourceMerma';
import type { Actions } from './$types';
import { lotSections } from '$lib/domain/derived';
import type { Fact } from '$lib/components/FactGrid.svelte';
import type { Metric } from '$lib/components/MetricStrip.svelte';
import {
	currentGreenKilos,
	currentRoastedKilos,
	lotLabel,
	lotStatus,
	nextStep,
	stepTone,
	totalKilos
} from '$lib/domain/lotState';
import { formatKilos, formatPercent } from '$lib/domain/derived';
import { formatSelection } from '$lib/domain/vocabulary';
import { selectionMethodFields, selectionMethodsOf } from '$lib/fields/lot';

/**
 * Lot detail.
 *
 * Everything the page shows is projected here, the same as the board does, so
 * the component stays a layout of strings. The event sections it renders are
 * decided by this lot's own specification — `visibleSections` takes a list, and
 * a list of one is exactly the question "what does this lot need done".
 */
export async function load({ params }) {
	// The URL carries ID_LOTE; everything below works in row ids.
	const id = await lotIdFor(params.code);
	const lot = id === null ? null : await getLot(id);
	if (!lot) error(404, 'Lote no encontrado');

	const step = nextStep(lot, { hasReferences: lot.order.hasReferences, ledger: lot.ledger });
	const status = lotStatus(lot, lot.ledger);

	// Null unless this lot is one the client sent.
	const merma = (await orderSourceMerma(lot.order.id)).get(lot.id) ?? null;

	// The movimiento form and the lineage list, both scoped to this lot.
	const [movements, options, lineage, graph, trillas, greenSel, roastedSel, tostiones, empaques, farms, varieties] =
		await Promise.all([
		listMovimientos({ orderId: lot.order.id, lotId: lot.id }),
		movementOptions(lot.order.id),
		lineageByLot(),
		lineageGraph(lot.order.id),
		// This lot's own process history. Adding happens on the order page, where
		// the pickers have something to choose between.
		listTrillas({ orderId: lot.order.id, lotId: lot.id }),
		listSelecciones({ orderId: lot.order.id, lotId: lot.id }, 'VERDE'),
		listSelecciones({ orderId: lot.order.id, lotId: lot.id }, 'TOSTADO'),
		listTostiones({ orderId: lot.order.id, lotId: lot.id }),
		listEmpaques({ orderId: lot.order.id, lotId: lot.id }),
		farmOptions(),
		varietyOptions()
	]);

	/**
	 * The pickers the process forms need, so a step can be recorded from the lot
	 * it is about. They list the whole order rather than this lot alone: the form
	 * opens on this one, and being able to correct that without leaving the page
	 * costs nothing.
	 */
	const [trillaLots, greenSeleccionLots, roastedSeleccionLots, tostionLots, empaqueLots, bags, plan] =
		await Promise.all([
			trillaOptions(lot.order.id),
			seleccionOptions(lot.order.id, 'VERDE'),
			seleccionOptions(lot.order.id, 'TOSTADO'),
			tostionOptions(lot.order.id),
			empaqueOptions(lot.order.id),
			bagOptions(),
			referenceProgress(lot.order.id)
		]);

	/**
	 * Where this lot's coffee came from and where it went, by letter — a lot is
	 * only ever read inside its own order, so the letter identifies it.
	 *
	 * Read from the order's lots rather than from the movimiento picker: that
	 * list leaves out lots holding nothing, and a lot that was combined away is
	 * precisely the kind that shows up in a lineage. Taking the names from it
	 * turned D into a question mark on the page of the lot D helped make.
	 */
	const named = await db
		.select({ id: lotsTable.id, code: lotsTable.code, letter: lotsTable.letter })
		.from(lotsTable)
		.where(eq(lotsTable.orderId, lot.order.id));

	const letterOf = new Map(named.map((row) => [row.id, row.letter]));
	const codeOf = new Map(named.map((row) => [row.id, row.code]));
	const letters = (ids: number[] | undefined) =>
		[...new Set(ids ?? [])]
			.map((id) => letterOf.get(id) ?? '?')
			.join(', ');

	/** The same lots as links: lineage is only useful if you can follow it. */
	const lotLinks = (ids: number[] | undefined) =>
		[...new Set(ids ?? [])].map((id) => ({
			label: letterOf.get(id) ?? '?',
			href: `/lotes/${codeOf.get(id) ?? id}`
		}));

	/**
	 * What physically arrived, led by where it belongs — a lot is only ever read
	 * inside its order, so the order and the client come first.
	 */
	const details: Fact[] = [
		{ label: 'Orden', value: lot.order.code, mono: true },
		{ label: 'Cliente', value: lot.order.clientName },
		{ label: 'Materia prima', value: lot.rawMaterial },
		{ label: 'Peso inicial', value: `${formatKilos(lot.initialWeight)} kg` },
		{ label: 'Variedad', value: lot.variety },
		{ label: 'Finca', value: lot.farmName ?? '—' },
		{ label: 'Beneficio', value: lot.process },
		{ label: 'Humedad', value: formatPercent(lot.humidity) },
		{ label: 'ID_LOTE', value: lot.code, mono: true },
		// Lineage. Blank for a lot that arrived from the client and has not been
		// split or combined, which is most of them.
		{
			label: 'Lotes origen',
			value: letters(lineage.get(lot.id)?.origins) || '—',
			links: lotLinks(lineage.get(lot.id)?.origins)
		},
		{
			label: 'Lotes creados',
			value: letters(lineage.get(lot.id)?.created) || '—',
			links: lotLinks(lineage.get(lot.id)?.created)
		}
	];

	/** What the client asked to have done — the spec, not observed state. */
	const spec: Fact[] = [
		/*
		 * One line, not two: the stages with their methods on them. A separate
		 * Método row would name the same stages again with less in it, and a lot
		 * with no method specified still reads exactly as it did before.
		 */
		{ label: 'Selección', value: formatSelection(lot.selectionStages, lot.selectionMethods) },
		{ label: 'Tostión', value: lot.roastType },
		{ label: 'Mallas a separar', value: lot.screens?.join(', ') || '—' },
		{ label: 'Agregar quaker', value: lot.addQuaker === null ? '—' : lot.addQuaker ? 'Sí' : 'No' },
		// GUARDAR EN BODEGA is hidden for now — see the field definition. Shown
		// only where a lot actually carries it, so an existing one still explains
		// why no process step will take it.
		...(lot.storeInWarehouse ? [{ label: 'Guardar en bodega', value: 'Sí' }] : [])
	];

	/**
	 * Balances — real weights only.
	 *
	 * No estimates here. A yield estimate is for deciding a packaging plan, which
	 * happens when the lot is entered and when referencias are budgeted against
	 * it; on a lot's own page it would sit beside measured weights and invite
	 * being read as one.
	 *
	 * Every figure is a projection over the lot's events, and there are none yet,
	 * so each falls through to its base case.
	 */
	const balances: Metric[] = [
		{ label: 'Verde', value: `${formatKilos(currentGreenKilos(lot, lot.ledger))} kg` },
		{ label: 'Tostado', value: `${formatKilos(currentRoastedKilos(lot, lot.ledger))} kg` },
		{ label: 'Empacado', value: `${formatKilos(lot.ledger.balances.empacado)} kg` },
		{ label: 'Total', value: `${formatKilos(totalKilos(lot, lot.ledger))} kg` },
		// Merma belongs to the lot the client sent. A lot born on the floor received
		// nothing, so its losses are already counted against whichever original lot
		// the coffee came from — see `sourceMerma`.
		...(merma
			? [
					{ label: 'Merma', value: `${formatKilos(merma.lostKilos)} kg` },
					{ label: '% merma', value: formatPercent(sourceMermaFraction(merma)) }
				]
			: [])
	];

	return {
		movements,
		trillas,
		greenSelecciones: greenSel,
		roastedSelecciones: roastedSel,
		tostiones,
		empaques,
		trillaLots: trillaLots.lots,
		greenSeleccionLots,
		roastedSeleccionLots,
		tostionLots,
		empaqueLots,
		bags,
		referenceProgress: plan,
		farms,
		varieties,
		// The lot's own fields, in the shape the edit form works in.
		lotDraft: {
			variety: lot.variety,
			farmId: lot.farmId === null ? '' : String(lot.farmId),
			process: lot.process,
			humidity: lot.humidity,
			selectionStages: lot.selectionStages,
			...selectionMethodFields(lot.selectionMethods),
			roastType: lot.roastType,
			screens: lot.screens ?? [],
			addQuaker: lot.addQuaker ?? false,
			storeInWarehouse: lot.storeInWarehouse
		},
		// The order's whole lineage: a lot's own neighbourhood cannot show a
		// diamond, and diamonds are what splitting then recombining makes.
		graph,
		lotOptions: options.lots,
		staffOptions: options.staff,
		lot: {
			id: lot.id,
			label: lotLabel({ ...lot, status }),
			status,
			step,
			stepTone: stepTone(step),
			order: lot.order
		},
		details,
		spec,
		balances,
		// What this lot still needs, plus what it has already done — see lotSections.
		sections: lotSections(lot, lot.ledger)
	};
}

/** The lot an action is acting on, from its URL. */
async function lotId(code: string): Promise<number> {
	const id = await lotIdFor(code);
	if (id === null) throw error(404, 'Lote no encontrado');
	return id;
}

export const actions: Actions = {
	/**
	 * The same movimiento the order page registers, opened from the lot instead.
	 * One writer, two entry points — see `recordMovimiento`.
	 */
	movimiento: async ({ request }) => {
		const form = await request.formData();
		const legs = JSON.parse(String(form.get('legs') ?? '[]')) as {
			lotId: string;
			kilos: number | null;
			state?: 'VERDE' | 'TOSTADO' | 'EMPACADO';
			selected?: boolean;
		}[];

		try {
			db.transaction((tx) =>
				recordMovimiento(tx, {
					orderId: Number(form.get('orderId')),
					action: String(form.get('action')) as never,
					destinationLotId: Number(form.get('destinationLotId')) || undefined,
					staffId: Number(form.get('staffId')),
					legs: legs.map((leg) => ({
						lotId: Number(leg.lotId),
						kilos: Number(leg.kilos ?? 0),
						state: leg.state,
						selected: leg.selected
					}))
				})
			);
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}

		return { ok: true };
	},


	/**
	 * The process events are listed here as well as on the order page, so their
	 * Deshacer needs somewhere to post. One writer, two entry points — the same
	 * arrangement movimientos already have.
	 */
	undoTrilla: async ({ request }) => {
		const form = await request.formData();
		try {
			await undoTrilla(Number(form.get('id')));
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}
		return { ok: true };
	},

	undoSeleccion: async ({ request }) => {
		const form = await request.formData();
		try {
			await undoSeleccion(Number(form.get('id')));
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}
		return { ok: true };
	},

	undoTostion: async ({ request }) => {
		const form = await request.formData();
		try {
			await undoTostion(Number(form.get('id')));
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}
		return { ok: true };
	},

	undoEmpaque: async ({ request }) => {
		const form = await request.formData();
		try {
			await undoEmpaque(Number(form.get('id')));
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}
		return { ok: true };
	},

	/** Rewrites a movimiento, from the lot page's own list. */
	editMovimiento: async ({ request }) => {
		const form = await request.formData();
		const legs = JSON.parse(String(form.get('legs') ?? '[]')) as {
			lotId: string;
			kilos: number | null;
			state?: 'VERDE' | 'TOSTADO' | 'EMPACADO';
			selected?: boolean;
		}[];

		try {
			await updateMovimiento(Number(form.get('id')), {
				action: String(form.get('action')) as never,
				destinationLotId: Number(form.get('destinationLotId')) || undefined,
				staffId: Number(form.get('staffId')),
				legs: legs.map((leg) => ({
					lotId: Number(leg.lotId),
					kilos: Number(leg.kilos ?? 0),
					state: leg.state,
					selected: leg.selected
				}))
			});
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}

		return { ok: true };
	},

	/*
	 * The four steps, recorded from the lot they are about. Same writers as the
	 * order page calls — one implementation, two entry points, the way movimientos
	 * already worked.
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

	seleccion: async ({ request }) => {
		const form = await request.formData();
		const row = JSON.parse(String(form.get('seleccion') ?? '{}'));

		try {
			await recordSeleccion({
				lotId: Number(row.lotId),
				totalKilos: Number(row.totalKilos),
				netKilos: Number(row.netKilos),
				removedKilos:
					row.removedKilos === undefined || row.removedKilos === null || row.removedKilos === ''
						? undefined
						: Number(row.removedKilos),
				keepQuaker: row.keepQuaker === true,
				method: String(row.method ?? '') || null,
				staffId: Number(row.staffId),
				notes: String(row.notes ?? '') || null
			});
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}

		return { ok: true };
	},

	editSeleccion: async ({ request }) => {
		const form = await request.formData();
		const row = JSON.parse(String(form.get('seleccion') ?? '{}'));

		try {
			await updateSeleccion(Number(form.get('id')), {
				lotId: Number(row.lotId),
				totalKilos: Number(row.totalKilos),
				netKilos: Number(row.netKilos),
				removedKilos:
					row.removedKilos === undefined || row.removedKilos === null || row.removedKilos === ''
						? undefined
						: Number(row.removedKilos),
				keepQuaker: row.keepQuaker === true,
				method: String(row.method ?? '') || null,
				staffId: Number(row.staffId),
				notes: String(row.notes ?? '') || null
			});
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}

		return { ok: true };
	},

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

	/** Corrects the lot's description. Weight is never editable. */
	updateLot: async ({ params, request }) => {
		const form = await request.formData();
		const row = JSON.parse(String(form.get('lot') ?? '{}'));

		try {
			await updateLot(await lotId(params.code), {
				variety: String(row.variety),
				farmId: Number(row.farmId) || null,
				process: String(row.process),
				humidity: Number(row.humidity),
				selectionStages: row.selectionStages ?? [],
				selectionMethods: selectionMethodsOf(row),
				roastType: String(row.roastType),
				screens: row.screens ?? null,
				addQuaker: row.addQuaker ?? null,
				storeInWarehouse: row.storeInWarehouse === true
			});
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}

		return { ok: true };
	},

	/** Soft-deletes the lot, and refuses once anything has happened to it. */
	deleteLot: async ({ params }) => {
		const lot = await getLot(await lotId(params.code));
		if (!lot) return fail(404, { error: 'El lote no existe.' });

		try {
			await deleteLot(await lotId(params.code));
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}

		redirect(303, `/ordenes/${lot.order.code}`);
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
	}
};
