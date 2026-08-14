/**
 * Seeds the database from the real AppSheet export so the app shows genuine
 * data on first run rather than invented rows.
 *
 * Order codes are regenerated with the same generator the app uses, so the seed
 * carries the zero-padded form (TIE-M0727A, not the original TIE-M727A). This
 * is test data, so consistency beats fidelity to codes that were produced by a
 * formula with a known collision bug. Lot codes follow, since they are built
 * from the order code.
 *
 * Lot codes are regenerated from their order code and letter rather than copied
 * from the export, which cleans the two corrupted ones the source data carries
 * (`-M728A-LT-A` lost its prefix, `TIE-M727-LT-A` lost the order's sequence
 * letter). This is test data, so there are no physical labels to preserve.
 */

import { db } from './index.ts';
import {
	audit,
	bags,
	clients,
	empaque,
	farms,
	ledger,
	lots,
	movements,
	orders,
	references,
	seleccion,
	staff,
	tostion,
	trilla
} from './schema.ts';
import { postReception } from '../ledger.ts';
import { clientPrefix, lotCode, orderCode } from '../../domain/codes.ts';
import type { RawMaterial, RoastType, ProcessType, SelectionStage, Screen } from '../../domain/vocabulary.ts';

/** Parses the export's date strings ("7/27/2026 16:48:00") into Date objects. */
function parseDate(value: string): Date {
	const [datePart, timePart = '00:00:00'] = value.split(' ');
	const [month, day, year] = datePart.split('/').map(Number);
	const [hour, minute, second] = timePart.split(':').map(Number);
	return new Date(year, month - 1, day, hour, minute, second);
}

const CLIENTS = [
	{ code: '04db5207', name: 'JUAN MANUELA PEREZ', brand: 'CAFÉ TIERRA MORENA', owner: 'JUAN MANUEL PEREZ', country: 'COLOMBIA' },
	{ code: '5f34b3dd', name: 'Jhon Hurtado', brand: 'Mahusa', owner: null, country: null },
	{ code: '2c2381e8', name: 'Carlos Eduardo Cardona', brand: 'Taiga', owner: null, country: null },
	{ code: 'f5e5d619', name: 'Juan Manuel Pérez', brand: 'Tierra Morena', owner: null, country: null },
	{ code: 'e1763a47', name: 'Alfredo Guitierrez', brand: 'Don Alefredo', owner: 'Don alfredo', country: 'Colombia' },
	{ code: 'f20110de', name: 'Gonzalo Garcia', brand: null, owner: null, country: null },
	{ code: '234f79cd', name: 'Jhon Narvaes', brand: null, owner: null, country: null },
	// Internal orders bill to the roastery itself, kept as a real row so the
	// client field can stay visible and preselected rather than special-cased.
	{ code: 'interno', name: 'Interno', brand: 'Green Nature', owner: null, country: 'Colombia' }
];

const FARMS = [
	{ name: 'GIOCONDA', municipality: 'ARMENIA', department: 'QUINDIO', farmer: 'DAVID CORREAL GENTRY' },
	{ name: 'VEREDA PINARES', municipality: 'ARMENIA', department: 'QUINDÍO', farmer: 'MANUEL PEREZ' },
	{ name: 'La amapola', municipality: 'Génova', department: 'Quindío', farmer: 'Octavio Cardona' },
	{ name: 'Los angeles', municipality: 'Armenia', department: 'Quindio', farmer: 'Juan Manuel perez' },
	{ name: 'Los Sauces', municipality: 'Caicedonia', department: 'Valle del Cauca', farmer: 'Jhon Hurtado' },
	{ name: 'Tierra Linda', municipality: 'Salento', department: 'Quindío', farmer: 'Alfredo Gutiérrez' },
	{ name: 'El Regalo', municipality: 'Calarcá', department: 'Quindío', farmer: 'Gonzalo Garcia' },
	{ name: 'La Provivencia', municipality: 'Sevilla Valle', department: 'Valle', farmer: 'Jhon Narváez' }
];

