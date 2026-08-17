/**
 * Verification against the plan's checklist. Exercises the server layer
 * directly so the behaviours can be asserted, not eyeballed.
 *
 * Runs against a scratch database so it never disturbs the seeded one.
 */

import { orderCode, nextLetter, clientPrefix } from '../src/lib/domain/codes.ts';
import { visibleSections } from '../src/lib/domain/derived.ts';
import { estimatedGreenKilos, estimatedRoastedKilos, estimatedOrderKilos, maxUnits } from '../src/lib/domain/estimates.ts';
import { validateSelectionStages, validateScreens, validateBagSize, validatePlannedWeight } from '../src/lib/domain/validation.ts';
import { nextStep, lotLabel, lotStatus, currentGreenKilos, currentRoastedKilos, totalKilos, mermaKilos, mermaFraction, isActiveLot, stepTone } from '../src/lib/domain/lotState.ts';
import { summarise, totalOf } from '../src/lib/domain/ledger.ts';
import { focusLineage } from '../src/lib/domain/lineage.ts';
import { validateOriginCount, validateLegWeight } from '../src/lib/domain/validation.ts';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) failures++;
	console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : `\n         esperado ${JSON.stringify(expected)}, obtuvo ${JSON.stringify(actual)}`}`);
}

console.log('\nGeneración de códigos');

// Bug 1: the date segment must be zero-padded so Nov 5 and Jan 15 differ.
const nov5 = orderCode('MAH', 'Maquila', new Date(2026, 10, 5), []);
const jan15 = orderCode('MAH', 'Maquila', new Date(2026, 0, 15), []);
check('5 nov ≠ 15 ene (colisión original)', nov5 !== jan15, true);
check('5 nov usa MMDD', nov5, 'MAH-M1105A');
check('15 ene usa MMDD', jan15, 'MAH-M0115A');

// Bug 2: the sequence letter must advance for same client, type and date.
const day = new Date(2026, 6, 27);
const first = orderCode('TIE', 'Maquila', day, []);
const second = orderCode('TIE', 'Maquila', day, [first]);
const third = orderCode('TIE', 'Maquila', day, [first, second]);
check('primera orden del día', first, 'TIE-M0727A');
check('segunda orden del día avanza', second, 'TIE-M0727B');
check('tercera orden del día avanza', third, 'TIE-M0727C');

// Order type drives the letter.
check('exportación usa E', orderCode('TIE', 'Exportacion', day, []), 'TIE-E0727A');
check('interno usa N', orderCode('TIE', 'Nacional/Interno', day, []), 'TIE-N0727A');

// Prefix rule, including the article skip.
check('prefijo desde marca', clientPrefix('Jhon Hurtado', 'Mahusa'), 'MAH');
check('prefijo salta artículo', clientPrefix('Octavio Cardona', 'La Amapola'), 'AMA');
check('prefijo salta café', clientPrefix('Ana Ruiz', 'Café Tierra Morena'), 'TIE');
check('salta café con tilde', clientPrefix('Ana Ruiz', 'Cafés La Montaña'), 'MON');
check('salta artículo y café juntos', clientPrefix('Ana Ruiz', 'El Café Bonito'), 'BON');
check('una marca de puras palabras saltadas conserva la última',
	clientPrefix('Ana Ruiz', 'La Café'), 'CAF');
check('prefijo sin marca usa cliente', clientPrefix('Gonzalo Garcia', null), 'GON');

// Letters are never reused, even after a void.
check('letra no se reutiliza tras hueco', nextLetter(['A', 'C']), 'D');
check('letras pasan de Z a AA', nextLetter(['Y', 'Z']), 'AA');

console.log('\nVisibilidad de secciones');

check(
	'CPS muestra trilla',
	visibleSections([{ rawMaterial: 'CPS', selectionStages: ['NINGUNO'], roastType: 'Ninguno' }]),
	{ trilla: true, seleccionVerde: false, tostion: false, seleccionTostado: false, empaque: true }
);

check(
	'AV sin tostión no muestra trilla ni tostión',
	visibleSections([{ rawMaterial: 'AV', selectionStages: ['NINGUNO'], roastType: 'Ninguno' }]),
	{ trilla: false, seleccionVerde: false, tostion: false, seleccionTostado: false, empaque: true }
);

check(
	'selección en ambas etapas muestra ambas secciones',
	visibleSections([
		{ rawMaterial: 'CPS', selectionStages: ['VERDE', 'TOSTADO'], roastType: 'Media/Media - City' }
	]),
	{ trilla: true, seleccionVerde: true, tostion: true, seleccionTostado: true, empaque: true }
);

console.log('\nEstimados de rendimiento');

// Factores de trilla por beneficio, del libro original.
check('lavado rinde 80 % en trilla', estimatedGreenKilos({ rawMaterial: 'CPS', initialWeight: 100, process: 'Lavado' }), 80);
check('honey rinde 77,5 % en trilla', estimatedGreenKilos({ rawMaterial: 'CPS', initialWeight: 100, process: 'Honey' }), 77.5);
check('natural rinde 70 % en trilla', estimatedGreenKilos({ rawMaterial: 'CPS', initialWeight: 100, process: 'Natural' }), 70);
check('almendra verde no pasa por trilla', estimatedGreenKilos({ rawMaterial: 'AV', initialWeight: 100, process: 'Lavado' }), 100);

check('CPS lavado tostado = 64 %', estimatedRoastedKilos({ rawMaterial: 'CPS', initialWeight: 100, process: 'Lavado' }), 64);
check('AV tostado = 80 %', estimatedRoastedKilos({ rawMaterial: 'AV', initialWeight: 100, process: 'Lavado' }), 80);
check('lote ya tostado no pierde de nuevo', estimatedRoastedKilos({ rawMaterial: 'TOSTADO', initialWeight: 100, process: 'Lavado' }), 100);

// Reproduce la orden TIE-M727A: su referencia real es de 50,52 kg.
const tie = [
  { rawMaterial: 'CPS', initialWeight: 46,   process: 'Honey' },
  { rawMaterial: 'AV',  initialWeight: 1.1,  process: 'Honey' },
  { rawMaterial: 'AV',  initialWeight: 26.4, process: 'Honey' }
];
check('TIE-M727A estima 50,52 kg (coincide con su referencia)', Math.abs(estimatedOrderKilos(tie) - 50.52) < 0.005, true);

check('caben 101 bolsas de 500 g en 50,52 kg', maxUnits(50.52, 500), 101);
check('caben 0 bolsas si no queda peso', maxUnits(0, 500), 0);

console.log('\nReglas de validación');

check('NINGUNO solo no da error', validateSelectionStages(['NINGUNO']), null);
check('NINGUNO combinado se rechaza', typeof validateSelectionStages(['NINGUNO', 'VERDE']), 'string');
check('CPS sin mallas se rechaza', typeof validateScreens([], 'CPS'), 'string');
check('AV sin mallas se acepta', validateScreens([], 'AV'), null);
check('Ninguna combinada se rechaza', typeof validateScreens(['Ninguna', '14'], 'CPS'), 'string');
check('bolsa de 500 g con referencia 340 g se rechaza', typeof validateBagSize('BO04', 500, 340), 'string');
check('bolsa de 340 g con referencia 340 g se acepta', validateBagSize('BO04 - 340', 340, 340), null);
check('bolsa del cliente ignora el tamaño', validateBagSize('Cliente', null, 2500), null);

// El plan se compara contra el estimado tostado, no contra el peso recibido.
check('plan mayor que el estimado se rechaza', typeof validatePlannedWeight(60, 50.52), 'string');
check('plan igual al estimado se acepta', validatePlannedWeight(50.52, 50.52), null);
check('plan menor que el estimado se acepta', validatePlannedWeight(20, 50.52), null);
check('sin lotes no se valida', validatePlannedWeight(999, 0), null);
// JHO-M729A existe en producción con 2 g de exceso por redondeo.
check('2 g de exceso por redondeo se acepta', validatePlannedWeight(41.09, 41.088), null);
check('exceso real de 1 kg se rechaza', typeof validatePlannedWeight(42.09, 41.088), 'string');
// La tolerancia es de 10 g: cubre el redondeo a dos decimales y nada más.
check('50 g de exceso ahora se rechaza', typeof validatePlannedWeight(41.138, 41.088), 'string');
check('10 g de exceso se acepta', validatePlannedWeight(41.098, 41.088), null);
check('11 g de exceso se rechaza', typeof validatePlannedWeight(41.099, 41.088), 'string');

console.log('\nTablero de lotes');

/** A received lot, with only the fields the projections read. */
const lot = (over: Record<string, unknown> = {}) => ({
  letter: 'A', variety: 'Castillo', status: 'CPS', rawMaterial: 'CPS',
  initialWeight: 46, selectionStages: ['NINGUNO'], screens: ['Ninguna'],
  addQuaker: false, storeInWarehouse: false, ...over
}) as never;

/**
 * A ledger holding the given balances. Status and every weight are projections
 * over this, so a test says what the lot is *holding* rather than what state
 * somebody wrote down.
 */
const held = (
  balances: Partial<{ verde: number; verdeSel: number; tostado: number; tostadoSel: number; empacado: number }>,
  extra: { events?: string[]; consumedBy?: number; movedIn?: number; movedOut?: number } = {}
) => ({
  balances: { verde: 0, verdeSel: 0, tostado: 0, tostadoSel: 0, empacado: 0, ...balances },
  events: new Set(extra.events ?? []),
  consumedBy: extra.consumedBy ?? null,
  movedIn: extra.movedIn ?? 0,
  movedOut: extra.movedOut ?? 0
}) as never;

/** The reception entry every lot gets: its whole weight, in the form it arrived. */
const received = (kilos = 46, state: 'verde' | 'tostado' = 'verde') =>
  held({ [state]: kilos }, { events: ['recepcion'] });

const step = (over: Record<string, unknown>, ledger: unknown, hasReferences = true) =>
  nextStep(lot(over), { hasReferences, ledger: ledger as never });

// La etiqueta que se lee en el tablero, no el ID_LOTE.
check('etiqueta = letra - variedad - estado',
  lotLabel({ letter: 'C', variety: 'Castillo', status: 'EN PROCESO TOSTION' }),
  'C - Castillo - EN PROCESO TOSTION');

console.log('\nESTADO ACTUAL derivado del registro');

// Cada rama de lotStatus, dicha en kilos y no en cadenas de texto.
check('CPS sin trilla', lotStatus(lot(), received()), 'CPS');
check('CPS con trilla ya es almendra',
  lotStatus(lot(), held({ verde: 34.5 }, { events: ['recepcion', 'trilla'] })), 'AV');
check('llegó AV', lotStatus(lot({ rawMaterial: 'AV' }), received()), 'AV');
check('verde seleccionado', lotStatus(lot(), held({ verdeSel: 30 })), 'AV SELECCIONADO');
check('verde a medio seleccionar', lotStatus(lot(), held({ verde: 10, verdeSel: 20 })), 'EN PROCESO SELECCION');
check('tostado', lotStatus(lot(), held({ tostado: 25 })), 'TOSTADO');
check('tostado seleccionado', lotStatus(lot(), held({ tostadoSel: 25 })), 'TST SELECCIONADO');
check('tostado a medio seleccionar', lotStatus(lot(), held({ tostado: 5, tostadoSel: 20 })), 'EN PROCESO SEL-TST');
check('verde y tostado a la vez es tostión en proceso',
  lotStatus(lot(), held({ verde: 21, tostado: 23 })), 'EN PROCESO TOSTION');
// El caso que un listado plano se equivocaría: el verde está en la cubeta
// seleccionada, así que probar sólo `verde` lo daría por TOSTADO.
check('verde seleccionado + tostado sigue siendo tostión en proceso',
  lotStatus(lot(), held({ verdeSel: 10, tostado: 5 })), 'EN PROCESO TOSTION');
check('todo empacado', lotStatus(lot(), held({ empacado: 30 })), 'EMPACADO');
check('empacado a medias', lotStatus(lot(), held({ tostado: 5, empacado: 25 })), 'EN PROCESO EMPAQUE');
check('vaciado por un movimiento', lotStatus(lot(), held({}, { consumedBy: 7 })), 'COMBINADO');

// PASO SIGUIENTE, rama por rama.
check('CPS con mallas -> trillar y separar', step({ screens: ['14'] }, received()), 'TRILLAR Y SEPARAR MALLA(S) 14');
check('CPS con varias mallas las lista', step({ screens: ['14', '15/16'] }, received()), 'TRILLAR Y SEPARAR MALLA(S) 14, 15/16');
check('CPS sin mallas -> trilla', step({}, received()), 'TRILLA');
check('AV con selección verde', step({ rawMaterial: 'AV', selectionStages: ['VERDE'] }, received()), 'SELECCION VERDE');
check('AV sin selección verde -> tostión', step({ rawMaterial: 'AV' }, received()), 'TOSTION');
check('AV seleccionado -> tostión', step({ rawMaterial: 'AV' }, held({ verdeSel: 30 })), 'TOSTION');
check('selección verde a medias -> terminarla', step({ rawMaterial: 'AV' }, held({ verde: 10, verdeSel: 20 })), 'TERMINAR SELECCION VERDE');
check('en proceso tostión -> terminar', step({}, held({ verde: 10, tostado: 10 })), 'TERMINAR TOSTION');
check('tostado con selección tostado', step({ selectionStages: ['TOSTADO'] }, held({ tostado: 25 })), 'SELECCION TOSTADO');
// El lote de quakers nace con PROCESO SELECCION = NINGUNO, así que su propio
// pliego ya dice que no se vuelve a seleccionar: el paso sale de ahí, sin que
// nadie pregunte por la clase del lote.
check('los quakers no vuelven a selección',
  step({ selectionStages: ['NINGUNO'], kind: 'QUAKER' }, held({ tostado: 1.5 })), 'MOLIENDA/EMPAQUE');
// AGREGAR QUAKER dice qué pasa con lo que retira una selección; un lote que no
// se está seleccionando no tiene quakers de qué hablar.
check('tostado con quaker sigue igual', step({ addQuaker: true }, held({ tostado: 25 })), 'MOLIENDA/EMPAQUE');
check('tostado sin referencias -> granel', step({}, held({ tostado: 25 }), false), 'EN GRANEL');
check('tostado con referencias -> molienda/empaque', step({}, held({ tostado: 25 })), 'MOLIENDA/EMPAQUE');
check('tst seleccionado -> molienda/empaque', step({}, held({ tostadoSel: 25 })), 'MOLIENDA/EMPAQUE');
// Lo que falta por empacar sale del registro, no de un contador aparte.
check('empaque a medias dice cuánto falta', step({}, held({ tostado: 5, empacado: 25 })), 'TERMINAR EMPAQUE (5.00 kg)');
// Bodega gana sobre todo lo demás.
check('guardar en bodega manda', step({ storeInWarehouse: true }, received()), 'GUARDAR');

console.log('\nBalances');

// Un lote recién recibido no es un caso especial: es un lote con un renglón.
check('CPS pesa en verde', currentGreenKilos(lot(), received()), 46);
check('CPS no pesa en tostado', currentRoastedKilos(lot(), received()), 0);
check('lote tostado pesa en tostado', currentRoastedKilos(lot({ rawMaterial: 'TOSTADO' }), received(46, 'tostado')), 46);
check('lote tostado no pesa en verde', currentGreenKilos(lot({ rawMaterial: 'TOSTADO' }), received(46, 'tostado')), 0);
check('sin eventos no hay merma', mermaKilos(lot(), received()), 0);
check('sin eventos % merma es 0', mermaFraction(lot(), received()), 0);
check('combinado no pesa en ningún lado',
  currentGreenKilos(lot(), held({}, { consumedBy: 1 })) + currentRoastedKilos(lot(), held({}, { consumedBy: 1 })), 0);

// Una tostión escrita en bruto: 25 kg entran, 23 salen. La merma es la
// diferencia, y nadie la escribe.
const roasted = held({ verde: 21, tostado: 23 });
check('tostión: pesa 44 en total', totalKilos(lot(), roasted), 44);
check('tostión: la merma es la diferencia', Number(mermaKilos(lot(), roasted).toFixed(2)), 2);
check('tostión: % merma', Number((mermaFraction(lot(), roasted) * 100).toFixed(2)), 4.35);

// Empacar no es una salida: el café sigue ahí, en bolsas.
check('empacar no cambia el total', totalKilos(lot(), held({ empacado: 46 })), 46);
check('empacar no genera merma', mermaKilos(lot(), held({ empacado: 46 })), 0);

console.log('\nSumar el registro');

// Los saldos son SUMA: el orden de los renglones no puede cambiarlos.
let entryId = 0;
const entry = (kilos: number, over: Record<string, unknown> = {}) => ({
  id: ++entryId, lotId: 1, state: 'VERDE', selected: false, kilos,
  eventType: 'trilla', eventId: 1, reversesId: null, ...over
}) as never;
const forward = summarise([entry(46, { eventType: 'recepcion' }), entry(-46), entry(34.5)]);
const backward = summarise([entry(34.5), entry(-46), entry(46, { eventType: 'recepcion' })]);
check('la suma no depende del orden', forward.balances.verde, backward.balances.verde);
check('la suma da el saldo', Number(forward.balances.verde.toFixed(2)), 34.5);
check('recuerda qué pasos ocurrieron', forward.events.has('trilla' as never), true);

// Un movimiento que se lo lleva todo deja el lote consumido.
const emptied = summarise([
  entry(46, { eventType: 'recepcion' }),
  entry(-46, { eventType: 'movimiento', eventId: 9 })
]);
check('movimiento que vacía el lote', emptied.consumedBy, 9);
check('lote vaciado se reporta combinado', lotStatus(lot(), emptied), 'COMBINADO');
check('lote vaciado sale del tablero', isActiveLot(lotStatus(lot(), emptied)), false);

// Mover café a otro lote no es merma, en ninguno de los dos lados.
check('lo que se fue a otro lote no es merma',
  mermaKilos(lot(), held({ verde: 36 }, { movedOut: 10 })), 0);
check('un lote nacido en el piso no tiene merma negativa',
  mermaKilos(lot({ initialWeight: 0 }), held({ verde: 11 }, { movedIn: 11 })), 0);

// Una corrección es otro renglón, no una edición.
const corrected = summarise([entry(46, { eventType: 'recepcion' }), entry(-5), entry(5)]);
check('la compensación devuelve el saldo', corrected.balances.verde, 46);

// Qué sale del tablero.
// Un lote empacado se queda: está terminado, no ausente, y el tablero lo manda
// al final de su orden en vez de esconderlo.
check('empacado se queda en el tablero', isActiveLot('EMPACADO'), true);
check('combinado sale del tablero', isActiveLot('COMBINADO'), false);
check('en proceso sigue en el tablero', isActiveLot('EN PROCESO TOSTION'), true);

// El color se deriva del paso, no se escribe a mano.
check('trilla es su propio color', stepTone('TRILLAR Y SEPARAR MALLA(S) 14'), 'trilla');
check('granel cuenta como empaque', stepTone('EN GRANEL'), 'empaque');
check('guardar es bodega', stepTone('GUARDAR'), 'bodega');
// Las dos selecciones no comparten color: la verde va con la almendra, la
// tostada con el café ya tostado.
check('selección verde es verde', stepTone('SELECCION VERDE'), 'seleccionVerde');
check('terminar selección verde también', stepTone('TERMINAR SELECCION VERDE'), 'seleccionVerde');
check('selección tostado es la otra', stepTone('SELECCION TOSTADO'), 'seleccionTostado');
check('terminar selección tostado va con la tostada',
	stepTone('TERMINAR SELECCION TOSTADO'), 'seleccionTostado');
check('molienda y empaque comparten tono', stepTone('MOLIENDA/EMPAQUE'), 'empaque');
// Terminado tiene el suyo, y no cae en ninguno de los de trabajo: es lo que
// distingue de lejos un lote listo de uno que todavía espera algo.
check('terminado tiene su propio color', stepTone('TERMINADO'), 'terminado');

console.log('\nContra la base de datos sembrada');

// La red de seguridad del cambio a estado derivado: para los 11 lotes reales,
// lotStatus tiene que reproducir exactamente lo que la columna decía.
const { db } = await import('../src/lib/server/db/index.ts');
const { lots: lotsTable } = await import('../src/lib/server/db/schema.ts');
const { allLedgers } = await import('../src/lib/server/ledger.ts');

const seeded = await db.select().from(lotsTable);
const ledgers = await allLedgers();

const mismatched = seeded.filter(
  (row) => lotStatus(row, ledgers.get(row.id)) !== row.status
);
check('11 lotes sembrados', seeded.length, 11);
check('el estado derivado reproduce la columna almacenada', mismatched.map((r) => r.code), []);

const balancesMatch = seeded.every((row) => {
  const ledger = ledgers.get(row.id);
  return ledger !== undefined && Math.abs(totalKilos(row, ledger) - row.initialWeight) < 0.005;
});
check('cada lote pesa lo que recibió', balancesMatch, true);
check('sin merma antes de procesar',
  seeded.every((row) => Math.abs(mermaKilos(row, ledgers.get(row.id))) < 0.005), true);

console.log('\nReglas de movimientos');

check('separar admite un solo origen', typeof validateOriginCount('SEPARAR LOTE', 2), 'string');
// Transferir sí admite varios: verter tres lotes parciales en uno que ya existe
// es el mismo acto tres veces, y no crea identidad nueva.
check('transferir admite varios orígenes', validateOriginCount('TRANSFERIR PESO', 3), null);
check('transferir admite uno solo', validateOriginCount('TRANSFERIR PESO', 1), null);
check('combinar admite varios', validateOriginCount('COMBINAR LOTE', 3), null);
// Combinar un solo lote no es combinar: crearía una identidad nueva para café
// que todavía tiene un solo padre.
check('combinar uno solo se rechaza', typeof validateOriginCount('COMBINAR LOTE', 1), 'string');
check('combinar dos se acepta', validateOriginCount('COMBINAR LOTE', 2), null);
check('un movimiento necesita origen', typeof validateOriginCount('COMBINAR LOTE', 0), 'string');
check('no se puede mover más de lo que hay', typeof validateLegWeight(50, 46), 'string');
check('mover justo lo que hay se acepta', validateLegWeight(46, 46), null);
check('mover cero se rechaza', typeof validateLegWeight(0, 46), 'string');

console.log('\nMerma por lote de origen');

{
	const { sourceBalances, sourceMermaFraction } = await import('../src/lib/domain/sourceMerma.ts');

	// Un registro a mano: A recibe 46, trilla deja 37,3 (pierde 8,7), y 2,8 se
	// van a un lote D que después se combina con B en E, donde se pierde algo.
	let id = 0;
	const row = (lotId: number, kilos: number, eventType: string, eventId: number) =>
		({ id: ++id, lotId, state: 'VERDE', selected: false, kilos, eventType, eventId, reversesId: null }) as never;

	const rows = [
		row(1, 46, 'recepcion', 1),      // A, original
		row(2, 1.1, 'recepcion', 2),     // B, original
		row(1, -46, 'trilla', 1),
		row(1, 37.3, 'trilla', 1),       // pierde 8,7
		row(1, -2.8, 'movimiento', 1),   // A → D
		row(4, 2.8, 'movimiento', 1),
		row(2, -1.1, 'movimiento', 2),   // B + D → E
		row(5, 1.1, 'movimiento', 2),
		row(4, -2.8, 'movimiento', 2),
		row(5, 2.8, 'movimiento', 2),
		row(5, -3.9, 'seleccion', 1),    // E pierde 0,3
		row(5, 3.6, 'seleccion', 1)
	];

	const balances = sourceBalances(rows);
	check('sólo los lotes de origen aparecen', [...balances.keys()], [1, 2]);

	const a = balances.get(1)!;
	const b = balances.get(2)!;

	// Los 0,3 de E se reparten según lo que aportó cada uno: 2,8 y 1,1 de 3,9.
	check('el origen A carga su merma y su parte de la mezcla', Number(a.lostKilos.toFixed(2)), 8.92);
	check('el origen B carga sólo su parte', Number(b.lostKilos.toFixed(2)), 0.08);
	check('nada se pierde de vista en A', Number((a.lostKilos + a.standingKilos).toFixed(2)), 46);
	check('nada se pierde de vista en B', Number((b.lostKilos + b.standingKilos).toFixed(2)), 1.1);
	check('el total cuadra', Number((a.lostKilos + b.lostKilos).toFixed(2)), 9);
	check('% merma sobre lo recibido', Number((sourceMermaFraction(a) * 100).toFixed(2)), 19.38);

	// Un evento deshecho no cuenta: su reverso lo cancela.
	const undone = [
		...rows,
		row(5, 3.9, 'seleccion', 1),
		row(5, -3.6, 'seleccion', 1)
	];
	// Los dos últimos revierten los dos anteriores.
	(undone[12] as { reversesId: number | null }).reversesId = 11;
	(undone[13] as { reversesId: number | null }).reversesId = 12;
	const sinSeleccion = sourceBalances(undone);
	check('deshacer la selección devuelve la merma',
		Number(([...sinSeleccion.values()].reduce((s, x) => s + x.lostKilos, 0)).toFixed(2)), 8.7);
}

console.log('\nDeshacer movimientos');

{
	const { recordMovimiento, undoMovimiento } = await import('../src/lib/server/movimientos.ts');
	const { nextLotLetter } = await import('../src/lib/server/lots.ts');
	const { orders: ordersTable } = await import('../src/lib/server/db/schema.ts');
	const { eq } = await import('drizzle-orm');

	const [order] = await db.select().from(ordersTable).where(eq(ordersTable.code, 'TIE-M0727A'));
	const live = async () =>
		(await db.select().from(lotsTable).where(eq(lotsTable.orderId, order.id))).filter(
			(lot) => !lot.deletedAt
		);
	const av = (await live()).filter((lot) => lot.rawMaterial === 'AV');
	const letters = async () => (await live()).map((lot) => lot.letter).join(' ');

	const before = await letters();

	const transfer = db.transaction((tx) =>
		recordMovimiento(tx, {
			orderId: order.id, action: 'TRANSFERIR PESO', staffId: 1,
			destinationLotId: av[1].id, legs: [{ lotId: av[0].id, kilos: 0.5 }]
		})
	);
	const combo = db.transaction((tx) =>
		recordMovimiento(tx, {
			orderId: order.id, action: 'COMBINAR LOTE', staffId: 1,
			legs: [{ lotId: av[0].id, kilos: 0.2 }, { lotId: av[1].id, kilos: 0.3 }]
		})
	);

	// Sólo se deshace el último: lo contrario desarma la historia, porque el café
	// transferido ya está dentro de la combinación.
	let refused = false;
	try { await undoMovimiento(transfer); } catch { refused = true; }
	check('no se deshace un movimiento anterior al último', refused, true);

	await undoMovimiento(combo);
	check('deshacer el último devuelve los lotes', await letters(), before);

	// Y una vez deshecho el nuevo, el anterior vuelve a poder deshacerse: los
	// renglones de compensación no cuentan como actividad posterior.
	let thenAllowed = true;
	try { await undoMovimiento(transfer); } catch { thenAllowed = false; }
	check('después sí se deshace el anterior', thenAllowed, true);

	// La letra de un lote deshecho se reutiliza; la de un lote vivo no.
	check('la letra del lote deshecho vuelve a estar libre', nextLotLetter(db, order.id), 'D');
}

console.log('\nEmpaque');

{
	const { recordTostion } = await import('../src/lib/server/tostion.ts');
	const { recordEmpaque, undoEmpaque, listEmpaques, referenceProgress } =
		await import('../src/lib/server/empaque.ts');
	const { lotLedger } = await import('../src/lib/server/ledger.ts');
	const { empaqueOptions } = await import('../src/lib/server/lookups.ts');
	const { orders: ordersTable } = await import('../src/lib/server/db/schema.ts');
	const { eq } = await import('drizzle-orm');

	// Una orden de almendra verde que sólo pide selección tostada: se puede
	// tostar de una vez, que es lo que este bloque necesita para empacar.
	const [order] = await db.select().from(ordersTable).where(eq(ordersTable.code, 'MAH-M0729A'));
	const [lot] = (await db.select().from(lotsTable).where(eq(lotsTable.orderId, order.id)))
		.filter((row) => !row.deletedAt);

	// Un lote sin tostar no se puede empacar.
	check('un lote sin tostar no aparece en empaque', (await empaqueOptions(order.id)).length, 0);

	await recordTostion({
		lotId: lot.id, roastType: 'Media/Media - City',
		batchKilos: 12, roastedKilos: 9.6, staffId: 1
	});

	const packable = await empaqueOptions(order.id);
	check('el lote tostado sí aparece', packable.some((o) => o.value === String(lot.id)), true);
	check('ofrece sólo el café tostado',
		Number(packable.find((o) => o.value === String(lot.id))!.availableKilos.toFixed(2)), 9.6);

	// 20 bolsas de 250 g = 5 kg: salen de TOSTADO y entran en EMPACADO.
	const first = await recordEmpaque({
		lotId: lot.id, grams: 250, quantity: 20, grind: 'GRANO',
		inspection: 'Aceptado', staffId: 1
	});

	const after = await lotLedger(lot.id);
	check('el empaque descuenta del tostado', Number(after.balances.tostado.toFixed(2)), 4.6);
	check('y lo suma a empacado', Number(after.balances.empacado.toFixed(2)), 5);
	// Empacar no es una salida: el lote pesa lo mismo antes y después.
	check('el total del lote no cambia', Number(totalOf(after.balances).toFixed(2)), 9.6);
	check('el lote queda EN PROCESO EMPAQUE', lotStatus(lot, after), 'EN PROCESO EMPAQUE');

	// No se puede empacar más de lo que hay tostado.
	let refused = false;
	try {
		await recordEmpaque({
			lotId: lot.id, grams: 1000, quantity: 7, grind: 'GRANO',
			inspection: 'Aceptado', staffId: 1
		});
	} catch { refused = true; }
	check('no se empaca más de lo tostado', refused, true);

	// El resto: el lote pasa a EMPACADO entero.
	const second = await recordEmpaque({
		lotId: lot.id, grams: 100, quantity: 46, grind: 'MOLIDO',
		inspection: 'Aceptado', staffId: 1
	});
	check('empacado todo, el lote lee EMPACADO',
		lotStatus(lot, await lotLedger(lot.id)), 'EMPACADO');
	check('los dos empaques quedan listados', (await listEmpaques(order.id)).length, 2);

	// Esta orden no tiene referencias — es una de las que el seed reporta sin
	// plan —, así que el panel del formulario sale vacío en vez de fallar.
	check('una orden sin plan reporta cero líneas', (await referenceProgress(order.id)).length, 0);

	// Sólo se deshace el último, como en todos los pasos de proceso.
	let refusedUndo = false;
	try { await undoEmpaque(first); } catch { refusedUndo = true; }
	check('no se deshace un empaque anterior al último', refusedUndo, true);

	await undoEmpaque(second);
	const undone = await lotLedger(lot.id);
	check('deshacer devuelve el café a tostado', Number(undone.balances.tostado.toFixed(2)), 4.6);
	check('y lo saca de empacado', Number(undone.balances.empacado.toFixed(2)), 5);
	check('el empaque deshecho sale de la lista', (await listEmpaques(order.id)).length, 1);

	// Contra una orden que sí tiene plan: empacar contra una línea la adelanta,
	// que es lo que el panel del formulario lee.
	const [planned] = await db.select().from(ordersTable).where(eq(ordersTable.code, 'GON-M0728A'));
	const [greenLot] = (await db.select().from(lotsTable).where(eq(lotsTable.orderId, planned.id)))
		.filter((row) => row.rawMaterial === 'AV' && !row.deletedAt);

	await recordTostion({
		lotId: greenLot.id, roastType: 'Media/Media - City',
		batchKilos: 2, roastedKilos: 1.6, staffId: 1
	});

	const [line] = await referenceProgress(planned.id);
	await recordEmpaque({
		lotId: greenLot.id, referenceId: line.id,
		grams: line.grams, quantity: 3, grind: line.grind,
		inspection: 'Aceptado', staffId: 1
	});

	const advanced = (await referenceProgress(planned.id)).find((l) => l.id === line.id)!;
	check('la línea del plan avanza', advanced.packedQuantity, 3);
	check('y lo pendiente baja', advanced.pendingQuantity, line.quantity - 3);
	check('las demás líneas no se mueven',
		(await referenceProgress(planned.id))
			.filter((l) => l.id !== line.id)
			.every((l) => l.packedQuantity === 0), true);
}

console.log('\nÁrbol de un lote');

{
	// El ejemplo del que salió la regla: A se trilla y separa D; después D se
	// combina con C y nace F.
	const graph = {
		nodes: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
		edges: [
			{ from: 1, to: 2 }, // A → D
			{ from: 2, to: 4 }, // D → F
			{ from: 3, to: 4 } //  C → F
		]
	};
	const letters = new Map([[1, 'A'], [2, 'D'], [3, 'C'], [4, 'F']]);
	const shown = (lotId: number) =>
		focusLineage(graph, lotId)
			.nodes.map((node) => letters.get(node.id))
			.sort()
			.join(' ');

	// Hacia adelante sólo un paso: F no es asunto de A.
	check('A ve su propia separación', shown(1), 'A D');
	// Hacia atrás, todo; hacia adelante, sus hijos y con quién se mezclaron.
	check('D ve de dónde viene y en qué terminó', shown(2), 'A C D F');
	check('F ve a sus dos padres y al padre de uno', shown(4), 'A C D F');
	check('C ve con quién se combinó', shown(3), 'C D F');

	// Un arco cuyo otro extremo no está no se dibuja.
	check('no quedan arcos colgando',
		focusLineage(graph, 1).edges.every(
			(edge) => focusLineage(graph, 1).nodes.some((node) => node.id === edge.from) &&
				focusLineage(graph, 1).nodes.some((node) => node.id === edge.to)
		), true);

	// Un lote sin linaje se ve a sí mismo y nada más.
	check('un lote solo no arrastra a nadie', focusLineage(graph, 5).nodes.length, 0);
}

console.log('\nSecciones de un lote');

{
	const { lotSections } = await import('../src/lib/domain/derived.ts');
	const spec = {
		rawMaterial: 'CPS' as const,
		selectionStages: ['VERDE', 'TOSTADO'] as never,
		roastType: 'Media/Media - City' as never
	};

	// Un lote recién recibido muestra el camino por delante.
	const fresco = lotSections(spec, received());
	check('pergamino muestra trilla', fresco.trilla, true);
	check('y la tostión que le espera', fresco.tostion, true);

	// Un lote que nació tostado hereda la especificación del padre, pero ya no
	// tiene café que tostar: la sección sobra.
	const nacidoTostado = lotSections(
		{ ...spec, rawMaterial: 'AV' as const },
		held({ tostado: 8 })
	);
	check('un lote ya tostado no muestra tostión', nacidoTostado.tostion, false);
	check('ni trilla', nacidoTostado.trilla, false);
	check('pero sí lo que le queda por delante', nacidoTostado.seleccionTostado, true);
	check('y el empaque', nacidoTostado.empaque, true);

	// Lo que se registró se sigue viendo, aunque ya no quede café que lo admita.
	const conHistoria = lotSections(
		{ ...spec, rawMaterial: 'AV' as const },
		held({ tostado: 8 }, { events: ['recepcion', 'tostion'] })
	);
	check('lo ya registrado se sigue mostrando', conHistoria.tostion, true);

	// Los quakers no se vuelven a seleccionar, así que no se ofrece.
	const quaker = lotSections(
		{ ...spec, rawMaterial: 'AV' as const, kind: 'QUAKER' },
		held({ tostado: 1.5 })
	);
	check('un lote de quakers no ofrece selección', quaker.seleccionTostado, false);
}

console.log('\nSeparar un lote que sostiene dos cafés');

{
	const { recordSeleccion } = await import('../src/lib/server/seleccion.ts');
	const { recordMovimiento } = await import('../src/lib/server/movimientos.ts');
	const { lotLedger } = await import('../src/lib/server/ledger.ts');
	const { orders: ordersTable } = await import('../src/lib/server/db/schema.ts');
	const { eq } = await import('drizzle-orm');

	const [order] = await db.select().from(ordersTable).where(eq(ordersTable.code, 'TIE-M0727A'));
	const live = async () =>
		(await db.select().from(lotsTable).where(eq(lotsTable.orderId, order.id)))
			.filter((lot) => !lot.deletedAt);
	const C = (await live()).find((lot) => lot.letter === 'C')!;

	// Vale para cualquier lote con más de un balde: mitad seleccionado, mitad
	// tostado, da igual. Aquí se prueba con la selección a medias.
	await recordSeleccion({ lotId: C.id, totalKilos: 10, netKilos: 9.5, staffId: 1 });
	check('queda a medio seleccionar', lotStatus(C, await lotLedger(C.id)), 'EN PROCESO SELECCION');

	// Separar sin decir qué parte no tiene respuesta, y se niega.
	let refused = false;
	try {
		db.transaction((tx) =>
			recordMovimiento(tx, {
				orderId: order.id, action: 'SEPARAR LOTE', staffId: 1,
				legs: [{ lotId: C.id, kilos: 5 }]
			})
		);
	} catch { refused = true; }
	check('separar sin decir qué parte se niega', refused, true);

	// Dicho cuál, el lote nuevo lee por el café que recibió y no por el estado
	// del padre: AV, no EN PROCESO SELECCION.
	db.transaction((tx) =>
		recordMovimiento(tx, {
			orderId: order.id, action: 'SEPARAR LOTE', staffId: 1,
			legs: [{ lotId: C.id, kilos: 6, selected: false }]
		})
	);
	const born = (await live()).find((lot) => lot.letter === 'D')!;
	check('el lote nuevo lee por lo que recibió', lotStatus(born, await lotLedger(born.id)), 'AV');
	check('descontado de la parte sin seleccionar',
		Number((await lotLedger(C.id)).balances.verde.toFixed(2)), 10.4);

	db.transaction((tx) =>
		recordMovimiento(tx, {
			orderId: order.id, action: 'SEPARAR LOTE', staffId: 1,
			legs: [{ lotId: C.id, kilos: 4, selected: true }]
		})
	);
	const sorted = (await live()).find((lot) => lot.letter === 'E')!;
	check('separar lo seleccionado da un lote seleccionado',
		lotStatus(sorted, await lotLedger(sorted.id)), 'AV SELECCIONADO');
}

console.log('\nMétodo de selección');

{
	const { recordSeleccion, listSelecciones } = await import('../src/lib/server/seleccion.ts');
	const { orders: ordersTable } = await import('../src/lib/server/db/schema.ts');
	const { eq } = await import('drizzle-orm');

	const [order] = await db.select().from(ordersTable).where(eq(ordersTable.code, 'MAH-M0728A'));
	const lotsOf = async () =>
		(await db.select().from(lotsTable).where(eq(lotsTable.orderId, order.id)))
			.filter((lot) => !lot.deletedAt);

	// B llega en almendra y el cliente pidió selección verde: se le pone el
	// método que habría traído desde el formulario del lote.
	const B = (await lotsOf()).find((lot) => lot.letter === 'B')!;
	db.update(lotsTable)
		.set({ selectionMethods: { VERDE: 'Electronica', TOSTADO: 'Manual' } })
		.where(eq(lotsTable.id, B.id))
		.run();

	// Sin decir método, el evento hereda el de su etapa — no el de la otra.
	// Fechas explícitas: la lista viene de la más nueva a la más vieja, y dos
	// registros escritos en el mismo milisegundo no tendrían orden.
	const ayer = new Date(Date.now() - 86_400_000);
	await recordSeleccion({ lotId: B.id, totalKilos: 5, netKilos: 4.8, staffId: 1, date: ayer });
	const heredado = (await listSelecciones({ lotId: B.id }, 'VERDE'))[0];
	check('hereda el método de la etapa', heredado.method, 'Electronica');

	// Dicho en el evento, manda el evento: la máquina puede haberse dañado.
	await recordSeleccion({
		lotId: B.id,
		totalKilos: 5,
		netKilos: 4.9,
		method: 'Manual',
		staffId: 1
	});
	const dicho = (await listSelecciones({ lotId: B.id }, 'VERDE'))[0];
	check('lo dicho en el evento manda', dicho.method, 'Manual');

	// Un lote sin especificación no inventa ninguno.
	const A = (await lotsOf()).find((lot) => lot.letter === 'A')!;
	db.update(lotsTable).set({ selectionMethods: null }).where(eq(lotsTable.id, A.id)).run();
	// A llega en pergamino: se trilla primero para que quede almendra que seleccionar.
	const { recordTrilla } = await import('../src/lib/server/trilla.ts');
	await recordTrilla({ lotId: A.id, parchmentKilos: 20, greenKilos: 16, screens: [], staffId: 1 });
	await recordSeleccion({ lotId: A.id, totalKilos: 10, netKilos: 9.5, staffId: 1 });
	const sinMetodo = (await listSelecciones({ lotId: A.id }, 'VERDE'))[0];
	check('sin especificación no se inventa', sinMetodo.method, null);
}

console.log('\nEl lote de quakers');

{
	const { recordSeleccion } = await import('../src/lib/server/seleccion.ts');
	const { recordTostion } = await import('../src/lib/server/tostion.ts');
	const { lotLedger } = await import('../src/lib/server/ledger.ts');
	const { orders: ordersTable } = await import('../src/lib/server/db/schema.ts');
	const { eq } = await import('drizzle-orm');

	// B de MAH-M0729A llega en almendra, pide selección tostada y guarda quakers.
	// (A la usan bloques anteriores; este necesita un lote intacto.)
	const [order] = await db.select().from(ordersTable).where(eq(ordersTable.code, 'MAH-M0729A'));
	const lotsOf = async () =>
		(await db.select().from(lotsTable).where(eq(lotsTable.orderId, order.id)))
			.filter((lot) => !lot.deletedAt);
	const B = (await lotsOf()).find((lot) => lot.letter === 'B')!;

	await recordTostion({
		lotId: B.id,
		roastType: 'Media Baja - American',
		batchKilos: 12,
		roastedKilos: 10,
		staffId: 1
	});
	await recordSeleccion({
		lotId: B.id,
		totalKilos: 10,
		netKilos: 9,
		removedKilos: 1,
		keepQuaker: true,
		staffId: 1
	});

	// Nace con su propio pliego, no con el del lote del que salió.
	const quaker = (await lotsOf()).find((lot) => lot.kind === 'QUAKER')!;
	check('nace sin selección pendiente', quaker.selectionStages, ['NINGUNO']);
	check('ni método que aplicar', quaker.selectionMethods, null);
	check('ni quakers que guardar', quaker.addQuaker, false);
	// Y el paso siguiente cae solo, sin preguntar por la clase del lote.
	check('su paso siguiente es empaque',
		nextStep(quaker as never, { hasReferences: true, ledger: await lotLedger(quaker.id) }),
		'MOLIENDA/EMPAQUE');
}

// Los bloques de arriba escriben en la base: crean lotes, los deshacen y dejan
// el rastro que el registro exige. Sembrar de nuevo deja el archivo como estaba,
// para que dos corridas seguidas den el mismo resultado.
const { seed } = await import('../src/lib/server/db/seed.ts');
seed();

console.log(failures === 0 ? '\nTodo correcto.\n' : `\n${failures} fallas.\n`);
process.exit(failures === 0 ? 0 : 1);
