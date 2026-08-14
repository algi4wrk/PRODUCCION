/**
 * A worked order, for clicking around in.
 *
 * Adds one order to whatever is already in the database — it does not reset
 * anything — and then walks it through the floor: hulling, sorting on both
 * sides of the roast, several roasting batches, a combo, and packing against
 * the client's plan.
 *
 * The point is coverage of *states*, not of volume. When it finishes, the order
 * holds a lot in almost every state the board can show: pergamino untouched,
 * almendra sorted, a lot half roasted, one half packed, a malla lot, a quaker
 * lot, and a lot consumed by a combo. Every section of the order page has rows
 * in it, and some of those rows can be edited while others are blocked by what
 * came after them.
 *
 *   npm run db:sample
 *
 * Run it as often as you like; each run adds another order.
 *
 * It lives alongside the seed rather than inside it: `npm run db:seed` is the
 * six real orders exactly as exported, and mixing invented events into that
 * would make it impossible to tell ported data from made-up data. The flip side
 * is that re-seeding wipes this — and `verify.ts` re-seeds when it finishes, so
 * run the sample *after* the checks, not before.
 */

import { db } from '../src/lib/server/db/index.ts';
import {
	bags,
	clients,
	lots as lotsTable,
	orders,
	references,
	staff
} from '../src/lib/server/db/schema.ts';
import { createOrder } from '../src/lib/server/orders.ts';
import { recordTrilla } from '../src/lib/server/trilla.ts';
import { recordSeleccion } from '../src/lib/server/seleccion.ts';
import { recordTostion } from '../src/lib/server/tostion.ts';
import { recordEmpaque } from '../src/lib/server/empaque.ts';
import { recordMovimiento } from '../src/lib/server/movimientos.ts';
import { lotLedger } from '../src/lib/server/ledger.ts';
import { lotStatus } from '../src/lib/domain/lotState.ts';
import { and, eq, isNull } from 'drizzle-orm';

const [client] = await db.select().from(clients).limit(1);
const [person] = await db.select().from(staff).limit(1);
const bagRows = await db.select().from(bags);
if (!client || !person) {
	console.error('Siembre primero la base: npm run db:seed');
	process.exit(1);
}

/** A bag of a given size, so the references look like the real ones. */
const bagOf = (grams: number) => bagRows.find((bag) => bag.sizeGrams === grams)?.id ?? null;

/** Days back from today, so the history reads in order rather than all at once. */
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const orderId = await createOrder({
	type: 'Maquila',
	clientId: client.id,
	peelStick: false,
	notes: 'Orden de prueba: recorre todos los pasos del proceso.',
	lots: [
		// A — pergamino, todo el camino: trilla, selección verde, tostión,
		// selección tostada y empaque.
		{
			rawMaterial: 'CPS',
			initialWeight: 46,
			variety: 'Castillo',
			process: 'Lavado',
			humidity: 0.11,
			farmId: null,
			selectionStages: ['VERDE', 'TOSTADO'],
			roastType: 'Media/Media - City',
			screens: ['14'],
			addQuaker: true,
			storeInWarehouse: false
		},
		// B — almendra, más grande que el tostador: se tuesta en dos baches y en
		// medio queda EN PROCESO TOSTION.
		{
			rawMaterial: 'AV',
			initialWeight: 30,
			variety: 'Caturra',
			process: 'Honey',
			humidity: 0.105,
			farmId: null,
			selectionStages: ['TOSTADO'],
			roastType: 'Media Alta - Full City',
			screens: null,
			addQuaker: false,
			storeInWarehouse: false
		},
		// C — almendra que se queda quieta, para que el tablero muestre un lote
		// esperando su turno.
		{
			rawMaterial: 'AV',
			initialWeight: 12,
			variety: 'Tabi',
			process: 'Natural',
			humidity: 0.1,
			farmId: null,
			selectionStages: ['NINGUNO'],
			roastType: 'Media Baja - American',
			screens: null,
			addQuaker: false,
			storeInWarehouse: false
		}
	],
	references: [
		{ grams: 500, quantity: 30, grind: 'GRANO', variety: 'Castillo', bagId: bagOf(500) },
		{ grams: 250, quantity: 20, grind: 'MOLIDO', variety: 'Castillo', bagId: bagOf(250) },
		{ grams: 1000, quantity: 10, grind: 'GRANO', variety: 'Caturra', bagId: bagOf(1000) }
	]
});

const [order] = await db.select().from(orders).where(eq(orders.id, orderId));

/** This order's live lots, by letter. */
async function lotsByLetter() {
	const rows = await db
		.select()
		.from(lotsTable)
		.where(and(eq(lotsTable.orderId, orderId), isNull(lotsTable.deletedAt)));
	return new Map(rows.map((lot) => [lot.letter, lot]));
}

let byLetter = await lotsByLetter();
const A = byLetter.get('A')!;
const B = byLetter.get('B')!;
const C = byLetter.get('C')!;

