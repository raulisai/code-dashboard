const {completeMfa} = require('./browser_auth.cjs');
/* Ejecutar en la imagen Playwright v1.55.0 con MONITOR_USER/PASSWORD y /pw/playwright. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/pw/playwright');
const fs = require('node:fs');
const baseURL = process.env.CM_TEST_URL || 'https://codex-dashboard.devdj.lat';
const project = 'cm-smoke-20261017';
const artifacts = process.env.CM_ARTIFACTS || '/work/artifacts/validation-20261017';

(async () => {
  fs.mkdirSync(artifacts, {recursive: true});
  const browser = await chromium.launch({headless: true});
  const errors = [];
  try {
    const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
    await page.goto(baseURL);
    await page.getByLabel('Usuario', {exact: true}).fill(process.env.MONITOR_USER);
    await page.getByLabel('Contraseña', {exact: true}).fill(process.env.MONITOR_PASSWORD);
    await page.getByRole('button', {name: 'Entrar'}).click();
    await page.locator('.shell').waitFor();
    await page.screenshot({path: `${artifacts}/mobile-home.png`, fullPage: true});
    const verifyWidth = async label => {
      const dims = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth}));
      if (dims.scroll > dims.width + 1) throw new Error(`Desbordamiento en ${label}: ${JSON.stringify(dims)}`);
    };
    for (const route of ['/new', '/queue', '/server', '/settings']) {
      await page.goto(baseURL + route);
      await page.locator('.shell').waitFor(); await verifyWidth(route);
    }
    await page.goto(`${baseURL}/p/${project}`);
    await page.locator('.panel-agent > .agent').waitFor(); await verifyWidth('agent');
    await page.screenshot({path: `${artifacts}/mobile-agent.png`, fullPage: true});
    for (const tab of ['preview', 'files', 'shell', 'console', 'deploy', 'git']) {
      await page.goto(`${baseURL}/p/${project}?tab=${tab}`);
      await page.locator(`.panel-${tab}:not([hidden])`).waitFor();
      await verifyWidth(tab);
      if (tab === 'files') {
        await page.locator('.tree-main').filter({hasText: 'README.md'}).click();
        const editor = page.locator('.cm-content[contenteditable=true]');
        await editor.waitFor(); await editor.click();
        await page.keyboard.press('Control+End'); await page.keyboard.insertText('\nPrueba del editor desde móvil.\n');
        await page.getByRole('button', {name: 'Guardar', exact: true}).click();
        await page.getByText('Guardado', {exact: true}).waitFor();
        await page.screenshot({path: `${artifacts}/mobile-editor.png`, fullPage: true});
      }
      if (tab === 'shell') {
        await page.locator('.term-status.open').waitFor({timeout: 20000});
        await page.screenshot({path: `${artifacts}/mobile-terminal.png`, fullPage: true});
      }
    }
    await page.setViewportSize({width: 360, height: 800});
    await page.goto(`${baseURL}/p/${project}`); await page.locator('.panel-agent > .agent').waitFor(); await verifyWidth('360px');
    await page.setViewportSize({width: 1440, height: 1000});
    await page.goto(`${baseURL}/p/${project}`); await page.locator('.ws-side iframe').waitFor();
    await verifyWidth('desktop'); await page.screenshot({path: `${artifacts}/desktop-workspace.png`, fullPage: true});
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await context.grantPermissions(['notifications'], {origin: baseURL});
    const cdp = await context.newCDPSession(page);
    let registrationId;
    cdp.on('ServiceWorker.workerRegistrationUpdated', event => {
      const registration = event.registrations.find(item => item.scopeURL === baseURL + '/');
      if (registration) registrationId = registration.registrationId;
    });
    await cdp.send('ServiceWorker.enable');
    for (let i = 0; i < 20 && !registrationId; i++) await page.waitForTimeout(100);
    if (!registrationId) throw new Error('Service worker no registrado');
    await cdp.send('ServiceWorker.deliverPushMessage', {origin: baseURL, registrationId,
      data: JSON.stringify({title: 'CM_PUSH_OK', body: 'Prueba del receptor push', url: `/p/${project}`, tag: 'cm-test'})});
    await page.waitForFunction(async () => (await (await navigator.serviceWorker.ready).getNotifications()).some(item => item.title === 'CM_PUSH_OK'));
    await page.evaluate(async () => { for (const notification of await (await navigator.serviceWorker.ready).getNotifications()) notification.close(); });
    await page.reload(); await page.locator('.panel-agent > .agent').waitFor();
    await context.setOffline(true); await page.reload({waitUntil: 'domcontentloaded'});
    await page.locator('.panel-agent > .agent').waitFor({timeout: 12000});
    await context.setOffline(false);
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('BROWSER_VALIDATION_OK: mobile 360/390, desktop, editor, terminal, push receiver, PWA offline');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
