/**
 * Edge cases — the app pushed at its own rules.
 *
 * `verify.ts` checks that the normal path is right. This asks the opposite
 * question: when someone types something impossible, does the system refuse,
 * and does it refuse for the stated reason rather than by accident?
 *
 * Each block leaves the database as it found it, so it can run after a seed
 * without a reseed of its own.
 */

import { db } from '../src/lib/server/db/index.ts';
import { lots as lotsTable, orders, ledger } from '../src/lib/server/db/schema.ts';
import { and, eq, isNull } from 'drizzle-orm';
import { recordTrilla, undoTrilla, updateTrilla } from '../src/lib/server/trilla.ts';
import { recordSeleccion } from '../src/lib/server/seleccion.ts';
import { recordTostion, undoTostion } from '../src/lib/server/tostion.ts';
import { recordEmpaque, undoEmpaque } from '../src/lib/server/empaque.ts';
import { recordMovimiento, undoMovimiento } from '../src/lib/server/movimientos.ts';
import { lotLedger, postEntries } from '../src/lib/server/ledger.ts';
import { orderIdFor } from '../src/lib/server/orders.ts';
import { lotIdFor } from '../src/lib/server/lots.ts';
import { totalOf } from '../src/lib/domain/ledger.ts';
import { orderCode, nextLetter } from '../src/lib/domain/codes.ts';
import { parseQuery } from '../src/lib/server/historial.ts';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) failures++;
	console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : `\n         esperado ${JSON.stringify(expected)}, obtuvo ${JSON.stringify(actual)}`}`);
}

/** Runs something that must be refused, and reports what it said. */
async function refuses(label: string, run: () => Promise<unknown>) {
	try {
		await run();
		check(label, 'no falló', 'debía fallar');
	} catch (error) {
		console.log(`  ok   ${label}\n         → ${(error as Error).message}`);
	}
}

const [order] = await db.select().from(orders).where(eq(orders.code, 'TIE-M0727A'));
const lots = await db
	.select()
	.from(lotsTable)
	.where(and(eq(lotsTable.orderId, order.id), isNull(lotsTable.deletedAt)));
const A = lots.find((lot) => lot.letter === 'A')!; // CPS 46
const B = lots.find((lot) => lot.letter === 'B')!; // AV 1,1
const C = lots.find((lot) => lot.letter === 'C')!; // AV 26,4

console.log('\nPesos imposibles');

await refuses('trilla de más pergamino del que hay', () =>
	recordTrilla({ lotId: A.id, parchmentKilos: 999, greenKilos: 700, screens: {}, staffId: 1 })
);
await refuses('trilla que rinde más de lo que entra', () =>
	recordTrilla({ lotId: A.id, parchmentKilos: 10, greenKilos: 12, screens: {}, staffId: 1 })
);
await refuses('trilla de peso cero', () =>
	recordTrilla({ lotId: A.id, parchmentKilos: 0, greenKilos: 0, screens: {}, staffId: 1 })
);
await refuses('trilla de peso negativo', () =>
	recordTrilla({ lotId: A.id, parchmentKilos: -5, greenKilos: -4, screens: {}, staffId: 1 })
);
await refuses('mallas que superan lo trillado', () =>
	recordTrilla({ lotId: A.id, parchmentKilos: 10, greenKilos: 8, screens: { '14': 9 }, staffId: 1 })
);
await refuses('selección que devuelve más de lo que entra', () =>
	recordSeleccion({ lotId: C.id, totalKilos: 10, netKilos: 12, staffId: 1 })
);
await refuses('tostión de un bache mayor que el tostador', () =>
	recordTostion({ lotId: C.id, roastType: 'Media/Media - City', batchKilos: 30, roastedKilos: 24, staffId: 1 })
);
await refuses('tostión que sale más pesada de lo que entró', () =>
	recordTostion({ lotId: C.id, roastType: 'Media/Media - City', batchKilos: 10, roastedKilos: 11, staffId: 1 })
);

console.log('\nLotes y estados equivocados');

await refuses('tostar pergamino sin trillar', () =>
	recordTostion({ lotId: A.id, roastType: 'Media/Media - City', batchKilos: 10, roastedKilos: 8, staffId: 1 })
);
await refuses('empacar café que no está tostado', () =>
	recordEmpaque({ lotId: C.id, grams: 500, quantity: 2, grind: 'GRANO', inspection: 'Aceptado', staffId: 1 })
);
await refuses('un lote que no existe', () =>
	recordTostion({ lotId: 99999, roastType: 'Media/Media - City', batchKilos: 1, roastedKilos: 1, staffId: 1 })
);

console.log('\nMovimientos');

await refuses('combinar un solo lote', () =>
	db.transaction((tx) =>
		recordMovimiento(tx, { orderId: order.id, action: 'COMBINAR LOTE', staffId: 1, legs: [{ lotId: B.id, kilos: 1 }] })
	)
);
await refuses('mover más de lo que el lote tiene', () =>
	db.transaction((tx) =>
		recordMovimiento(tx, {
			orderId: order.id, action: 'COMBINAR LOTE', staffId: 1,
			legs: [{ lotId: B.id, kilos: 999 }, { lotId: C.id, kilos: 1 }]
		})
	)
);
await refuses('mezclar pergamino con almendra', () =>
	db.transaction((tx) =>
		recordMovimiento(tx, {
			orderId: order.id, action: 'COMBINAR LOTE', staffId: 1,
			legs: [{ lotId: A.id, kilos: 1 }, { lotId: B.id, kilos: 1 }]
		})
	)
);
await refuses('transferir un lote a sí mismo', () =>
	db.transaction((tx) =>
		recordMovimiento(tx, {
			orderId: order.id, action: 'TRANSFERIR PESO', staffId: 1,
			destinationLotId: B.id, legs: [{ lotId: B.id, kilos: 0.5 }]
		})
	)
);
await refuses('transferir sin destino', () =>
	db.transaction((tx) =>
		recordMovimiento(tx, { orderId: order.id, action: 'TRANSFERIR PESO', staffId: 1, legs: [{ lotId: B.id, kilos: 0.5 }] })
	)
);
/*
 * Café empacado. Se tuesta y se empaca una parte de C, y luego se intenta mover
 * lo empacado: ni nombrando el balde ni dejando que el sistema lo deduzca — con
 * todo empacado no queda otra cosa que mover. El bloque deshace lo suyo.
 */
{
	const tostion = await recordTostion({
		lotId: C.id, roastType: 'Media/Media - City', batchKilos: 10, roastedKilos: 8, staffId: 1
	});
	const empaque = await recordEmpaque({
		lotId: C.id, grams: 1000, quantity: 8, grind: 'GRANO', inspection: 'Aceptado', staffId: 1
	});

	await refuses('combinar café empacado', () =>
		db.transaction((tx) =>
			recordMovimiento(tx, {
				orderId: order.id, action: 'COMBINAR LOTE', staffId: 1,
				legs: [
					{ lotId: C.id, kilos: 1, state: 'EMPACADO', selected: false },
					{ lotId: B.id, kilos: 0.5, state: 'EMPACADO', selected: false }
				]
			})
		)
	);
	await refuses('separar café empacado', () =>
		db.transaction((tx) =>
			recordMovimiento(tx, {
				orderId: order.id, action: 'SEPARAR LOTE', staffId: 1,
				legs: [{ lotId: C.id, kilos: 2, state: 'EMPACADO', selected: false }]
			})
		)
	);
	/*
	 * El destino también tiene que estar empacado, si no lo rechaza antes la
	 * regla de "no mezclar clases" y la prueba no probaría nada.
	 */
	const tostionB = await recordTostion({
		lotId: B.id, roastType: 'Media/Media - City', batchKilos: 1, roastedKilos: 0.8, staffId: 1
	});
	const empaqueB = await recordEmpaque({
		lotId: B.id, grams: 500, quantity: 1, grind: 'GRANO', inspection: 'Aceptado', staffId: 1
	});

	await refuses('transferir café empacado', () =>
		db.transaction((tx) =>
			recordMovimiento(tx, {
				orderId: order.id, action: 'TRANSFERIR PESO', staffId: 1, destinationLotId: B.id,
				legs: [{ lotId: C.id, kilos: 2, state: 'EMPACADO', selected: false }]
			})
		)
	);

	// Y lo que sí se puede mover del mismo lote sigue moviéndose.
	const movimiento = await db.transaction((tx) =>
		recordMovimiento(tx, {
			orderId: order.id, action: 'SEPARAR LOTE', staffId: 1,
			legs: [{ lotId: C.id, kilos: 1, state: 'VERDE', selected: false }]
		})
	);
	check('lo no empacado sí se mueve', typeof movimiento, 'number');

	await undoMovimiento(movimiento);
	await undoEmpaque(empaqueB);
	await undoTostion(tostionB);
	await undoEmpaque(empaque);
	await undoTostion(tostion);
}

await refuses('mover cero kilos', () =>
	db.transaction((tx) =>
		recordMovimiento(tx, {
			orderId: order.id, action: 'TRANSFERIR PESO', staffId: 1,
			destinationLotId: C.id, legs: [{ lotId: B.id, kilos: 0 }]
		})
	)
);

console.log('\nEl registro no admite saldos negativos');

await refuses('sacar más café del que hay, directo en el ledger', () =>
	db.transaction(async (tx) =>
		postEntries(tx, [
			{ orderId: order.id, lotId: B.id, state: 'VERDE', kilos: -50, eventType: 'movimiento', eventId: 1 }
		])
	)
);

console.log('\nDeshacer y editar');

{
	const before = totalOf((await lotLedger(C.id)).balances);
	const first = await recordTostion({ lotId: C.id, roastType: 'Media/Media - City', batchKilos: 10, roastedKilos: 8, staffId: 1 });
	const second = await recordTostion({ lotId: C.id, roastType: 'Media/Media - City', batchKilos: 10, roastedKilos: 8, staffId: 1 });

	await refuses('deshacer un evento con otro encima', () => undoTostion(first));
	await refuses('editar un evento con otro encima', () =>
		updateTrilla(first, { lotId: C.id, parchmentKilos: 1, greenKilos: 1, screens: {}, staffId: 1 })
	);

	await undoTostion(second);
	await undoTostion(first);
	check('deshacer los dos deja el lote como estaba', Number(totalOf((await lotLedger(C.id)).balances).toFixed(2)), Number(before.toFixed(2)));

	await refuses('deshacer dos veces el mismo evento', () => undoTostion(first));
}

console.log('\nCódigos y URLs');

// Fecha local, no UTC: `new Date('2026-07-27')` es medianoche en Greenwich y
// aquí cae el día anterior.
check('dos órdenes el mismo día no colisionan',
	orderCode('TIE', 'Maquila', new Date(2026, 6, 27), ['TIE-M0727A']), 'TIE-M0727B');
check('la letra pasa de Z a AA', nextLetter(['Z']), 'AA');
check('una letra libre en el medio no se reutiliza', nextLetter(['A', 'C']), 'D');
check('un código que no existe no resuelve', await orderIdFor('NO-EXISTE'), null);
check('un lote que no existe tampoco', await lotIdFor('NO-EXISTE-LT-A'), null);
check('un id numérico viejo sigue sirviendo', await orderIdFor(String(order.id)), order.id);

console.log('\nFiltros del historial');

check('una vista inventada cae en órdenes', parseQuery(new URLSearchParams('vista=inventada')).view, 'ordenes');
check('una fecha inválida se ignora', parseQuery(new URLSearchParams('desde=no-es-fecha')).from, undefined);
const hasta = parseQuery(new URLSearchParams('hasta=2026-08-14')).to!;
check('hasta cubre todo su día',
	[hasta.getHours(), hasta.getMinutes(), hasta.getSeconds()], [23, 59, 59]);
check('parámetros vacíos no filtran nada',
	Object.values(parseQuery(new URLSearchParams('cliente=&orden=&estado='))).filter(Boolean).length, 1);

console.log(failures === 0 ? '\nTodo correcto.\n' : `\n${failures} fallas.\n`);
process.exit(failures === 0 ? 0 : 1);