// ── A: trilla ──────────────────────────────────────────────────────────────
// 46 kg de pergamino → 35 de almendra, 3 de malla 14 (que se va a su propio
// lote, D) y 8 kg de cisco, que es merma.
await recordTrilla({
	lotId: A.id,
	parchmentKilos: 46,
	greenKilos: 35,
	screens: { '14': 3 },
	staffId: person.id,
	notes: 'Trilla completa del lote.',
	date: daysAgo(6)
});

// ── A: selección verde ─────────────────────────────────────────────────────
// Entra todo lo que quedó de almendra; sale un poco menos, y la diferencia son
// defectos: merma.
await recordSeleccion({
	lotId: A.id,
	totalKilos: 35,
	netKilos: 33.5,
	staffId: person.id,
	date: daysAgo(5)
});

// ── A: tostión, en dos baches ──────────────────────────────────────────────
// El tostador recibe 25 kg, así que 33,5 no caben de una vez. Entre un bache y
// otro el lote sostiene verde y tostado a la vez.
await recordTostion({
	lotId: A.id,
	roastType: 'Media/Media - City',
	batchKilos: 25,
	roastedKilos: 20.5,
	staffId: person.id,
	date: daysAgo(4)
});
await recordTostion({
	lotId: A.id,
	roastType: 'Media/Media - City',
	batchKilos: 8.5,
	roastedKilos: 7,
	staffId: person.id,
	notes: 'Segundo bache, el resto del lote.',
	date: daysAgo(4)
});

// ── A: selección tostada, con quakers ──────────────────────────────────────
// El lote pide AGREGAR QUAKER, así que lo retirado no es merma: se separa a un
// lote propio (E) que puede recombinarse después.
await recordSeleccion({
	lotId: A.id,
	totalKilos: 27.5,
	netKilos: 26,
	staffId: person.id,
	notes: 'Quakers separados a su propio lote.',
	date: daysAgo(3)
});

// ── B: tostión a medias ────────────────────────────────────────────────────
// Un solo bache de los dos que necesita: el lote queda EN PROCESO TOSTION, con
// 5 kg todavía verdes.
await recordTostion({
	lotId: B.id,
	roastType: 'Media Alta - Full City',
	batchKilos: 25,
	roastedKilos: 20,
	staffId: person.id,
	notes: 'Falta el último bache.',
	date: daysAgo(2)
});

// ── Movimiento manual: la malla se combina con C ───────────────────────────
// Los dos son almendra sin seleccionar, así que se pueden combinar. Nace F, y
// D queda consumido.
byLetter = await lotsByLetter();
const D = byLetter.get('D');
if (D) {
	db.transaction((tx) =>
		recordMovimiento(tx, {
			orderId,
			action: 'COMBINAR LOTE',
			staffId: person.id,
			date: daysAgo(2),
			legs: [
				{ lotId: C.id, kilos: 4 },
				{ lotId: D.id, kilos: 3 }
			]
		})
	);
}

// ── A: empaque, a medias ───────────────────────────────────────────────────
// Contra las líneas del plan, para que el panel del formulario muestre lo
// empacado y lo pendiente. No alcanzan a cubrir todo lo que el lote tiene
// tostado, así que queda EN PROCESO EMPAQUE.
const plan = await db.select().from(references).where(eq(references.orderId, orderId));
const lineOf = (grams: number, grind: string) =>
	plan.find((line) => line.grams === grams && line.grind === grind)?.id ?? null;

await recordEmpaque({
	lotId: A.id,
	referenceId: lineOf(500, 'GRANO'),
	grams: 500,
	quantity: 30,
	grind: 'GRANO',
	bagId: bagOf(500),
	inspection: 'Aceptado',
	staffId: person.id,
	date: daysAgo(1)
});
// Media línea nada más: el plan pide 20 y se empacan 12.
await recordEmpaque({
	lotId: A.id,
	referenceId: lineOf(250, 'MOLIDO'),
	grams: 250,
	quantity: 12,
	grind: 'MOLIDO',
	bagId: bagOf(250),
	inspection: 'Rechazado',
	staffId: person.id,
	notes: 'Sellado irregular; se revisa antes de despachar.',
	date: daysAgo(1)
});

// ── Lo que quedó ───────────────────────────────────────────────────────────
const final = await db
	.select()
	.from(lotsTable)
	.where(and(eq(lotsTable.orderId, orderId), isNull(lotsTable.deletedAt)));

console.log(`\nOrden ${order.code}  ·  /ordenes/${orderId}\n`);
for (const lot of final.sort((a, b) => a.letter.localeCompare(b.letter))) {
	const ledger = await lotLedger(lot.id);
	const status = lotStatus(lot, ledger);
	const held = Object.entries(ledger.balances)
		.filter(([, kilos]) => Math.abs(kilos) > 0.0005)
		.map(([bucket, kilos]) => `${bucket} ${kilos.toFixed(2)}`)
		.join(' · ');
	console.log(
		`  ${lot.letter} - ${lot.variety}${lot.kind ? ` ${lot.kind}` : ''}`.padEnd(30) +
			status.padEnd(24) +
			(held || '—')
	);
}
console.log('');