const BAGS = [
	{ code: 'BE01', description: 'BOLSA KRAFT EXPORTACION 340 GR', sizeGrams: 340 },
	{ code: 'BE02', description: 'BOLSA KRAFT EXPORTACION 2500 GR', sizeGrams: 2500 },
	{ code: 'BO01', description: 'BOLSA COLORES 2500 GR BRILLANTE CON VALVULA Y ZIPPER', sizeGrams: 2500 },
	{ code: 'BO02', description: 'BOLSA KRAFT 2500 GR CON VALVULA', sizeGrams: 2500 },
	{ code: 'BO03', description: 'BOLSA 500 GR COLORES SENCILLA', sizeGrams: 500 },
	{ code: 'BO04', description: 'BOLSA 500 GR COLORES CON VALVULA 4 PRO', sizeGrams: 500 },
	{ code: 'BO04 - 340', description: 'BOLSA 500 GR COLORES CON VALVULA 4 PRO', sizeGrams: 340 },
	{ code: 'BO04 - 454', description: 'BOLSA 500 GR COLORES CON VALVULA 4 PRO', sizeGrams: 454 },
	{ code: 'BO05', description: 'BOLSA 250 GR CON VALVULA SENCILLA', sizeGrams: 250 },
	{ code: 'BO06', description: 'BOLSA 500 GR CON VALVULA SENCILLA', sizeGrams: 500 },
	{ code: 'BO07', description: 'BOLSA 2500 GR MATE CON VALVULA 4 PRO', sizeGrams: 2500 },
	{ code: 'BO08', description: 'BOLSA 2500 GR VALVULA MATE 4 PRO', sizeGrams: 2500 },
	{ code: 'BO09', description: 'BOLSA ZIPPER PARA MUESTRAS', sizeGrams: null },
	{ code: 'BO10', description: 'BOLSA 250 GR COLORES SENCILLA', sizeGrams: 250 },
	{ code: 'BO11', description: 'BOLSA 250 GR COLORES CON VALVULA 4 PRO', sizeGrams: 250 },
	{ code: 'BO12', description: 'BOLSA 250 GR IMPRESA GRANO', sizeGrams: 250 },
	{ code: 'BO13', description: 'BOLSA 500 GR IMPRESA GRANO', sizeGrams: 500 },
	{ code: 'BO14', description: 'BOLSA 500 GR NEGRA SIN VALVULA 4 PRO', sizeGrams: 500 },
	{ code: 'BO18', description: 'BOLSA 125 GR COLORES CON VALVULA', sizeGrams: 125 },
	{ code: 'BO19', description: 'BOLSA 125 GR COLORES SENCILLA', sizeGrams: 125 },
	{ code: 'BO20', description: 'BOLSA DORADA 10x10 POKETS', sizeGrams: null },
	{ code: 'BO21', description: 'BOLSA KRAFT 12x12', sizeGrams: null },
	{ code: 'BO22', description: 'BOLSA 2500 ZIPPER SIN VALVULA', sizeGrams: 2500 },
	{ code: 'BO23', description: 'BOLSA 1000 GR COLORES CON VALVULA 4 PRO', sizeGrams: 1000 },
	{ code: 'BO24', description: 'BOLSA ECO KRAFT 500 GR SIN VALVULA CON ZIPPER', sizeGrams: 500 },
	{ code: 'BO25', description: 'BOLSA KRAFT 250 GR SIN VALVULA CON ZIPPER', sizeGrams: 250 },
	{ code: 'BO26', description: 'BOLSA KRAFT 125 GR CON ZIPPER', sizeGrams: 125 },
	{ code: 'BO27', description: 'BOLSA KRAFT 500 GR SIN VALVULA 4 PRO', sizeGrams: 500 },
	{ code: 'BO28', description: 'BOLSA CRUDO 500 GR SIN VALVULA CON ZIPPER', sizeGrams: 500 },
	{ code: 'BO29', description: 'BOLSA CRUDO 125 GR SIN VALVULA CON ZIPPER', sizeGrams: 125 },
	{ code: 'BO30', description: 'BOLSA 2500 GR 4 PRO BLANCA EXPOR', sizeGrams: 2500 },
	{ code: 'BO31', description: 'BOLSA 2500 GR CON FUELLE BLANCA MATE EXPOR', sizeGrams: 2500 },
	{ code: 'BO32', description: 'BOLSA 12 KG AL VACIO', sizeGrams: 12000 },
	{ code: 'BO33', description: 'BOLSA 12gr MEC COFFEE', sizeGrams: 12 },
	{ code: 'BOGRA35', description: 'BOLSA GRAIN PRO 35 KG', sizeGrams: 35000 },
	{ code: 'BOGRA70', description: 'BOLSA GRAIN PRO 70 KG', sizeGrams: 70000 },
	{ code: 'Cliente', description: 'BOLSA CLIENTE', sizeGrams: null },
	{ code: 'IMBO', description: 'BOLSA PLASTICA - GRANEL', sizeGrams: 1 }
];

