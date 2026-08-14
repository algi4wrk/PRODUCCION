import { chromium } from 'playwright';

const browser = await chromium.launch();
// An explicit context so the cross-window test can open a second page in the
// same browser — which is the real setup, one computer driving both screens.
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let fail = 0;
const check = (label, ok, extra='') => { if (!ok) fail++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok?'':' — '+extra}`); };

// La creación de órdenes es un modal sobre la cola, no una página aparte.
await page.goto('http://localhost:5177/ordenes', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '+ Nueva orden' }).click();
await page.getByRole('dialog', { name: 'Nueva orden' }).waitFor({ state: 'visible', timeout: 5000 });

// 1. Materia prima modal opens, and quickly.
const t0 = Date.now();
await page.getByRole('button', { name: '+ Nuevo' }).first().click();
await page.getByRole('dialog', { name: /Materia prima/ }).waitFor({ state: 'visible', timeout: 5000 });
const openMs = Date.now() - t0;
check(`modal materia prima abre (${openMs} ms)`, openMs < 1500, `tardó ${openMs} ms`);

// 2. Variedad combobox: list is positioned inside the dialog, not floating away.
await page.locator('#lot-draft-variety').click();
await page.locator('#lot-draft-variety-lista').waitFor({ state: 'visible', timeout: 3000 });
const input = await page.locator('#lot-draft-variety').boundingBox();
const list  = await page.locator('#lot-draft-variety-lista').boundingBox();
const aligned = Math.abs(list.x - input.x) < 4 && list.y > input.y && (list.y - (input.y + input.height)) < 20;
check('lista de variedad aparece pegada al campo', aligned, `input ${JSON.stringify(input)} lista ${JSON.stringify(list)}`);

await page.getByRole('option', { name: 'Castillo', exact: true }).click();
check('elegir variedad la asigna', await page.locator('#lot-draft-variety').inputValue() === 'Castillo');

await page.locator('#lot-draft-variety').fill('Pink Bourbon');
check('variedad nueva se marca como nueva', await page.getByText('Se agregará como variedad nueva.').isVisible());

// 3. Finca modal opens on top of the lot modal.
await page.locator('#lot-draft-farmId').click();
await page.getByRole('button', { name: '+ Nueva finca' }).click();
await page.getByRole('dialog', { name: 'Nueva finca' }).waitFor({ state: 'visible', timeout: 3000 });
check('modal finca abre encima del de lote', true);
check('modal de lote sigue abierto detrás', await page.getByRole('dialog', { name: /Materia prima/ }).isVisible());

// 4. Escape closes only the topmost modal.
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Escape cierra finca', !(await page.getByRole('dialog', { name: 'Nueva finca' }).isVisible()));
check('Escape NO cierra materia prima', await page.getByRole('dialog', { name: /Materia prima/ }).isVisible());

// 5. Creating a finca selects it into the open lot row.
await page.locator('#lot-draft-farmId').click();
await page.getByRole('button', { name: '+ Nueva finca' }).click();
await page.getByRole('dialog', { name: 'Nueva finca' }).waitFor({ state: 'visible' });
await page.locator('#farm-name').fill('Finca Prueba UI');
await page.getByRole('button', { name: 'Crear finca' }).click();
await page.getByRole('dialog', { name: 'Nueva finca' }).waitFor({ state: 'hidden', timeout: 5000 });
await page.waitForTimeout(400);
const selected = await page.locator('#lot-draft-farmId').inputValue();
check('la finca nueva queda seleccionada en el lote', (selected||'').includes('Finca Prueba UI'), `quedó "${selected}"`);
check('el lote en curso sobrevive', await page.locator('#lot-draft-variety').inputValue() === 'Pink Bourbon');

// 6. The materia prima modal can be closed.
await page.getByRole('button', { name: 'Cancelar' }).first().click();
await page.waitForTimeout(300);
check('Cancelar cierra materia prima', !(await page.getByRole('dialog', { name: /Materia prima/ }).isVisible()));

await page.getByRole('button', { name: '+ Nuevo' }).first().click();
await page.getByRole('dialog', { name: /Materia prima/ }).waitFor({ state: 'visible' });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Escape cierra materia prima', !(await page.getByRole('dialog', { name: /Materia prima/ }).isVisible()));


// ── Exclusividad en enumlist ──────────────────────────────────────────────
await page.getByRole('button', { name: '+ Nuevo' }).first().click();
await page.getByRole('dialog', { name: /Materia prima/ }).waitFor({ state: 'visible' });
const dlg = page.getByRole('dialog', { name: /Materia prima/ });
const on = async (name) => await dlg.getByRole('button', { name, exact: true }).getAttribute('aria-pressed') === 'true';

// Build up a normal multi-selection.
await dlg.getByRole('button', { name: 'Verde', exact: true }).click();
await dlg.getByRole('button', { name: 'Tostado', exact: true }).click();
check('Verde + Tostado se pueden combinar', await on('Verde') && await on('Tostado'));

// NINGUNO must wipe the rest.
await dlg.getByRole('button', { name: 'Ninguno', exact: true }).click();
check('Ninguno queda seleccionado', await on('Ninguno'));
check('Ninguno borra Verde', !(await on('Verde')));
check('Ninguno borra Tostado', !(await on('Tostado')));

// And any other choice must clear NINGUNO.
await dlg.getByRole('button', { name: 'Verde', exact: true }).click();
check('elegir Verde borra Ninguno', !(await on('Ninguno')) && await on('Verde'));

// Same rule on mallas (materia prima defaults to CPS, so the field is showing).
await dlg.getByRole('button', { name: '14', exact: true }).click();
await dlg.getByRole('button', { name: '15/16', exact: true }).click();
check('mallas 14 + 15/16 se combinan', await on('14') && await on('15/16'));
await dlg.getByRole('button', { name: 'Ninguna', exact: true }).click();
check('Ninguna borra las demás mallas', await on('Ninguna') && !(await on('14')) && !(await on('15/16')));


// ── Decimales con coma ────────────────────────────────────────────────────
// Colombia escribe decimales con coma. Un input type="number" descarta la coma
// en silencio: "10,4" se guardaba como 104.
// El bloque anterior deja el modal abierto; se reutiliza tal cual.
const peso = page.locator('#lot-draft-initialWeight');
for (const [typed, expected] of [['10,4','10,4'], ['10.4','10,4'], ['1.234,5','1.234,5'], ['46','46']]) {
  await peso.fill('');
  await peso.pressSequentially(typed, { delay: 5 });
  await page.locator('#lot-draft-humidity').click();
  const shown = await peso.inputValue();
  check(`decimal "${typed}" -> "${shown}"`, shown === expected, `esperaba "${expected}"`);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// ── Columnas calculadas en vivo ───────────────────────────────────────────
// Portan PESO KILO, ESTIMADO (kg) y ESTIMADO TRILLA, que en el libro original
// eran columnas con App formula y Show? = true.
await page.goto('http://localhost:5177/ordenes', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '+ Nueva orden' }).click();
await page.getByRole('dialog', { name: 'Nueva orden' }).waitFor({ state: 'visible', timeout: 5000 });
await page.getByRole('button', { name: '+ Nuevo' }).first().click();
const lot = page.getByRole('dialog', { name: /Materia prima/ });
await lot.waitFor({ state: 'visible' });

const shown = async (label) => {
  const t = await lot.innerText();
  const m = t.match(new RegExp(label + '\\s*\\n+\\s*([^\\n]+)'));
  return m ? m[1].trim() : null;
};

// Beneficio first, then weight — estimates should track both.
await lot.getByRole('radio', { name: 'Honey', exact: true }).click();
await page.locator('#lot-draft-initialWeight').pressSequentially('46', { delay: 5 });
await page.locator('#lot-draft-humidity').click();
await page.waitForTimeout(250);
check('CPS honey 46 kg -> trilla 35,65 kg', await shown('Estimado tras trilla') === '35,65 kg', await shown('Estimado tras trilla'));
check('honey anota merma 22,5 %', (await lot.innerText()).includes('merma 22,5 %'));
check('tostión anota merma 20 %', (await lot.innerText()).includes('merma 20 %'));
check('CPS honey 46 kg -> tostado 28,52 kg', await shown('Estimado tostado') === '28,52 kg', await shown('Estimado tostado'));

// Change beneficio: the estimate must follow.
await lot.getByRole('radio', { name: 'Natural', exact: true }).click();
await page.waitForTimeout(250);
check('cambiar a Natural -> trilla 32,20 kg', await shown('Estimado tras trilla') === '32,20 kg', await shown('Estimado tras trilla'));
check('natural anota merma 30 %', (await lot.innerText()).includes('merma 30 %'));

// Switch to AV: trilla estimate must disappear (Show? = CPS only).
await lot.getByRole('radio', { name: 'AV', exact: true }).click();
await page.waitForTimeout(250);
check('AV oculta el estimado de trilla', await shown('Estimado tras trilla') === null);
check('AV -> tostado 36,80 kg', await shown('Estimado tostado') === '36,80 kg', await shown('Estimado tostado'));

// Finish the lot so the reference form has a budget.
await lot.getByRole('radio', { name: 'CPS', exact: true }).click();
await lot.getByRole('radio', { name: 'Honey', exact: true }).click();
await page.locator('#lot-draft-variety').click();
await page.getByRole('option', { name: 'Castillo', exact: true }).click();
await page.locator('#lot-draft-farmId').click();
await page.getByRole('option', { name: /Los angeles/ }).click();
await page.locator('#lot-draft-humidity').fill('10,4');
await lot.getByRole('button', { name: 'Ninguno', exact: true }).click();
await lot.getByRole('button', { name: 'Ninguna', exact: true }).click();
await lot.getByRole('button', { name: 'Agregar' }).click();
await lot.waitFor({ state: 'hidden' });

await page.getByRole('button', { name: '+ Nuevo' }).nth(1).click();
const ref = page.getByRole('dialog', { name: /Tipos de empaque/ });
await ref.waitFor({ state: 'visible' });
const refShown = async (label) => {
  const t = await ref.innerText();
  const m = t.match(new RegExp(label + '\\s*\\n+\\s*([^\\n]+)'));
  return m ? m[1].trim() : null;
};

await page.locator('#ref-draft-grams').click();
await page.getByRole('option', { name: '500', exact: true }).click();
await page.locator('#ref-draft-quantity').pressSequentially('40', { delay: 5 });
await page.locator('#ref-draft-grind').click().catch(() => {});
await page.waitForTimeout(300);
check('40 × 500 g -> 20,00 kg', await refShown('Peso de esta línea') === '20,00 kg', await refShown('Peso de esta línea'));
check('disponible tras la línea = 8,52 kg', await refShown('Disponible después') === '8,52 kg', await refShown('Disponible después'));

// Overshoot: the remaining figure must go negative and red.
await page.locator('#ref-draft-quantity').fill('80');
await page.waitForTimeout(300);
check('80 × 500 g -> 40,00 kg', await refShown('Peso de esta línea') === '40,00 kg', await refShown('Peso de esta línea'));
check('disponible se vuelve negativo', (await refShown('Disponible después') || '').startsWith('-'), await refShown('Disponible después'));


// ── Pantalla completa del tablero ─────────────────────────────────────────
await page.goto('http://localhost:5177/lotes', { waitUntil: 'networkidle' });
check('el botón aparece', await page.getByRole('button', { name: /Pantalla completa/ }).isVisible());
check('la navegación se ve al inicio', await page.locator('[data-app-nav]').isVisible());

await page.getByRole('button', { name: /Pantalla completa/ }).click();
await page.waitForTimeout(400);
const isFs = await page.evaluate(() => !!document.fullscreenElement);
check('entra en pantalla completa', isFs);
check('la navegación se oculta', !(await page.locator('[data-app-nav]').isVisible()));
check('el botón cambia a Salir', await page.getByRole('button', { name: /Salir/ }).isVisible());

await page.getByRole('button', { name: /Salir/ }).click();
await page.waitForTimeout(400);
check('sale de pantalla completa', !(await page.evaluate(() => !!document.fullscreenElement)));
check('la navegación vuelve', await page.locator('[data-app-nav]').isVisible());


// ── El tablero reacciona a otra ventana ───────────────────────────────────
// Un solo computador: el monitor es una salida HDMI, así que el tablero y el
// formulario son dos ventanas del mismo navegador y se avisan por BroadcastChannel.
const wall = await ctx.newPage();
await wall.goto('http://localhost:5177/lotes', { waitUntil: 'networkidle' });
const rows = () => wall.locator('tbody tr:not(:has(td[colspan]))').count();
const before = await rows();
console.log(`  pared: ${before} lotes`);

const desk = await ctx.newPage();
await desk.goto('http://localhost:5177/ordenes/1', { waitUntil: 'networkidle' });

const tPause = Date.now();
await desk.getByRole('button', { name: 'Pausar', exact: true }).click();

// Poll the wall frequently; if the broadcast works this lands in well under a
// second, far inside the 15 s fallback timer.
let after = before;
while (Date.now() - tPause < 5000) {
  after = await rows();
  if (after !== before) break;
  await wall.waitForTimeout(100);
}
const elapsed = Date.now() - tPause;
console.log(`  pared: ${after} lotes tras ${elapsed} ms`);
check('la pared reaccionó', after === before - 3, `antes ${before}, después ${after}`);
check('reaccionó sin esperar el temporizador de 15 s', elapsed < 5000, `${elapsed} ms`);

// And back: resuming from HISTORIAL should return it to the board.
const hist = await ctx.newPage();
await hist.goto('http://localhost:5177/historial?estado=PAUSADA', { waitUntil: 'networkidle' });
const tResume = Date.now();
// MAH-M0728A is seeded paused too, so target the row we actually paused.
await hist.locator('tr', { hasText: 'TIE-M0727A' }).getByRole('button', { name: 'Reanudar' }).click();
// Wait for the count to settle rather than breaking on the first change: the
// rows re-render progressively and an early read catches a partial table.
let back = after, stable = 0, last = -1;
while (Date.now() - tResume < 5000) {
  back = await rows();
  stable = back === last ? stable + 1 : 0;
  last = back;
  if (back !== after && stable >= 3) break;
  await wall.waitForTimeout(100);
}
console.log(`  pared: ${back} lotes tras reanudar (${Date.now() - tResume} ms)`);
check('reanudar devuelve los lotes a la pared', back === before, `esperaba ${before}, obtuvo ${back}`);


// ── Filas de orden clicables ──────────────────────────────────────────────
// Enlace estirado, no un onclick en el <tr>: sigue siendo un enlace real para
// el teclado. El botón Reanudar se eleva por encima para no quedar tapado.
// Row click works in HISTORIAL too.
await page.goto('http://localhost:5177/ordenes', { waitUntil: 'networkidle' });
const row = page.locator('tbody tr').first();
const code = (await row.locator('td').nth(1).innerText()).trim().split('\n')[0];

// Click by coordinates: the stretched link covers the cell, so a normal
// locator click is refused as "intercepted" — which is itself the proof.
const clientCell = await row.locator('td').nth(2).boundingBox();
await page.mouse.click(clientCell.x + clientCell.width / 2, clientCell.y + clientCell.height / 2);
await page.waitForURL(/\/ordenes\/[A-Z]{3}-M\d{4}[A-Z]$/, { timeout: 4000 }).catch(() => {});
check('clic en la celda de cliente abre la orden', /\/ordenes\/[A-Z]{3}-M\d{4}[A-Z]$/.test(page.url()), page.url());
check('abre la orden correcta', (await page.locator('h1').innerText()).includes(code), code);

// And the far-right status cell.
await page.goto('http://localhost:5177/ordenes', { waitUntil: 'networkidle' });
const statusCell = await page.locator('tbody tr').first().locator('td').last().boundingBox();
await page.mouse.click(statusCell.x + statusCell.width / 2, statusCell.y + statusCell.height / 2);
await page.waitForURL(/\/ordenes\/[A-Z]{3}-M\d{4}[A-Z]$/, { timeout: 4000 }).catch(() => {});
check('clic en la celda de estado también abre', /\/ordenes\/[A-Z]{3}-M\d{4}[A-Z]$/.test(page.url()), page.url());

// Keyboard still works: the link is a real link.
await page.goto('http://localhost:5177/ordenes', { waitUntil: 'networkidle' });
const links = await page.locator('tbody a[href^="/ordenes/"]').count();
check('sigue habiendo enlaces reales para el teclado', links > 0, String(links));


await page.goto('http://localhost:5177/historial', { waitUntil: 'networkidle' });
const cell = await page.locator('tbody tr').first().locator('td').nth(1).boundingBox();
await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height / 2);
await page.waitForURL(/\/ordenes\/[A-Z]{3}-M\d{4}[A-Z]$/, { timeout: 4000 }).catch(() => {});
check('la fila del historial abre la orden', /\/ordenes\/[A-Z]{3}-M\d{4}[A-Z]$/.test(page.url()), page.url());

// The Reanudar button must still be reachable, not swallowed by the overlay.
await page.goto('http://localhost:5177/historial?estado=PAUSADA', { waitUntil: 'networkidle' });
const paused = await page.locator('tbody tr').count();
await page.getByRole('button', { name: 'Reanudar' }).first().click();
await page.waitForTimeout(800);
check('sigue en el historial, no navegó', page.url().includes('/historial'), page.url());
check('reanudar funcionó', (await page.locator('tbody tr').count()) === paused - 1);


// ── Notas, editar y eliminar en el detalle ────────────────────────────────
// Order 1 has notes; order 6 has none.

await page.goto('http://localhost:5177/ordenes/1', { waitUntil: 'networkidle' });
check('las notas se muestran', await page.getByText('Notas', { exact: true }).isVisible());

await page.goto('http://localhost:5177/ordenes/6', { waitUntil: 'networkidle' });
check('sin notas, el bloque se oculta', !(await page.getByText('Notas', { exact: true }).isVisible()));

// Editar + Eliminar both live on the detail page only.
await page.goto('http://localhost:5177/ordenes/1', { waitUntil: 'networkidle' });
check('botón Editar en el detalle', await page.getByRole('button', { name: 'Editar' }).isVisible());
check('botón Eliminar en el detalle', await page.getByRole('button', { name: 'Eliminar' }).isVisible());
await page.goto('http://localhost:5177/ordenes', { waitUntil: 'networkidle' });
check('Editar no está en la lista', !(await page.getByRole('button', { name: 'Editar' }).isVisible()));

// Edit round trip.
await page.goto('http://localhost:5177/ordenes/1', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Editar' }).click();
const editDlg = page.getByRole('dialog', { name: 'Editar orden' });
await editDlg.waitFor({ state: 'visible' });
await page.locator('#edit-notes').fill('Nota corregida desde la prueba');
await editDlg.getByRole('radio', { name: 'Sí', exact: true }).click();   // peel stick
await editDlg.getByRole('button', { name: 'Guardar cambios' }).click();
await editDlg.waitFor({ state: 'hidden', timeout: 5000 });
await page.waitForTimeout(400);
check('la nota nueva aparece', (await page.locator('body').innerText()).includes('Nota corregida desde la prueba'));
check('peel stick quedó en sí', /peel stick\s*\n?\s*Sí/i.test(await page.locator('body').innerText()));
check('el código no cambió', (await page.locator('h1').innerText()).includes('TIE-M0727A'));

// ---------------------------------------------------------------------------
// Movimientos: el combo parcial de varios lotes, que es justo lo que la app
// original no podía expresar.
// ---------------------------------------------------------------------------
console.log('\nMovimientos');

await page.goto('http://localhost:5177/ordenes/1', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Movimiento', exact: true }).click();

const movDlg = page.locator('dialog[open], [role="dialog"]').last();
await movDlg.waitFor({ state: 'visible', timeout: 5000 });
check('el formulario de movimiento abre', await movDlg.isVisible());

// Combinar: el formulario abre en TRANSFERIR, que es lo menos que se puede
// suponer, así que la acción se elige explícitamente. Combinar ya trae dos
// renglones de origen, porque un lote combinado con nada no es una combinación.
await movDlg.getByRole('radio', { name: 'COMBINAR LOTE' }).click();
await page.waitForTimeout(200);
const legRows = movDlg.locator('input[inputmode="decimal"]');
check('dos renglones de origen', await legRows.count() === 2);

// Los selectores de referencia son de sólo lectura a propósito: se elige de la
// lista, no se escribe.
async function pick(id, text) {
  await movDlg.locator('#' + id).click();
  await page.waitForTimeout(150);
  await page.getByRole('option', { name: new RegExp(text) }).first().click();
}

// Los dos orígenes son almendra: un combo mezcla café del mismo tipo, y el
// formulario filtra la lista al estado del primero que se elija — pergamino y
// almendra no se combinan.
// Elegir un lote trae su peso completo; bajarlo es lo que hace el combo parcial.
await pick('mov-leg-0', 'C - Castillo');
await legRows.nth(0).fill('10');
await pick('mov-leg-1', 'B - Castillo');
await legRows.nth(1).fill('1');

// Responsable, que es obligatorio.
await movDlg.locator('#mov-staffId').click();
await page.waitForTimeout(150);
await page.getByRole('option').first().click();
await page.waitForTimeout(200);

check('el total se suma solo', (await movDlg.innerText()).includes('11,00 kg'));

await movDlg.getByRole('button', { name: 'Registrar' }).click();
await movDlg.waitFor({ state: 'hidden', timeout: 5000 });
await page.waitForTimeout(500);

const orderText = await page.locator('body').innerText();
check('el lote nuevo aparece en la orden', /D - Castillo/.test(orderText));

// Y en la pared, con sus dos padres.
await page.goto('http://localhost:5177/lotes', { waitUntil: 'networkidle' });
const boardText = await page.locator('body').innerText();
check('la pared muestra el lote nuevo', /D - Castillo/.test(boardText));
check('el lote nuevo lista sus dos orígenes', /C, B|B, C/.test(boardText));
// El origen entregó 10 kg: su saldo baja a 16,40, pero PESO INICIAL sigue
// siendo 26,40 — es un hecho de recepción y no cambia nunca.
check('el saldo del origen bajó', /16,40/.test(boardText));
check('el peso inicial del origen no cambió', /26,40/.test(boardText));
check('sin merma por mover café', !/-\d/.test(boardText));

console.log(errors.length ? '\nErrores de consola:\n' + errors.slice(0,5).join('\n') : '\nSin errores de consola.');
console.log(fail === 0 ? 'Todo correcto.\n' : `${fail} fallas.\n`);
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
