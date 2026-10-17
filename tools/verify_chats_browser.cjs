/* Real UI with isolated API fixtures: no agents or production data are mutated. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/home/dv1/.npm/_npx/fd3bca3c548369c0/node_modules/playwright-core');
const fs = require('node:fs');
const base = process.env.CM_TEST_URL || 'http://127.0.0.1:4178';
const out = process.env.CM_ARTIFACTS || 'artifacts/chats-20261017';
const assert = (ok, message) => { if (!ok) throw new Error(message); };
(async () => {
  fs.mkdirSync(out, {recursive: true});
  const browser = await chromium.launch({headless: true});
  try {
    for (const width of [360, 390, 768, 1440]) {
      console.log(`Checking chats at ${width}px`);
      const context = await browser.newContext({viewport: {width, height: 900}, serviceWorkers: 'block'});
      const page = await context.newPage();
      const errors = [], sent = [];
      const chats = [{id: 'main', title: 'Chat principal'}, {id: 'design', title: 'Diseño', working: 1}];
      const project = {name: 'alpha', url: 'https://alpha.devdj.lat', working: [], queued: 0, container_details: [], containers: []};
      page.on('pageerror', error => { errors.push(String(error)); console.error('Browser error:', String(error)); });
      await context.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url()), data = request.method() === 'POST' && request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : {};
        let result = {};
        if (url.pathname === '/api/state') result = {projects: [project], task_records: [], approvals: [], docker: [], memory: {}, disk: {}, tmux: [], automation: {}};
        else if (url.pathname === '/api/models') result = {codex: [{id:'model-code-test', name:'Codex de prueba', efforts:['low','high']}, {id:'model-design-test', name:'Codex diseño', efforts:['high']}, {id:'model-fast-test',name:'Codex rápido',efforts:['low']}], claude:[{id:'sonnet',name:'Sonnet de prueba',efforts:['medium','high']}], defaults:{codex:'model-code-test',claude:'sonnet'}};
        else if (url.pathname === '/api/agent/chats') {
          if (request.method() === 'POST') {
            if (data.action === 'rename') chats.find(chat => chat.id === data.chat_id).title = data.title;
            else { const chat = {id: 'newchat', title: data.title || 'Chat 3'}; chats.push(chat); result = {chat}; }
          } else result = {chats};
        } else if (url.pathname === '/api/agent') {
          const chat = url.searchParams.get('chat_id');
          result = {rev: String(sent.length), runs: [], working: [], sessions: {}, settings: {default_provider: 'codex'},
            queue: sent.filter(task => task.chat_id === chat).map((task, i) => ({...task, id: String(i), details: task.text}))};
        } else if (url.pathname === '/api/agent/send') { sent.push(data); result = {message: 'Enviado'}; }
        else if (url.pathname === '/api/files/upload') result = {paths: ['.codex-manager/uploads/prueba.txt']};
        await route.fulfill({json: result});
      });
      await page.goto(`${base}/p/alpha?chat=main`);
      console.log('Workspace loaded');
      const selector = page.getByLabel('Sesión de chat', {exact: true});
      const composer = page.locator('.composer textarea');
      await selector.selectOption('main');
      const compactHeight = await composer.evaluate(el => el.getBoundingClientRect().height);
      const longDraft = 'Petición larga dictada o escrita.\n'.repeat(50);
      await composer.fill(longDraft);
      assert(await composer.evaluate(el => el.getBoundingClientRect().height) > compactHeight, 'El campo no crece');
      assert(await composer.evaluate(el => el.getBoundingClientRect().height) <= 222, 'El campo crece sin límite');
      await composer.fill('');
      assert(Math.abs(await composer.evaluate(el => el.getBoundingClientRect().height) - compactHeight) <= 1, 'El campo no encoge al borrar');
      await composer.fill('Borrador principal');
      const model = page.getByRole('button', {name:'Escoger modelo y esfuerzo',exact:true});
      const pick = async (name, effort) => {
        await model.click();
        const panel = page.getByRole('dialog', {name:'Modelo y esfuerzo'});
        await panel.getByRole('radiogroup', {name:'Modelo',exact:true}).getByRole('radio', {name:new RegExp('^'+name)}).click();
        if (effort) await panel.getByRole('radiogroup', {name:'Esfuerzo',exact:true}).getByRole('radio',{name:effort,exact:true}).click();
        assert(await panel.locator('input').count() === 0, 'El selector permite escribir modelos');
        await page.screenshot({path:`${out}/selector-${width}.png`});
        await panel.getByRole('button',{name:'Listo',exact:true}).click();
      };
      await pick('Codex de prueba', 'Alto');
      await pick('Codex rápido');
      assert((await model.innerText()).includes('Automático'), 'No limpió esfuerzo incompatible');
      await model.click();
      assert(await page.getByRole('dialog').getByRole('radiogroup', {name:'Esfuerzo',exact:true}).getByRole('radio',{name:'Alto',exact:true}).count() === 0, 'Ofrece esfuerzo no compatible');
      await page.keyboard.press('Escape');
      await pick('Codex de prueba', 'Alto');
      await page.getByRole('radio', {name: 'Claude'}).click();
      await pick('Sonnet de prueba', 'Medio');
      await page.getByRole('radio', {name: 'Codex'}).click();
      await page.waitForFunction(() => document.querySelector('.model-trigger')?.textContent.includes('Codex de prueba'));
      assert((await model.innerText()).includes('Codex de prueba') && (await model.innerText()).includes('Alto'), 'Modelos mezclados entre agentes');
      await selector.selectOption('design');
      console.log('Independent draft');
      assert((await model.innerText()).includes('Escoger modelo'), 'Otro chat heredó modelo');
      await pick('Codex diseño', 'Alto');
      await composer.fill(longDraft);
      await page.locator('input[type=file]').setInputFiles({name: 'prueba.txt', mimeType: 'text/plain', buffer: Buffer.from('test')});
      await page.locator('.attachments').waitFor();
      await selector.selectOption('main');
      await page.waitForFunction(() => document.querySelector('.model-trigger')?.textContent.includes('Codex de prueba'));
      assert((await model.innerText()).includes('Codex de prueba') && (await model.innerText()).includes('Alto'), 'Modelo principal perdido');
      assert(await composer.inputValue() === 'Borrador principal', 'Borradores mezclados');
      assert(await page.locator('.attachments').count() === 0, 'Adjuntos mezclados');
      await selector.selectOption('design');
      assert(await composer.inputValue() === longDraft, 'Borrador no restaurado');
      await page.locator('.attachments').waitFor();
      await page.getByRole('button', {name: 'Enviar', exact: true}).click();
      await page.waitForFunction(() => document.querySelector('.composer textarea')?.value === '');
      assert(Math.abs(await composer.evaluate(el => el.getBoundingClientRect().height) - compactHeight) <= 1, 'El campo no vuelve a pequeño tras enviar');
      assert(sent.length === 1 && sent[0].chat_id === 'design' && sent[0].provider === 'codex', 'Envío al chat incorrecto');
      assert(sent[0].model === 'model-design-test' && sent[0].effort === 'high', 'El modelo no viaja con el mensaje');
      assert(sent[0].text.includes('prueba.txt'), 'Adjunto no enviado');
      await page.locator('.queued').waitFor();
      await selector.selectOption('main');
      assert(await page.locator('.queued').count() === 0, 'Colas mezcladas');
      await page.getByRole('button', {name: '+ Nuevo chat', exact: true}).click();
      console.log('Creating chat');
      await page.getByLabel('Nombre del chat', {exact: true}).fill('Correcciones');
      await page.getByRole('button', {name: 'Crear', exact: true}).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Sesión de chat"]')?.value === 'newchat');
      assert(await composer.inputValue() === '', 'Nuevo chat heredó borrador');
      await page.getByRole('button', {name: 'Renombrar chat', exact: true}).click();
      await page.getByLabel('Nombre del chat', {exact: true}).fill('Pruebas y errores');
      await page.getByRole('button', {name: 'Guardar', exact: true}).click();
      await page.waitForFunction(() => document.querySelector('option[value="newchat"]')?.textContent === 'Pruebas y errores');
      await composer.fill('Borrador persistente');
      await page.waitForFunction(() => localStorage.getItem('cm-draft-alpha-newchat') === 'Borrador persistente');
      await page.reload();
      try { await composer.waitFor(); } catch (error) { console.error('Reload failure:', page.url(), await page.locator('body').innerText()); throw error; }
      assert(await selector.inputValue() === 'newchat', 'Selección no persistente');
      assert(await composer.inputValue() === 'Borrador persistente', 'Borrador perdido al recargar');
      assert(await page.getByRole('button', {name: 'Dictar por voz', exact: true}).isVisible(), 'Dictado ausente');
      const dimensions = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth, composer: document.querySelector('.composer').getBoundingClientRect().bottom}));
      assert(dimensions.scroll <= dimensions.width + 1, `Desbordamiento ${width}`);
      assert(dimensions.composer <= 900, `Compositor fuera de pantalla ${width}`);
      await page.screenshot({path: `${out}/chats-${width}.png`, fullPage: true});
      await page.goto(`${base}/agent`);
      await page.locator('.general-identity').waitFor();
      assert(await page.getByRole('button', {name:'Escoger modelo y esfuerzo',exact:true}).count() === 0, 'El agente general muestra modelos');
      assert(errors.length === 0, errors.join('\n'));
      await context.close();
    }
    console.log('CHATS_BROWSER_OK (360, 390, 768, 1440)');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
