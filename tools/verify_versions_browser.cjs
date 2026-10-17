/* Versiones (Git) en un navegador real contra la instancia AISLADA de tools/versions_fixture.py.
   Muta solo los proyectos de prueba del contenedor desechable. Nunca usar contra producción. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/home/dv1/.npm/_npx/fd3bca3c548369c0/node_modules/playwright-core');
const crypto = require('node:crypto');
const fs = require('node:fs');
const base = process.env.CM_TEST_URL || 'https://127.0.0.1:13017';
if (!/^https:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error('Solo contra la instancia local aislada');
const out = process.env.CM_ARTIFACTS || 'artifacts/versions-20261017';
const assert = (ok, message) => { if (!ok) throw new Error(message); };
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = crypto.createHmac('sha1', key).update(counter).digest(), offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
const json = (page, url, body) => page.evaluate(async ([url, body]) => {
  const response = await fetch(url, body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {});
  return {status: response.status, data: await response.json().catch(() => ({}))};
}, [url, body]);
const subjects = page => page.locator('.ver-timeline .ver-main b').allInnerTexts();
async function noOverflow(page, label) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(wide <= 1, `${label}: desbordamiento horizontal de ${wide}px`);
}
async function confirmSheet(page, title, button) {
  const sheet = page.locator('.sheet').filter({has: page.getByRole('heading', {name: title})});
  await sheet.waitFor();
  await sheet.getByRole('button', {name: button, exact: true}).click();
  await sheet.waitFor({state: 'detached', timeout: 30000});
}

(async () => {
  fs.mkdirSync(out, {recursive: true});
  const browser = await chromium.launch({headless: true, args: ['--ignore-certificate-errors']});
  const errors = [];
  try {
    const first = await browser.newContext({viewport: {width: 390, height: 844}, ignoreHTTPSErrors: true, serviceWorkers: 'block', locale: 'es-MX'});
    let page = await first.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(base);
    const login = await json(page, '/api/login', {user: 'tester', password: 'unit-password'});
    assert(login.status === 200 && login.data.setup_required, `login: ${JSON.stringify(login)}`);
    const setup = await json(page, '/api/security/setup', {});
    const confirm = await json(page, '/api/security/confirm', {code: totp(setup.data.secret), remember: true});
    assert(confirm.status === 200, 'alta TOTP de la instancia de prueba');
    const storageState = await first.storageState();

    console.log('390px: historial sembrado');
    await page.goto(`${base}/p/demo?tab=git`);
    await page.locator('.ver-timeline').waitFor();
    let list = await subjects(page);
    assert(list[0].startsWith('Subir 2 archivo'), `orden del historial: ${list}`);
    assert(list.includes('Claude: Añade el menú y el modo oscuro') && list.includes('Versión inicial del proyecto'), 'faltan versiones sembradas');
    assert(!list.includes('Claude: Prueba una paleta azul'), 'la rama alternativa no debe mezclarse en main');
    const production = page.locator('.ver-timeline li').filter({hasText: 'Editar index.html'});
    assert(await production.locator('.ver-badge.live').count() === 1, 'falta «En producción» en la versión desplegada');
    assert(await page.locator('.ver-timeline li.current').count() === 1, 'debe marcarse una versión actual');
    assert((await page.locator('.ver-tabs').innerText()).includes('Cambios'), 'pestaña de cambios');
    assert(await page.locator('.ver-tabs .count').innerText() === '1', 'notas.txt pendiente');
    assert((await page.locator('.ver-undo').innerText()).includes('Deshacer cambios sin guardar'), 'deshacer debe ofrecer quitar lo no guardado');
    await noOverflow(page, 'historial 390');
    await page.screenshot({path: `${out}/history-390.png`, fullPage: true});

    console.log('Deshacer cambios sin guardar y luego el último cambio');
    await page.locator('.ver-undo').click();
    await confirmSheet(page, 'Deshacer los cambios sin guardar', 'Deshacer');
    await page.waitForFunction(() => document.querySelector('.ver-timeline .ver-main b')?.textContent === 'Deshacer cambios sin guardar');
    assert((await json(page, '/api/files/read?project=demo&path=notas.txt')).status === 404, 'notas.txt debería haberse retirado');
    list = await subjects(page);
    assert(list[1] === 'Cambios pendientes antes de: deshacer el último cambio', `lo no guardado queda en el historial: ${list.slice(0, 3)}`);
    await page.locator('.ver-undo').click();
    await confirmSheet(page, 'Deshacer el último cambio', 'Deshacer');
    await page.waitForFunction(() => document.querySelector('.ver-timeline .ver-main b')?.textContent.startsWith('Deshacer «Subir'));
    assert((await json(page, '/api/files/read?project=demo&path=logo.png')).status === 404, 'logo.png debería haberse deshecho');
    assert((await page.locator('.ver-undo small').innerText()).includes('Codex: Corrige el diseño'), 'el siguiente deshacer retrocede otra versión');

    console.log('Detalle, comparar y restaurar una versión antigua');
    await page.locator('.ver-timeline li').filter({hasText: 'Claude: Añade el menú'}).first().click();
    const detail = page.locator('.sheet .ver-detail');
    await detail.waitFor();
    assert((await detail.innerText()).includes('menu.js'), 'el detalle lista archivos cambiados');
    await page.screenshot({path: `${out}/detail-390.png`});
    await detail.getByRole('button', {name: 'Comparar con la actual'}).click();
    await page.locator('.diff-view').waitFor();
    assert((await page.locator('.diff-view').innerText()).includes('-<p>Hola desde el editor</p>'), 'comparar muestra lo que se perdería');
    await page.getByRole('button', {name: 'Volver', exact: true}).click();
    await page.locator('.sheet .ver-detail').getByRole('button', {name: 'Restaurar esta versión'}).click();
    await confirmSheet(page, 'Restaurar esta versión', 'Restaurar');
    await page.waitForFunction(() => document.querySelector('.ver-timeline .ver-main b')?.textContent.startsWith('Restaurar versión'));
    const index = await json(page, '/api/files/read?project=demo&path=index.html');
    assert(index.data.content === '<h1>Demo</h1>\n', 'index.html vuelve a la versión elegida');
    assert((await json(page, '/api/files/read?project=demo&path=menu.js')).status === 200, 'menu.js existe en la versión restaurada');

    console.log('Ramas: ver alternativa, crear, cambiar e integrar');
    await page.locator('.ver-tabs').getByRole('tab', {name: 'Ramas'}).click();
    await page.locator('.ver-branch').first().waitFor();
    const azul = page.locator('.ver-branch').filter({hasText: 'alternativa-azul'});
    assert((await azul.innerText()).includes('1 versión(es) propia(s) · no tiene'), 'conteo de versiones de la alternativa');
    await noOverflow(page, 'ramas 390');
    await page.screenshot({path: `${out}/branches-390.png`, fullPage: true});
    await azul.getByRole('button', {name: 'Historial'}).click();
    await page.locator('.ver-viewing').waitFor();
    assert(await page.locator('.ver-badge.alt').count() === 1, 'la alternativa marca su versión exclusiva');
    await page.getByRole('button', {name: 'Volver a la actual'}).click();
    await page.locator('.ver-tabs').getByRole('tab', {name: 'Ramas'}).click();
    await page.getByLabel('Nombre de la nueva rama').fill('Diseño oscuro');
    await page.getByRole('button', {name: 'Crear', exact: true}).click();
    await confirmSheet(page, 'Nueva rama', 'Crear y cambiar');
    await page.waitForFunction(() => document.querySelector('.ver-branch-chip b')?.textContent === 'diseno-oscuro');
    await page.locator('.ver-branch').filter({hasText: 'main'}).getByRole('button', {name: 'Cambiar a esta'}).click();
    await confirmSheet(page, 'Cambiar a main', 'Cambiar');
    await page.waitForFunction(() => document.querySelector('.ver-branch-chip b')?.textContent === 'main');
    await page.locator('.ver-tabs').getByRole('tab', {name: 'Ramas'}).click();
    await page.locator('.ver-branch').filter({hasText: 'alternativa-azul'}).getByRole('button', {name: 'Integrar'}).click();
    await confirmSheet(page, 'Integrar alternativa-azul en main', 'Integrar');
    await page.locator('.ver-tabs').getByRole('tab', {name: 'Historial'}).click();
    await page.waitForFunction(() => document.querySelector('.ver-timeline .ver-main b')?.textContent === 'Integrar la rama alternativa-azul en main');
    assert((await json(page, '/api/files/read?project=demo&path=style.css')).data.content.includes('#0b3d91'), 'la integración trae la paleta azul');

    console.log('Guardar a mano y versión de una respuesta del agente');
    await page.locator('.ver-tabs').getByRole('tab', {name: 'Cambios'}).click();
    assert((await page.locator('.versions').innerText()).includes('Todo guardado'), 'sin cambios pendientes');
    await page.goto(`${base}/p/demo?tab=agent`);
    const chip = page.locator('.run-version');
    await chip.waitFor();
    assert((await chip.innerText()).includes('guardada'), 'chip de versión en la respuesta');
    await chip.getByRole('button', {name: 'Ver'}).click();
    await page.locator('.sheet .ver-detail').waitFor();
    assert((await page.locator('.sheet .ver-detail').innerText()).includes('Claude: Añade el menú y el modo oscuro'), 'Ver abre esa versión');
    await page.keyboard.press('Escape');
    await page.goto(`${base}/p/demo?tab=agent`);
    await page.locator('.run-version').getByRole('button', {name: 'Deshacer estos cambios'}).click();
    await page.locator('.sheet').getByRole('button', {name: 'Deshacer', exact: true}).click();
    await page.locator('.toast').filter({hasText: /Revertidos|choca|ya no están/}).first().waitFor({timeout: 30000});
    await page.screenshot({path: `${out}/agent-version-390.png`});

    console.log('Proyecto sin versiones: activarlas');
    await page.goto(`${base}/p/nuevo?tab=git`);
    await page.getByRole('button', {name: 'Activar versiones'}).click();
    await page.locator('.ver-timeline').waitFor();
    assert((await subjects(page))[0] === 'Versión inicial del proyecto', 'primera versión creada');
    await first.close();

    for (const width of [360, 768, 1440]) {
      console.log(`Revisión visual ${width}px`);
      const context = await browser.newContext({viewport: {width, height: 900}, ignoreHTTPSErrors: true, serviceWorkers: 'block', storageState});
      page = await context.newPage();
      page.on('pageerror', error => errors.push(String(error)));
      await page.goto(`${base}/p/demo?tab=git`);
      await page.locator('.ver-timeline').waitFor();
      await noOverflow(page, `historial ${width}`);
      await page.screenshot({path: `${out}/history-${width}.png`, fullPage: width < 1000});
      await page.locator('.ver-tabs').getByRole('tab', {name: 'Ramas'}).click();
      await page.locator('.ver-branch').first().waitFor();
      await noOverflow(page, `ramas ${width}`);
      await page.locator('.ver-tabs').getByRole('tab', {name: 'Historial'}).click();
      await page.locator('.ver-timeline li').nth(1).click();
      await page.locator('.sheet .ver-detail').waitFor();
      await noOverflow(page, `detalle ${width}`);
      await page.screenshot({path: `${out}/detail-${width}.png`});
      await context.close();
    }
    assert(!errors.length, `errores de JavaScript: ${errors.join(' | ')}`);
    console.log('VERSIONS_BROWSER_OK');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