const STAFF = [
	{ name: 'JUAN CAMILO OROZCO', position: 'GERENTE' },
	{ name: 'DANIEL FELIPE ARIAS', position: 'OPERARIO' },
	{ name: 'Jhon', position: 'operario' },
	{ name: 'Diego Fernando Vergara', position: null },
	{ name: 'Jhon Fernando Aguirre', position: 'Operario de Producción' }
];

const ORDERS = [
	{ code: 'TIE-M727A', date: '7/27/2026 16:48:00', type: 'Maquila', clientCode: 'f5e5d619', brand: 'Tierra Morena', peelStick: false, notes: 'empaque propio', status: 'EN PROCESO' },
	{ code: 'MAH-M728A', date: '7/28/2026 15:19:00', type: 'Maquila', clientCode: '5f34b3dd', brand: 'MAHUSA', peelStick: false, notes: 'ORDEN DE EJEMPLO', status: 'PAUSADA' },
	{ code: 'DON-M728A', date: '7/28/2026 15:53:00', type: 'Maquila', clientCode: 'e1763a47', brand: 'Don Alefredo', peelStick: false, notes: '1 BOLSA PLASTICA - 80 GRAMOS AL GRANEL- UNA CAJA POR COBRAR-PEEL STICK UND 340GR', status: 'TERMINADA' },
	{ code: 'GON-M728A', date: '7/28/2026 16:11:00', type: 'Maquila', clientCode: 'f20110de', brand: null, peelStick: true, notes: 'SE DEBE COBRAR PEEL STICK- 2 bolsas plásticas- 6.5 kg selección electrónica tostado', status: 'TERMINADA' },
	{ code: 'JHO-M729A', date: '7/29/2026 8:29:00', type: 'Maquila', clientCode: '234f79cd', brand: null, peelStick: false, notes: 'SE LE VENDEN 2 GRAINPRO DE 35 KG', status: 'EN PROCESO' },
	{ code: 'MAH-M729A', date: '7/29/2026 14:39:00', type: 'Maquila', clientCode: '5f34b3dd', brand: 'MAHUSA', peelStick: false, notes: null, status: 'EN PROCESO' }
];

/**
 * Lots as exported. `code` is preserved verbatim, including the two corrupted
 * forms, so migrated data matches what is physically labelled.
 */
const LOTS = [
	{ orderCode: 'TIE-M727A', letter: 'A', rawMaterial: 'CPS', initialWeight: 46, variety: 'Castillo', selectionStages: ['VERDE', 'TOSTADO'], roastType: 'Media/Media - City', process: 'Honey', humidity: 0.104, screens: ['14'], addQuaker: false, storeInWarehouse: false, farm: 'Los angeles', status: 'CPS' },
	{ orderCode: 'TIE-M727A', letter: 'B', rawMaterial: 'AV', initialWeight: 1.1, variety: 'Castillo', selectionStages: ['VERDE', 'TOSTADO'], roastType: 'Media/Media - City', process: 'Honey', humidity: 0.104, screens: ['14'], addQuaker: false, storeInWarehouse: false, farm: 'Los angeles', status: 'AV' },
	{ orderCode: 'TIE-M727A', letter: 'C', rawMaterial: 'AV', initialWeight: 26.4, variety: 'Castillo', selectionStages: ['VERDE', 'TOSTADO'], roastType: 'Media/Media - City', process: 'Honey', humidity: 0.104, screens: ['Ninguna'], addQuaker: false, storeInWarehouse: false, farm: 'Los angeles', status: 'AV' },
	{ orderCode: 'MAH-M728A', letter: 'A', rawMaterial: 'CPS', initialWeight: 351, variety: 'Castillo', selectionStages: ['VERDE', 'TOSTADO'], roastType: 'Media/Media - City', process: 'Lavado', humidity: 0.12, screens: ['14'], addQuaker: false, storeInWarehouse: false, farm: 'Los Sauces', status: 'CPS' },
	{ orderCode: 'MAH-M728A', letter: 'B', rawMaterial: 'AV', initialWeight: 20, variety: 'Castillo', selectionStages: ['VERDE', 'TOSTADO'], roastType: 'Media/Media - City', process: 'Lavado', humidity: 0.12, screens: ['14'], addQuaker: true, storeInWarehouse: false, farm: 'Los Sauces', status: 'AV' },
	{ orderCode: 'DON-M728A', letter: 'A', rawMaterial: 'CPS', initialWeight: 12.4, variety: 'Tabi', selectionStages: ['NINGUNO'], roastType: 'Media/Media - City', process: 'Lavado', humidity: 0.13, screens: ['Ninguna'], addQuaker: false, storeInWarehouse: false, farm: 'Tierra Linda', status: 'CPS' },
	{ orderCode: 'GON-M728A', letter: 'A', rawMaterial: 'CPS', initialWeight: 12.2, variety: 'Castillo', selectionStages: ['TOSTADO'], roastType: 'Media/Media - City', process: 'Lavado', humidity: 0.108, screens: ['Ninguna'], addQuaker: false, storeInWarehouse: false, farm: 'El Regalo', status: 'CPS' },
	{ orderCode: 'GON-M728A', letter: 'B', rawMaterial: 'AV', initialWeight: 2.35, variety: 'Castillo', selectionStages: ['NINGUNO'], roastType: 'Media/Media - City', process: 'Lavado', humidity: 0.108, screens: ['Ninguna'], addQuaker: true, storeInWarehouse: false, farm: 'El Regalo', status: 'AV' },
	{ orderCode: 'JHO-M729A', letter: 'A', rawMaterial: 'CPS', initialWeight: 64.2, variety: 'Castillo', selectionStages: ['NINGUNO'], roastType: 'Media Alta - Full City', process: 'Lavado', humidity: 0.086, screens: ['Ninguna'], addQuaker: false, storeInWarehouse: false, farm: 'La Provivencia', status: 'CPS' },
	{ orderCode: 'MAH-M729A', letter: 'A', rawMaterial: 'AV', initialWeight: 12, variety: 'Caturra Amarillo', selectionStages: ['TOSTADO'], roastType: 'Media Baja - American', process: 'Natural', humidity: 0.12, screens: ['Ninguna'], addQuaker: true, storeInWarehouse: false, farm: 'Los Sauces', status: 'AV' },
	{ orderCode: 'MAH-M729A', letter: 'B', rawMaterial: 'AV', initialWeight: 12, variety: 'Bourbon Rosado', selectionStages: ['TOSTADO'], roastType: 'Media Baja - American', process: 'Natural', humidity: 0.12, screens: ['Ninguna'], addQuaker: true, storeInWarehouse: false, farm: 'Los Sauces', status: 'AV' }
];

