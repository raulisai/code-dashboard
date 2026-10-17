/* Teclado móvil: cambia solo visualViewport; todas las API están simuladas. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/home/dv1/.npm/_npx/fd3bca3c548369c0/node_modules/playwright-core');
const base = process.env.CM_TEST_URL || 'http://127.0.0.1:4183';
const assert = (ok, message) => { if (!ok) throw new Error(message); };

(async () => {
  const browser = await chromium.launch({headless: true});
  try {
    for (const [width, height, keyboardHeight] of [[390, 844, 420], [360, 740, 340], [1440, 900, 500]]) {
      const context = await browser.newContext({viewport: {width, height}, isMobile: width < 1024, hasTouch: width < 1024, serviceWorkers: 'block'});
      await context.route('**/api/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        assert(request.method() === 'GET', `Petición de escritura inesperada: ${path}`);
        let result = {};
        if (path === '/api/state') result = {projects: [], task_records: [], approvals: [], docker: [], memory: {}, disk: {}, tmux: [], automation: {}, cpu: {percent: 12}, tmux_ok: true,
          stacks: {auto: 'La IA decide'}, settings: {default_provider: 'codex'}, domain: 'devdj.lat'};
        if (path === '/api/agent') result = {rev: '1', runs: [], queue: [], working: [], settings: {default_provider: 'codex'}};
        await route.fulfill({json: result});
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      await page.goto(`${base}/agent`);
      await page.locator('.general-state-label', {hasText: 'Disponible'}).waitFor();
      await page.emulateMedia({reducedMotion: 'reduce'});

      // En móviles reales el teclado reduce el viewport visual y mantiene el de layout.
      const visualHeight = async value => {
        await page.evaluate(height => {
          Object.defineProperty(window.visualViewport, 'height', {get: () => height, configurable: true});
          window.visualViewport.dispatchEvent(new Event('resize'));
        }, value);
        await page.waitForTimeout(100);
        assert(await page.evaluate(() => innerHeight) === height, 'Se alteró el viewport de layout');
      };
      const contained = async (selector, limit, label) => {
        const box = await page.locator(selector).boundingBox();
        assert(box && box.y >= -1 && box.y + box.height <= limit + 1, `${label} fuera del viewport visual (${width}): ${JSON.stringify(box)} / ${limit}`);
        assert(box.x >= -1 && box.x + box.width <= width + 1, `${label} desborda horizontalmente`);
      };

      await page.getByRole('button', {name: 'Controles', exact: true}).click();
      await page.getByRole('button', {name: 'Escribir', exact: true}).click();
      await page.locator('.general-compose textarea').fill('Mensaje largo para comprobar el teclado.\n'.repeat(15));
      await visualHeight(keyboardHeight);
      assert(await page.locator('.general').evaluate(el => el.classList.contains('keyboard-open')), 'No se reconoció el teclado');
      await contained('.general-top', keyboardHeight, 'Cabecera');
      await contained('.live-orb', keyboardHeight, 'Esfera');
      await contained('.general-compose', keyboardHeight, 'Compositor');
      await contained('.general-compose .send-btn', keyboardHeight, 'Enviar');
      assert(await page.locator('.general-dock').evaluate(el => getComputedStyle(el).display === 'none'), 'Los controles no se adaptaron al teclado');
      if (width < 1024) assert(await page.locator('.bottom-nav').evaluate(el => getComputedStyle(el).display === 'none'), 'La navegación tapa el teclado');
      await visualHeight(height);
      assert(!await page.locator('.general').evaluate(el => el.classList.contains('keyboard-open')), 'El teclado quedó marcado al cerrarse');
      await page.getByRole('button', {name: 'Cerrar teclado', exact: true}).click();
      await contained('.general-dock', height, 'Controles tras cerrar teclado');

      await page.getByRole('button', {name: 'Ver conversación', exact: true}).focus();
      await page.getByRole('button', {name: 'Ver conversación', exact: true}).click();
      await page.getByRole('dialog', {name: 'Conversación con el agente general'}).waitFor();
      await visualHeight(keyboardHeight);
      await contained('.general-sheet', keyboardHeight, 'Historial');
      await contained('.sheet-compose', keyboardHeight, 'Compositor del historial');
      await contained('.sheet-compose .send-btn', keyboardHeight, 'Enviar del historial');
      const keyboardSheet = await page.locator('.general-sheet').boundingBox();
      await visualHeight(height);
      const normalSheet = await page.locator('.general-sheet').boundingBox();
      assert(normalSheet.height > keyboardSheet.height + 100, 'El historial no recuperó su altura');
      await contained('.general-sheet', height, 'Historial tras cerrar teclado');
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', {name: 'Conversación con el agente general'}).waitFor({state: 'hidden'});
      assert(await page.getByRole('button', {name: 'Ver conversación', exact: true}).evaluate(el => el === document.activeElement), 'El historial no devolvió el foco');
      assert(await page.evaluate(() => document.body.style.overflow !== 'hidden'), 'El historial dejó el scroll bloqueado');
      assert(!errors.length, errors.join('\n'));
      await context.close();
      console.log(`GENERAL_KEYBOARD_OK ${width}x${height} visual=${keyboardHeight}`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
