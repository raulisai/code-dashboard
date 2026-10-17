/* Alta, login TOTP, recuperación y revocación contra una instancia local AISLADA.
   Nunca usar contra producción ni con credenciales reales. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/home/dv1/.npm/_npx/fd3bca3c548369c0/node_modules/playwright-core');
const crypto = require('node:crypto');
const fs = require('node:fs');
const base = process.env.CM_AUTH_TEST_URL || 'https://127.0.0.1:13007';
if (!/^https:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Esta prueba requiere una instancia local aislada HTTPS.');
const out = process.env.CM_ARTIFACTS || 'artifacts/auth-20261017';
const assert = (ok, message) => {if (!ok) throw new Error(message);};
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = crypto.createHmac('sha1', key).update(counter).digest(), offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
(async () => {
  fs.mkdirSync(out, {recursive: true});
  const browser = await chromium.launch({headless: true, args: ['--ignore-certificate-errors']});
  const errors = [];
  const contexts = [];
  const context = async width => {
    const ctx = await browser.newContext({viewport:{width, height:900}, locale:'es-MX', ignoreHTTPSErrors:true, acceptDownloads:true});
    contexts.push(ctx); ctx.on('page', page => page.on('pageerror', e => errors.push(String(e))));
    return ctx;
  };
  const loginPassword = async (page, remember=false) => {
    await page.goto(base);
    await page.getByLabel('Usuario', {exact:true}).fill('tester');
    await page.getByLabel('Contraseña', {exact:true}).fill('isolated-auth-browser-test');
    if (remember) await page.getByLabel('Recordar este dispositivo durante 180 días').check();
    await page.getByRole('button', {name:'Entrar', exact:true}).click();
  };
  const width = async page => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Desbordamiento horizontal');
  const codesFrom = page => page.locator('.recovery-codes code').allTextContents();
  const saveCodes = async page => {
    await page.getByLabel('He guardado los códigos en un lugar seguro.').check();
    await page.getByRole('button', {name:'Continuar', exact:true}).click();
  };
  try {
    const first = await context(390), page = await first.newPage();
    await loginPassword(page);
    await page.getByRole('heading', {name:'Configura tu autenticador', exact:true}).waitFor();
    assert((await first.request.get(base+'/api/state')).status() === 403, 'La sesión provisional accede a datos');
    await page.getByRole('button', {name:'Generar QR y clave', exact:true}).click();
    const key = await page.getByLabel('Clave de configuración', {exact:true}).inputValue();
    assert(/^[A-Z2-7]{32}$/.test(key), 'Clave TOTP inválida');
    await page.locator('.auth-qr').evaluate(img => img.decode());
    await width(page);
    await page.screenshot({path:out+'/setup-mobile.png', fullPage:true});
    await first.grantPermissions(['clipboard-read','clipboard-write']);
    await page.getByRole('button', {name:'Copiar clave', exact:true}).click();
    assert(await page.evaluate(() => navigator.clipboard.readText()) === key, 'Copiar clave no funciona');
    const bad = totp(key) === '000000' ? '999999' : '000000';
    await page.getByLabel('Código del autenticador', {exact:true}).fill(bad);
    await page.getByRole('button', {name:'Activar autenticador', exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Código incorrecto'}).waitFor();
    const enrolledCounter = Math.floor(Date.now()/30000);
    await page.getByLabel('Código del autenticador', {exact:true}).fill(totp(key));
    await page.getByLabel('Recordar este dispositivo durante 180 días').check();
    await page.getByRole('button', {name:'Activar autenticador', exact:true}).click();
    await page.getByRole('heading', {name:'Guarda tus códigos de recuperación'}).waitFor();
    const initialCodes = await codesFrom(page); assert(initialCodes.length === 10, 'No hay diez códigos');
    assert(await page.getByRole('button', {name:'Continuar', exact:true}).isDisabled(), 'No exige guardar códigos');
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', {name:'Descargar códigos', exact:true}).click();
    const download = await downloading;
    const stream = await download.createReadStream(); let downloaded = '';
    for await (const part of stream) downloaded += part.toString();
    assert(initialCodes.every(code => downloaded.includes(code)), 'Descarga incompleta');
    await saveCodes(page); await page.locator('.dashboard-home').waitFor();
    let cookie = (await first.cookies()).find(c => c.name === '__Host-cm_session');
    assert(cookie && cookie.httpOnly && cookie.secure && cookie.sameSite === 'Strict', 'Cookie sin protección');
    assert(cookie.expires - Date.now()/1000 > 179*86400, 'La sesión no dura 180 días');
    await page.goto(base+'/settings');
    await page.getByRole('heading', {name:'Seguridad y sesiones'}).waitFor();
    await page.getByText('Autenticador activo', {exact:true}).waitFor();
    for (const w of [360,390,1440]) {
      await page.setViewportSize({width:w,height:900}); await width(page);
      await page.screenshot({path:out+`/settings-${w}.png`, fullPage:true});
    }
    // Un navegador nuevo exige contraseña + segundo factor, y el login TOTP es real.
    const second = await context(390), secondPage = await second.newPage();
    await loginPassword(secondPage, true);
    await secondPage.getByLabel('Código del autenticador', {exact:true}).waitFor();
    assert((await second.request.get(base+'/api/me')).status() === 401, 'Contraseña sola da acceso');
    await secondPage.screenshot({path:out+'/login-totp.png', fullPage:true});
    while (Math.floor(Date.now()/30000) <= enrolledCounter) await new Promise(resolve => setTimeout(resolve,500));
    await secondPage.getByLabel('Código del autenticador', {exact:true}).fill(totp(key));
    await secondPage.getByRole('button', {name:'Entrar', exact:true}).click();
    await secondPage.locator('.dashboard-home').waitFor();
    await page.reload();
    await page.getByRole('button', {name:'Cerrar las otras sesiones', exact:true}).click();
    await page.waitForFunction(() => document.querySelectorAll('.auth-device').length === 1);
    assert((await second.request.get(base+'/api/me')).status() === 401, 'El dispositivo revocado sigue conectado');
    // Recuperación con un solo uso y renovación protegida de los códigos.
    await secondPage.reload();
    await loginPassword(secondPage);
    await secondPage.getByRole('button', {name:'He perdido el autenticador', exact:true}).click();
    await secondPage.getByLabel('Código de recuperación', {exact:true}).fill(initialCodes[0]);
    await secondPage.getByRole('button', {name:'Entrar', exact:true}).click();
    await secondPage.locator('.dashboard-home').waitFor();
    const shortCookie=(await second.cookies()).find(c=>c.name==='__Host-cm_session');
    assert(shortCookie.expires === -1, 'Sin recordar se crea una cookie persistente');
    await page.getByRole('button', {name:'Renovar códigos de recuperación', exact:true}).click();
    await page.getByLabel('Contraseña actual', {exact:true}).fill('isolated-auth-browser-test');
    await page.getByLabel('Código actual o de recuperación', {exact:true}).fill(initialCodes[1]);
    await page.getByRole('button', {name:'Generar nuevos códigos', exact:true}).click();
    await page.getByRole('heading', {name:'Guarda tus códigos de recuperación'}).waitFor();
    const renewedCodes = await codesFrom(page); assert(renewedCodes[0] !== initialCodes[0], 'No renovó los códigos');
    await saveCodes(page);
    assert((await second.request.get(base+'/api/me')).status() === 401, 'Renovar códigos no revoca otras sesiones');
    // Sustituir el autenticador exige ambos factores; el nuevo QR se confirma.
    await page.getByRole('button', {name:'Cambiar autenticador', exact:true}).click();
    await page.getByLabel('Contraseña actual', {exact:true}).fill('isolated-auth-browser-test');
    await page.getByLabel('Código actual o de recuperación', {exact:true}).fill(renewedCodes[0]);
    await page.getByRole('button', {name:'Generar QR y clave', exact:true}).click();
    const changedKey=await page.getByLabel('Clave de configuración', {exact:true}).inputValue();
    assert(changedKey !== key, 'El autenticador nuevo usa la clave anterior');
    await page.getByLabel('Código del autenticador', {exact:true}).fill(totp(changedKey));
    await page.getByLabel('Recordar este dispositivo durante 180 días').check();
    await page.getByRole('button', {name:'Activar autenticador', exact:true}).click();
    await page.getByRole('heading', {name:'Guarda tus códigos de recuperación'}).waitFor();
    await saveCodes(page);
    const captured = (await first.cookies()).find(c=>c.name==='__Host-cm_session');
    await page.evaluate(()=>localStorage.setItem('cm-draft-private-check','draft must be removed')); 
    await page.getByRole('button', {name:'Cerrar sesión', exact:true}).click();
    await page.getByRole('button', {name:'Entrar', exact:true}).waitFor();
    assert(await page.evaluate(()=>localStorage.getItem('cm-draft-private-check')) === null, 'El logout conserva borradores privados');
    const replay=await context(390); await replay.addCookies([captured]);
    assert((await replay.request.get(base+'/api/me')).status() === 401, 'La cookie copiada sirve tras salir');
    assert(!errors.length, 'Errores JavaScript: '+errors.join('\n'));
    console.log('AUTH_BROWSER_OK: alta, QR local, clave manual, TOTP, 180 días, cookie temporal, recuperación, cambio de factor, revocación y logout; 360/390/1440 px.');
  } finally {
    await Promise.all(contexts.map(ctx=>ctx.close())); await browser.close();
  }
})().catch(err=>{console.error(err.message);process.exitCode=1;});