/**
 * References for the six live orders only.
 *
 * The export also contains rows for ARI-M422, COF-M423, FIN-M422, LA -M426,
 * TAI-M727 and MAH-M727 — orders that do not exist in ORDENES. They are orphans
 * caused by `REFERENCIAS.ID_ORDEN` defaulting to `UNIQUEID()`, a foreign key
 * whose default was a random value. They are skipped and reported.
 */
const REFERENCES = [
	{ code: '94d6d1c0', orderCode: 'MAH-M728A', grams: 2500, quantity: 47, grind: 'GRANO', variety: 'Castillo', bag: 'Cliente' },
	{ code: 'b0fdc9c9', orderCode: 'MAH-M728A', grams: 2500, quantity: 37, grind: 'MOLIDO', variety: 'Castillo', bag: 'Cliente' },
	{ code: 'dd244142', orderCode: 'MAH-M728A', grams: 340, quantity: 20, grind: 'GRANO', variety: 'Castillo', bag: 'Cliente' },
	{ code: '8f950283', orderCode: 'MAH-M728A', grams: 1, quantity: 7840, grind: 'GRANO', variety: 'Castillo', bag: 'IMBO' },
	{ code: '5b38fc24', orderCode: 'DON-M728A', grams: 125, quantity: 50, grind: 'MOLIDO', variety: 'Tabi', bag: 'BO19' },
	{ code: 'b129393b', orderCode: 'DON-M728A', grams: 340, quantity: 3, grind: 'GRANO', variety: 'Tabi', bag: 'BO04 - 340' },
	{ code: 'ce925886', orderCode: 'GON-M728A', grams: 500, quantity: 10, grind: 'GRANO', variety: 'Castillo', bag: 'BO04' },
	{ code: '556b9346', orderCode: 'GON-M728A', grams: 500, quantity: 5, grind: 'MOLIDO', variety: 'Castillo', bag: 'BO04' },
	{ code: '27faeb97', orderCode: 'JHO-M729A', grams: 1, quantity: 41090, grind: 'MOLIDO', variety: 'Castillo', bag: 'Cliente' },
	{ code: 'b41c3c4d', orderCode: 'TIE-M727A', grams: 1, quantity: 50520, grind: 'GRANO', variety: 'Castillo', bag: 'Cliente' }
];

const SKIPPED_REFERENCE_ORDERS = ['ARI-M422', 'COF-M423', 'FIN-M422', 'LA -M426', 'TAI-M727', 'MAH-M727'];

