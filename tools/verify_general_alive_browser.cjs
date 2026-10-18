/* Esfera e interfaz viva del agente general con API simulada: formas por acción, plan, tarjetas en vivo
   (progreso, cifras, tablas, gráficas, imágenes y código) que se actualizan por id. No lanza agentes reales. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/home/dv1/.npm/_npx/fd3bca3c548369c0/node_modules/playwright-core');
const fs = require('node:fs');
const base = process.env.CM_TEST_URL || 'http://127.0.0.1:4178';
const out = process.env.CM_ARTIFACTS || 'artifacts/general-alive-20261018';
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const now = () => Date.now() / 1000;
const fence = spec => '```cm-ui\n' + JSON.stringify(spec) + '\n```';
const tool = (name, input, status = 'running', extra = {}) => ({t: 'tool', name, input, status, t0: now(), ...extra});
const LANDSCAPE = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d3b6e"/><stop offset="1" stop-color="#e8a87c"/></linearGradient></defs><rect width="640" height="360" fill="url(#s)"/><circle cx="470" cy="120" r="46" fill="#ffd59a"/><path d="M0 360 L180 170 L330 360 Z" fill="#22344f"/><path d="M220 360 L420 200 L640 360 Z" fill="#2c4466"/></svg>';
const project = name => ({name, url: `https://${name}.devdj.lat`, running_containers: 1, containers: [], container_details: [], working: [], queued: [], summary: '', stack: 'web'});
// Las opciones viven plegadas en el botón «+».
async function control(page, name) {
  const toggle = page.getByRole('button', {name: 'Controles', exact: true});
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await page.getByRole('group', {name: 'Controles del agente general'}).getByRole('button', {name, exact: true}).click();
}

(async () => {
  fs.mkdirSync(out, {recursive: true});
  const browser = await chromium.launch({headless: true});
  try {
    const sizes = JSON.parse(process.env.CM_TEST_SIZES || '[[390,844],[320,640],[768,1024],[1440,900],[740,390]]');
    for (const [width, height] of sizes) {
      const mobile = width < 1024, tag = `${width}x${height}`, shots = width === 390;
      const context = await browser.newContext({viewport: {width, height}, serviceWorkers: 'block', locale: 'es-MX', hasTouch: mobile, isMobile: mobile});
      await context.addInitScript(() => { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; try { localStorage.setItem('cm-general-speak', 'off'); } catch {} });
      const page = await context.newPage(), errors = [];
      let agent = {rev: '0', runs: [], queue: [], working: [], settings: {default_provider: 'claude'}}, rev = 0;
      const set = changes => { agent = {...agent, ...changes, rev: String(++rev)}; };
      let runId = 'r-1';
      const run = (events, changes = {}) => set({working: [{id: 'sent-1'}], queue: [], runs: [{id: runId, task_id: 'sent-1', provider: 'claude', status: 'running', prompt: 'Muéstrame el estado', approvals: [], events, ...changes}]});
      page.on('pageerror', error => errors.push(String(error.stack || error)));
      await context.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/media/paisaje.svg') return route.fulfill({contentType: 'image/svg+xml', body: LANDSCAPE});
        let result = {};
        if (url.pathname === '/api/state') result = {projects: [project('alpha'), project('poleana-game')], task_records: [], approvals: [], docker: [], memory: {}, disk: {}, tmux: [], automation: {},
          cpu: {percent: 9}, tmux_ok: true, docker_ok: true, stacks: {auto: 'La IA decide'}, settings: {default_provider: 'claude'}, domain: 'devdj.lat'};
        else if (url.pathname === '/api/agent') result = agent;
        else if (url.pathname === '/api/agent/send') { run([]); result = {message: 'Enviado', task: {id: 'sent-1', project: '_general'}}; }
        await route.fulfill({status: url.pathname === '/api/agent/send' ? 201 : 200, json: result});
      });
      await page.goto(`${base}/agent`);
      const label = page.locator('.general-state-label'), visual = page.locator('.live-orb .orb-visual');
      await label.filter({hasText: 'Disponible'}).waitFor();
      assert(await page.locator('.general-canvas').count() === 0, 'La vista en vivo aparece sin pedir nada');

      // Pedido desde esta visita: su vista en vivo se queda al terminar.
      await control(page, 'Escribir');
      await page.locator('.general-compose textarea').fill('Muéstrame el estado del servidor');
      await page.getByRole('button', {name: 'Enviar', exact: true}).click();
      await page.waitForFunction(() => !document.querySelector('.general-compose'));

      // Cada acción tiene su forma, su color y su animación.
      const cases = [
        ['code', 'Escribiendo código', [tool('Write', {file_path: '/srv/projects/alpha/src/app.jsx'})]],
        ['prompt', 'Ejecutando comandos', [tool('Bash', {command: 'ls -la /srv/projects'})]],
        ['cylinder', 'Consultando la base de datos', [tool('Bash', {command: 'docker compose exec db psql -c "select count(*) from users"'})]],
        ['pulse', 'Revisando el servidor', [tool('Bash', {command: 'df -h && free -m'})]],
        ['page', 'Leyendo archivos', [tool('Read', {file_path: '/srv/projects/alpha/README.md'})]],
        ['scan', 'Buscando en el código', [tool('Grep', {pattern: 'TODO'})]],
        ['globe', 'Buscando en la web', [tool('WebSearch', {query: 'vite 8'})]],
        ['gear', 'Compilando', [tool('Bash', {command: 'npm run build'})]],
        ['helix', 'Subiendo cambios', [tool('Bash', {command: 'git push origin main'})]],
        ['cluster', 'Delegando una tarea', [tool('Agent', {description: 'Revisar los logs'})]],
        ['neural', 'Pensando', [{t: 'thinking', text: '…'}]],
        ['wave', 'Respondiendo', [{t: 'text', text: 'Ya casi lo tengo.'}]],
        ['bars', 'Preparando una gráfica', [{t: 'text', text: 'Mira:\n```cm-ui\n{"type":"chart","labels":["a"', streaming: true}]],
        ['grid', 'Armando una tabla', [{t: 'text', text: '```cm-ui\n{"type":"table","columns":[', streaming: true}]],
        ['frame', 'Preparando una imagen', [{t: 'text', text: '```cm-ui\n{"type":"image","media":"pais', streaming: true}]],
      ];
      for (const [shape, title, events] of cases) {
        run(events);
        // Con poca altura y la vista en vivo abierta, la etiqueta se oculta a propósito (la forma y la tarjeta lo dicen).
        await label.filter({hasText: title}).waitFor({state: height <= 600 ? 'attached' : 'visible', timeout: 8000});
        await page.waitForFunction(value => document.querySelector('.live-orb .orb-visual')?.dataset.shape === value, shape, {timeout: 8000});
        const tint = await page.locator('.general-orbit').evaluate(el => getComputedStyle(el).getPropertyValue('--presence').trim());
        assert(/^#[0-9a-f]{6}$/.test(tint), `${shape}: sin color propio (${tint})`);
        if (['bars', 'grid', 'frame'].includes(shape)) await page.locator(`.draft-card[data-type="${{bars: 'chart', grid: 'table', frame: 'image'}[shape]}"]`).waitFor();
        if (shots) { await page.waitForTimeout(2200); await page.locator('.live-orb').screenshot({path: `${out}/orb-${shape}.png`}); }
      }
      // Estados fuera de la ejecución: cola, permiso y error.
      set({working: [], queue: [{id: 'q-1'}], runs: []});
      await page.waitForFunction(() => document.querySelector('.live-orb .orb-visual')?.dataset.shape === 'hourglass', null, {timeout: 8000});
      if (shots) { await page.waitForTimeout(2200); await page.locator('.live-orb').screenshot({path: `${out}/orb-hourglass.png`}); }
      run([tool('Bash', {command: 'rm -rf build'})], {approvals: [{id: 'a-1', run_id: 'r-1', tool_name: 'Bash', input: {command: 'rm -rf build'}, provider: 'claude'}]});
      await page.waitForFunction(() => document.querySelector('.live-orb .orb-visual')?.dataset.shape === 'shield', null, {timeout: 8000});
      if (shots) { await page.waitForTimeout(2200); await page.locator('.live-orb').screenshot({path: `${out}/orb-shield.png`}); }

      // Plan del agente arriba: segmentos y paso actual.
      run([tool('TodoWrite', {todos: [{content: 'Compilar', status: 'completed'}, {content: 'Desplegar', activeForm: 'Desplegando', status: 'in_progress'}, {content: 'Verificar', status: 'pending'}]}, 'done'),
        tool('Bash', {command: 'npm run build'}, 'done', {t1: now()}), tool('Bash', {command: 'docker compose up -d --build'})]);
      await page.locator('.live-plan .plan-count', {hasText: '1/3'}).waitFor({timeout: 8000});
      assert(await page.locator('.live-plan .plan-text').innerText() === 'Desplegando', 'El plan no muestra el paso actual');
      assert(await page.locator('.plan-steps i.running').count() === 1 && await page.locator('.plan-steps i.done').count() === 1, 'Segmentos del plan incorrectos');

      // Interfaz viva: aparecen tarjetas mientras trabaja y se actualizan por id con animación.
      const progress = value => fence({type: 'progress', id: 'deploy', title: 'Despliegue', value, steps: [{label: 'Compilar', status: 'done'}, {label: 'Desplegar', status: value < 100 ? 'running' : 'done'}, {label: 'Verificar', status: 'pending'}]});
      const stats = cpu => fence({type: 'stats', id: 'metricas', title: 'Servidor', items: [{label: 'CPU', value: cpu, unit: '%', delta: 3.5, trend: [20, 31, 28, cpu]}, {label: 'Contenedores', value: 12}, {label: 'Estado', value: 'estable'}]});
      const table = rows => fence({type: 'table', id: 'contenedores', title: 'Contenedores', columns: ['Nombre', 'CPU %', 'Memoria'], rows});
      const chart = values => fence({type: 'chart', id: 'cpu', title: 'CPU por proyecto', labels: ['alpha', 'poleana', 'tacos'], values, unit: '%'});
      const texts = [];
      const say = text => { texts.push({t: 'text', text}); run([...texts, tool('Bash', {command: 'docker stats --no-stream'})]); };
      say(`Preparo el despliegue.\n${progress(20)}`);
      const canvas = page.locator('.general-canvas');
      await canvas.waitFor({timeout: 8000});
      assert(/en vivo/i.test(await canvas.locator('.canvas-head').innerText()), 'La vista no indica que es en vivo');
      await page.locator('[role="progressbar"][aria-valuenow="20"]').waitFor();
      say(`Avanzo.\n${progress(80)}`);
      await page.locator('[role="progressbar"][aria-valuenow="80"]').waitFor({timeout: 8000});
      assert(await canvas.locator('.presentation-card[data-type="progress"]').count() === 1, 'La tarjeta con id se duplicó al actualizarse');
      assert(await canvas.locator('.card-pulse').count() === 1, 'La actualización no destella');
      await page.waitForFunction(() => document.querySelector('.progress-line b')?.textContent === '80 %', null, {timeout: 4000});
      say(`${stats(42.5)}\n${table([['web', '12.5', '180 MB'], ['db', '3.1', '410 MB'], ['cola', '0.4', '64 MB']])}\n${chart([32, 18, 6])}`);
      await canvas.locator('.stat').first().waitFor({timeout: 8000});
      await page.waitForFunction(() => document.querySelector('.stat-value')?.textContent === '42.5%', null, {timeout: 4000});
      assert(await canvas.locator('.presentation-chart rect').count() === 3, 'La gráfica no tiene sus barras');
      const firstBar = await canvas.locator('.presentation-chart rect').first().getAttribute('height');
      say(`${stats(57)}\n${table([['web', '14.2', '182 MB'], ['db', '3.1', '410 MB'], ['cola', '0.4', '64 MB'], ['worker', '7.7', '120 MB']])}\n${chart([12, 18, 26])}`);
      await page.waitForFunction(() => document.querySelector('.stat-value')?.textContent === '57%', null, {timeout: 5000});
      await canvas.locator('.cell-changed', {hasText: '14.2'}).waitFor({timeout: 4000});
      assert(await canvas.locator('tbody tr').count() === 4, 'La tabla no creció');
      await page.waitForTimeout(900);
      assert(await canvas.locator('.presentation-chart rect').first().getAttribute('height') !== firstBar, 'Las barras no se movieron al nuevo valor');
      assert(await canvas.locator('td.num').count() === 4, 'Las columnas numéricas no se alinean');
      say(`${fence({type: 'image', title: 'Captura', media: 'paisaje.svg', caption: 'Así se ve ahora'})}\n${fence({type: 'code', title: 'Cambio', language: 'js', code: 'export function hola() {\n  return "mundo";\n}'})}\n${fence({type: 'chart', variant: 'donut', title: 'Disco', labels: ['Usado', 'Libre'], values: [71, 29], unit: 'GB'})}`);
      await canvas.locator('.live-image.ready').waitFor({timeout: 8000});
      assert(await canvas.locator('.live-image img').evaluate(img => img.naturalWidth > 0), 'La imagen no cargó');
      assert(await canvas.locator('.code-line').count() === 3 && await canvas.locator('.donut-arc').count() === 2, 'Faltan el código o la dona');
      assert(await canvas.locator('.presentation-card').count() === 7, `Tarjetas inesperadas: ${await canvas.locator('.presentation-card').count()}`);
      await page.waitForTimeout(1300);
      const metrics = await page.evaluate(() => {
        const box = selector => { const el = document.querySelector(selector); if (!el) return null; const {top, bottom, left, right} = el.getBoundingClientRect(); return {top, bottom, left, right}; };
        return {canvas: box('.general-canvas'), orb: box('.live-orb'), live: box('.general-live'), header: box('.general-top'), nav: box('.bottom-nav'), width: innerWidth, height: innerHeight,
          scroll: document.documentElement.scrollWidth, page: document.documentElement.scrollHeight};
      });
      // En escritorio la barra inferior está oculta (rect en cero): el límite es la ventana.
      const bottom = metrics.nav && metrics.nav.bottom > metrics.nav.top ? metrics.nav.top : metrics.height;
      assert(metrics.scroll <= metrics.width + 1 && metrics.page <= metrics.height + 1, `La vista en vivo desborda (${tag}): ${JSON.stringify(metrics)}`);
      // Debajo del encabezado, sin encimarse (en vertical una sobre otra; en horizontal con poca altura, lado a lado).
      const apart = (a, b) => a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1;
      const above = metrics.live?.bottom ?? metrics.header.bottom;
      assert(metrics.orb.top >= above - 1 && metrics.canvas.top >= above - 1 && apart(metrics.orb, metrics.canvas) && metrics.canvas.bottom <= bottom + 1,
        `Esfera y vista en vivo solapadas (${tag}): ${JSON.stringify(metrics)}`);
      if (height <= 600 && width / height >= 4 / 3) assert(metrics.canvas.left >= metrics.orb.right - 1 && metrics.canvas.bottom - metrics.canvas.top >= 180,
        `En horizontal la vista en vivo debería ir junto a la esfera (${tag}): ${JSON.stringify(metrics)}`);
      await page.screenshot({path: `${out}/live-working-${tag}.png`});
      if (shots) {
        await canvas.locator('.canvas-scroll').evaluate(el => { el.scrollTop = 0; });
        await page.waitForTimeout(300);
        await canvas.screenshot({path: `${out}/live-cards-top-${tag}.png`});
        for (const [index, top] of [[1, 420], [2, 840], [3, 1260]].entries()) {
          await canvas.locator('.canvas-scroll').evaluate((el, value) => { el.scrollTop = value; }, top[1]);
          await page.waitForTimeout(250);
          await canvas.screenshot({path: `${out}/live-cards-${index + 1}-${tag}.png`});
        }
      }

      // Al terminar, el resultado visual se queda (sin duplicar el bloque repetido en la respuesta final).
      set({working: [], runs: [{...agent.runs[0], status: 'done', events: texts, result: {text: `Listo, todo en orden.\n${stats(57)}`}}]});
      await canvas.locator('.canvas-head', {hasText: /resultado/i}).waitFor({timeout: 8000});
      assert(await canvas.locator('.presentation-card').count() === 7, 'Se duplicaron tarjetas al terminar');
      assert(await visual.getAttribute('data-shape') === 'sphere', 'La esfera no volvió a su forma');
      await page.screenshot({path: `${out}/live-done-${tag}.png`});
      await page.getByRole('button', {name: 'Ocultar vista en vivo', exact: true}).click();
      await canvas.waitFor({state: 'detached'});
      await page.getByRole('button', {name: 'Ver texto', exact: true}).click();
      await page.locator('.general-response', {hasText: 'Listo, todo en orden.'}).waitFor();
      assert(await page.locator('.general-response .presentation-card[data-type="stats"]').count() === 1, 'El texto no incluye lo visual');

      // Movimiento reducido: los datos se muestran ya en su valor final.
      if (width === 390) {
        await page.getByRole('button', {name: 'Ocultar respuesta', exact: true}).click();
        await page.emulateMedia({reducedMotion: 'reduce'});
        texts.length = 0; runId = 'r-2'; // otra ejecución: la vista oculta era solo de la anterior
        say(stats(88));
        await canvas.waitFor({timeout: 8000});
        await page.waitForFunction(() => document.querySelector('.stat-value')?.textContent === '88%', null, {timeout: 1500});
        await page.emulateMedia({reducedMotion: 'no-preference'});
      }
      assert(errors.length === 0, errors.join('\n'));
      await context.close();
      console.log(`GENERAL_ALIVE_OK ${tag}`);
    }
    console.log('GENERAL_ALIVE_BROWSER_OK: 18 formas por acción con color propio, plan, tarjetas en vivo por id (progreso, cifras, tabla, gráfica, imagen, código, dona), resultado persistente y movimiento reducido');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
