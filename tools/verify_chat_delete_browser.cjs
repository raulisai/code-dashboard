/* Eliminar/vaciar chats y cambio Claude ⇄ Codex con la UI real y API simulada: no muta datos ni lanza agentes. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/home/dv1/.npm/_npx/fd3bca3c548369c0/node_modules/playwright-core');
const fs = require('node:fs');
const base = process.env.CM_TEST_URL || 'http://127.0.0.1:4178';
const out = process.env.CM_ARTIFACTS || 'artifacts/chat-delete-20261017';
const assert = (ok, message) => { if (!ok) throw new Error(message); };
(async () => {
  fs.mkdirSync(out, {recursive: true});
  const browser = await chromium.launch({headless: true});
  try {
    for (const width of [360, 390, 768, 1440]) {
      console.log(`Checking chat delete at ${width}px`);
      const context = await browser.newContext({viewport: {width, height: 900}, serviceWorkers: 'block'});
      const page = await context.newPage();
      const errors = [], posts = [], dialogs = [];
      let chats = [{id: 'main', title: 'Chat principal'}, {id: 'wrong', title: 'Me equivoqué', queued: 1}];
      let mainRuns = [
        {id: '20261017-100000-aaaaaa', provider: 'codex', project: 'alpha', chat_id: 'main', status: 'done', created_at: 1792250000, finished_at: 1792250060,
          prompt: 'Pon el botón azul', events: [{t: 'text', text: 'Botón azul listo'}], result: {ok: true, text: 'Botón azul listo'}, resumed: false, handoff: 0},
        {id: '20261017-100500-bbbbbb', provider: 'claude', project: 'alpha', chat_id: 'main', status: 'done', created_at: 1792250300, finished_at: 1792250360,
          prompt: 'Ahora hazlo redondo', events: [{t: 'text', text: 'Bordes redondeados'}], result: {ok: true, text: 'Bordes redondeados'}, resumed: false, handoff: 1}];
      const project = {name: 'alpha', url: 'https://alpha.devdj.lat', working: [], queued: 0, container_details: [], containers: []};
      page.on('pageerror', error => { errors.push(String(error)); console.error('Browser error:', String(error)); });
      page.on('dialog', dialog => { dialogs.push(dialog.message()); dialog.accept(); });
      await context.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url()), data = request.method() === 'POST' && request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : {};
        let result = {};
        if (request.method() === 'POST') posts.push({path: url.pathname, ...data});
        if (url.pathname === '/api/state') result = {projects: [project], task_records: [], approvals: [], docker: [], memory: {}, disk: {}, tmux: [], automation: {}};
        else if (url.pathname === '/api/agent/chats') {
          if (data.action === 'delete') {
            if (data.chat_id === 'main') { mainRuns = []; result = {message: 'Chat principal vaciado: empieza de cero'}; }
            else { chats = chats.filter(chat => chat.id !== data.chat_id); result = {message: 'Chat «Me equivoqué» eliminado'}; }
          } else result = {chats};
        } else if (url.pathname === '/api/agent') {
          const chat = url.searchParams.get('chat_id');
          if (!chats.some(row => row.id === chat)) { await route.fulfill({status: 404, json: {message: 'Chat no encontrado en este proyecto'}}); return; }
          const runs = chat === 'main' ? mainRuns : [];
          result = {rev: `${chat}-${runs.length}`, runs, working: [], queue: [], settings: {default_provider: 'codex'},
            sessions: runs.length ? {codex: 'thread-1', claude: 'session-1'} : {}};
        }
        await route.fulfill({json: result});
      });
      await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('cm-draft-alpha-wrong', 'borrador'); } });
      await page.goto(`${base}/p/alpha?chat=main`);
      const openOptions = async () => { if (!await page.locator('.chat-options').evaluate(el => el.open)) await page.getByLabel('Opciones del chat', {exact:true}).click(); };
      const selector = page.getByLabel('Sesión de chat', {exact: true});
      await page.locator('.run').nth(1).waitFor();
      assert(await page.locator('.agent-meta', {hasText: 'retoma el chat'}).count() === 1, 'Falta la marca de traspaso');
      // El último turno fue de Claude: al elegir Codex se indica que retoma el mismo chat.
      await openOptions(); await page.getByRole('radio', {name: 'Codex'}).click();
      await page.locator('.conv-state', {hasText: 'Codex retoma el chat'}).waitFor();
      await openOptions(); await page.getByRole('radio', {name: 'Claude'}).click();
      await page.locator('.conv-state', {hasText: 'Conversación continua'}).waitFor();
      console.log('Provider switch labels OK');

      await openOptions(); await selector.selectOption('wrong');
      await openOptions(); await page.getByRole('button', {name: 'Eliminar chat', exact: true}).waitFor();
      const dimensions = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth,
        bar: document.querySelector('.chat-selector').getBoundingClientRect().right, select: document.querySelector('.chat-selector select').getBoundingClientRect().width}));
      assert(dimensions.scroll <= dimensions.width + 1 && dimensions.bar <= dimensions.width + 1, `Desbordamiento ${width}`);
      assert(dimensions.select >= 90, `Selector demasiado estrecho (${dimensions.select}px) a ${width}`);
      await page.screenshot({path: `${out}/chat-delete-${width}.png`});
      await openOptions(); await page.getByRole('button', {name: 'Eliminar chat', exact: true}).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Sesión de chat"]')?.value === 'main');
      assert(dialogs[0].includes('Me equivoqué') && dialogs[0].includes('1 mensaje(s) en cola'), 'Confirmación incompleta');
      assert(posts.some(p => p.action === 'delete' && p.chat_id === 'wrong' && p.project === 'alpha'), 'No se pidió eliminar');
      assert(await page.locator('option[value="wrong"]').count() === 0, 'El chat sigue en la lista');
      assert(await page.evaluate(() => localStorage.getItem('cm-draft-alpha-wrong')) === null, 'Borrador huérfano');
      assert(new URL(page.url()).searchParams.get('chat') === 'main', 'URL apunta al chat eliminado');
      console.log('Delete chat OK');

      await openOptions(); await page.getByRole('button', {name: 'Vaciar chat principal', exact: true}).click();
      await page.locator('.intro').waitFor();
      assert(dialogs[1].includes('Vaciar el Chat principal'), 'Confirmación de vaciado ausente');
      assert(posts.some(p => p.action === 'delete' && p.chat_id === 'main'), 'No se pidió vaciar');
      assert(await page.locator('.conv-state', {hasText: 'Conversación nueva'}).count() === 1, 'El contexto no se ve reiniciado');
      await page.screenshot({path: `${out}/chat-cleared-${width}.png`});
      assert(errors.length === 0, errors.join('\n'));
      await context.close();
    }
    console.log('CHAT_DELETE_BROWSER_OK (360, 390, 768, 1440)');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
