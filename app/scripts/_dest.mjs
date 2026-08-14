import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:5173/ordenes/1', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: 'Movimiento' }).click();
const dlg = p.getByRole('dialog', { name: /registrar movimiento/i });
await dlg.waitFor({ state: 'visible' });

const has = async () => (await dlg.locator('#mov-destinationLotId').count()) > 0;
console.log('acción por defecto:', await dlg.locator('#mov-action').inputValue());
console.log('lote destino visible:', await has());

await dlg.locator('#mov-action').click();
await p.waitForTimeout(150);
await p.getByRole('option', { name: /TRANSFERIR PESO/ }).click();
await p.waitForTimeout(250);
console.log('tras elegir TRANSFERIR:', await has());

await dlg.locator('#mov-action').click();
await p.waitForTimeout(150);
await p.getByRole('option', { name: /SEPARAR LOTE/ }).click();
await p.waitForTimeout(250);
console.log('tras elegir SEPARAR:', await has());
console.log('errores:', errs.length ? errs[0] : 'ninguno');
await b.close();