export function seed() {
	// Clear in dependency order so re-seeding is idempotent.
	db.delete(audit).run();
	// Everything that points at a lot goes first: process events, then the
	// ledger and the lineage. Miss one and the delete below fails on a foreign
	// key, leaving the database half-emptied.
	db.delete(trilla).run();
	db.delete(seleccion).run();
	db.delete(tostion).run();
	// Empaque points at a reference as well as a lot, so it goes before both.
	db.delete(empaque).run();
	db.delete(ledger).run();
	db.delete(movements).run();
	db.delete(references).run();
	db.delete(lots).run();
	db.delete(orders).run();
	db.delete(staff).run();
	db.delete(bags).run();
	db.delete(farms).run();
	db.delete(clients).run();

	// Reset the autoincrement counters so ids are identical on every re-seed and
	// bookmarked URLs keep working. SQLite-specific; the Postgres equivalent is
	// ALTER SEQUENCE ... RESTART.
	db.$client.exec('DELETE FROM sqlite_sequence');

	const clientIds = new Map<string, number>();
	for (const client of CLIENTS) {
		const [row] = db
			.insert(clients)
			.values({ ...client, prefix: clientPrefix(client.name, client.brand) })
			.returning({ id: clients.id })
			.all();
		clientIds.set(client.code, row.id);
	}

	const farmIds = new Map<string, number>();
	for (const farm of FARMS) {
		const [row] = db.insert(farms).values(farm).returning({ id: farms.id }).all();
		farmIds.set(farm.name, row.id);
	}

	const bagIds = new Map<string, number>();
	for (const bag of BAGS) {
		const [row] = db.insert(bags).values(bag).returning({ id: bags.id }).all();
		bagIds.set(bag.code, row.id);
	}

	db.insert(staff).values(STAFF).run();

	// Old code -> generated code, so lots and references can still be matched on
	// the string they were exported with.
	const orderCodes = new Map<string, string>();
	const orderIds = new Map<string, number>();
	const issued: string[] = [];

	for (const order of ORDERS) {
		const date = parseDate(order.date);
		const client = CLIENTS.find((c) => c.code === order.clientCode)!;
		const code = orderCode(clientPrefix(client.name, client.brand), 'Maquila', date, issued);
		issued.push(code);
		orderCodes.set(order.code, code);

		const [row] = db
			.insert(orders)
			.values({
				code,
				date,
				type: 'Maquila',
				clientId: clientIds.get(order.clientCode)!,
				brand: order.brand,
				peelStick: order.peelStick,
				productLine: null,
				notes: order.notes,
				status: order.status as never,
				priority: false
			})
			.returning({ id: orders.id })
			.all();
		orderIds.set(order.code, row.id);
	}

	for (const lot of LOTS) {
		const [created] = db
			.insert(lots)
			.values({
				code: lotCode(orderCodes.get(lot.orderCode)!, lot.letter),
				orderId: orderIds.get(lot.orderCode)!,
				letter: lot.letter,
				rawMaterial: lot.rawMaterial as RawMaterial,
				initialWeight: lot.initialWeight,
				variety: lot.variety,
				process: lot.process as ProcessType,
				humidity: lot.humidity,
				farmId: farmIds.get(lot.farm) ?? null,
				selectionStages: lot.selectionStages as SelectionStage[],
				roastType: lot.roastType as RoastType,
				screens: lot.screens as Screen[],
				addQuaker: lot.addQuaker,
				storeInWarehouse: lot.storeInWarehouse,
				status: lot.status
			})
			.returning({ id: lots.id })
			.all();

		// Its arrival, in the ledger. Every balance the app shows is a SUM over
		// these, so a lot without a reception entry would read as holding nothing.
		postReception(db, {
			id: created.id,
			orderId: orderIds.get(lot.orderCode)!,
			rawMaterial: lot.rawMaterial,
			initialWeight: lot.initialWeight
		});
	}

	for (const reference of REFERENCES) {
		db.insert(references)
			.values({
				code: reference.code,
				orderId: orderIds.get(reference.orderCode)!,
				grams: reference.grams,
				quantity: reference.quantity,
				grind: reference.grind as never,
				variety: reference.variety,
				bagId: bagIds.get(reference.bag) ?? null
			})
			.run();
	}

	return {
		clients: CLIENTS.length,
		farms: FARMS.length,
		bags: BAGS.length,
		staff: STAFF.length,
		orders: ORDERS.length,
		lots: LOTS.length,
		references: REFERENCES.length,
		skippedOrphanReferenceOrders: SKIPPED_REFERENCE_ORDERS
	};
}
