/* Agente general (esfera central) con la UI real y API simulada: no lanza agentes ni transcribe audio real. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/home/dv1/.npm/_npx/fd3bca3c548369c0/node_modules/playwright-core');
const fs = require('node:fs');
const base = process.env.CM_TEST_URL || 'http://127.0.0.1:4178';
const out = process.env.CM_ARTIFACTS || 'artifacts/general-20261017';
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const now = () => Date.now() / 1000;
// Tono de 440 Hz como «voz» del micrófono virtual (sin audio el medidor no detecta habla).
function toneWav(path, seconds = 4, rate = 16000) {
  const samples = seconds * rate, data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + samples * 2, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 9000), 44 + i * 2);
  fs.writeFileSync(path, data);
}
const project = (name, running) => ({name, url: `https://${name}.devdj.lat`, running_containers: running, containers: [], container_details: [], working: [], queued: [], summary: '', stack: 'web'});

(async () => {
  fs.mkdirSync(out, {recursive: true});
  const wav = require('node:path').resolve(out, 'tono.wav'); toneWav(wav);
  const browser = await chromium.launch({headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`]});
  try {
    for (const [width, height] of [[360, 740], [390, 844], [1440, 900]]) {
      console.log(`Checking general agent at ${width}px`);
      const mobile = width < 1024;
      const context = await browser.newContext({viewport: {width, height}, serviceWorkers: 'block', permissions: ['microphone'], locale: 'es-MX', hasTouch: mobile, isMobile: mobile});
      const page = await context.newPage();
      const errors = [], posts = [];
      let agent = {rev: '1', runs: [], queue: [], working: [], settings: {default_provider: 'codex'}};
      page.on('pageerror', error => { errors.push(String(error)); console.error('Browser error:', error.stack); });
      await context.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url());
        const data = request.method() === 'POST' && url.pathname !== '/api/voice/transcribe' ? request.postDataJSON() : {};
        if (request.method() === 'POST') posts.push({path: url.pathname, ...data});
        let result = {};
        if (url.pathname === '/api/state') result = {projects: [project('poleana-game', 4), project('codex-dashboard', 2), project('tacos', 0)], task_records: [], approvals: [], docker: [],
          memory: {}, disk: {}, tmux: [], automation: {}, cpu: {percent: 12}, tmux_ok: true, stacks: {auto: 'La IA decide'}, settings: {default_provider: 'codex'}, domain: 'devdj.lat'};
        else if (url.pathname === '/api/agent') result = agent;
        else if (url.pathname === '/api/agent/chats') result = {chats: [{id: 'main', title: 'Chat principal', working: 0, queued: 0}]};
        else if (url.pathname === '/api/voice/transcribe') result = {text: 'revisa los logs de poleana'};
        else if (url.pathname === '/api/voice') result = {ready: true, local: true};
        else if (url.pathname === '/api/agent/send') result = {message: 'Enviado', task: {id: `t-${posts.length}`, project: data.project}};
        await route.fulfill({status: url.pathname === '/api/agent/send' ? 201 : 200, json: result});
      });

      // La esfera de la barra abre el agente: la esfera central llega animada desde su posición.
      await page.goto(`${base}/`);
      const navOrb = page.locator(mobile ? '.bottom-nav a.accent' : '.side-link.accent');
      await navOrb.waitFor();
      assert(await page.locator('.bottom-nav a[href="/new"], .side-link[href="/new"]').count() === 0, 'Crear proyecto sigue en la navegación');
      await navOrb.click();
      await page.waitForFunction(() => location.pathname === '/agent');
      const orb = page.locator('.live-orb');
      await orb.waitFor();
      if (mobile) assert(await orb.evaluate(el => el.style.getPropertyValue('--from-y') !== ''), 'La esfera no viaja desde la barra');
      await page.locator('.general h1', {hasText: '¿Qué hacemos hoy?'}).waitFor();
      assert(/3 proyectos · 2 en línea · CPU 12%/.test(await page.locator('.general-status p').innerText()), 'Resumen del servidor incorrecto');
      await page.waitForTimeout(1200);
      const box = await orb.boundingBox();
      assert(Math.abs(box.x + box.width / 2 - (mobile ? width / 2 : (await page.locator('.general').boundingBox()).x + (await page.locator('.general').boundingBox()).width / 2)) < 3, 'La esfera no está centrada');
      assert(box.width > Math.min(width * .5, 200), `Esfera pequeña: ${box.width}`);
      await page.screenshot({path: `${out}/idle-${width}.png`});
      assert(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), 'La vista en reposo no cabe en pantalla');

      // Proveedor y mensaje escrito.
      await page.getByRole('radio', {name: 'Claude'}).click();
      assert(await page.getByRole('radio', {name: 'Claude'}).getAttribute('aria-checked') === 'true', 'No cambió a Claude');
      await page.getByRole('button', {name: 'Escribir'}).click();
      await page.locator('.general-compose textarea').fill('¿Cómo está el servidor?');
      await page.getByRole('button', {name: 'Enviar', exact: true}).click();
      await page.waitForFunction(() => !document.querySelector('.general-compose'));
      const sent = posts.find(p => p.path === '/api/agent/send');
      assert(sent && sent.project === '_general' && sent.provider === 'claude' && sent.chat_id === 'main' && sent.text === '¿Cómo está el servidor?', 'Mensaje mal enviado');

      // Trabajando: titular, proyecto detectado y actividad en tiempo real como en la referencia.
      const t = now();
      agent = {...agent, rev: '2', working: [{id: 't-1'}], runs: [{id: 'r1', task_id: 't-1', provider: 'claude', status: 'running', approvals: [], events: [
        {t: 'text', text: 'Reviso poleana-game.'},
        {t: 'tool', name: 'Bash', input: {command: 'cd /srv/projects/poleana-game && git push origin preproduccion', description: 'Rama actualizada correctamente'}, status: 'done', t0: t - 40, t1: t - 28},
        {t: 'tool', name: 'Bash', input: {command: 'docker compose up -d'}, status: 'done', output: '4 servicios iniciados', t0: t - 27, t1: t - 1},
        {t: 'tool', name: 'Bash', input: {command: 'npm test', description: 'Ejecutando pruebas...'}, status: 'running', t0: t - 3},
        {t: 'text', text: 'Generando reporte...'}]}]};
      await page.locator('.general h1', {hasText: 'Ejecutando pruebas'}).waitFor({timeout: 8000});
      await page.locator('.general-project', {hasText: 'poleana-game'}).waitFor();
      const rows = page.locator('.activity-row');
      assert(await rows.count() === 3, 'Filas de actividad incorrectas');
      assert(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), 'La vista con actividad no cabe en pantalla');
      assert(/^git push origin preproduccion/.test(await rows.first().locator('code').innerText()) && /12s/.test(await rows.first().innerText()), 'Fila de git sin comando o duración');
      assert(await page.locator('.activity-row.running .ring').count() === 1, 'Sin indicador de la tarea en curso');
      assert(await orb.getAttribute('data-state') === 'working', 'La esfera no indica trabajo');
      await page.locator('.activity-typing', {hasText: 'Generando reporte'}).waitFor();
      const dimensions = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth}));
      assert(dimensions.scroll <= dimensions.width + 1, `Desbordamiento ${width}`);
      const orbBox = await orb.boundingBox(), navBox = mobile ? await page.locator('.bottom-nav').boundingBox() : null;
      if (navBox) assert(orbBox.y + orbBox.height <= navBox.y + 2, 'La esfera queda bajo la barra');
      await page.screenshot({path: `${out}/working-${width}.png`});

      // Menú: conversación completa en una hoja y atajo al proyecto.
      await page.getByRole('button', {name: 'Más opciones'}).click();
      await page.getByRole('menuitem', {name: 'Abrir poleana-game'}).waitFor();
      await page.getByRole('menuitem', {name: 'Ver conversación'}).click();
      await page.getByRole('dialog', {name: 'Conversación con el agente general'}).waitFor();
      await page.getByRole('button', {name: 'Cerrar', exact: true}).click();
      await page.getByRole('button', {name: 'Detener'}).click();
      assert(posts.some(p => p.path === '/api/runs/r1/stop'), 'Detener no llamó a la API');

      // Hablar: tocar la esfera escucha, tocar otra vez transcribe y el texto se envía solo.
      agent = {...agent, rev: '3', working: [], runs: [{...agent.runs[0], status: 'done', result: {text: 'Listo: **poleana-game** está en línea.'}}]};
      await page.locator('.last-reply', {hasText: 'poleana-game está en línea'}).waitFor({timeout: 8000});
      await orb.click();
      await page.waitForFunction(() => document.querySelector('.live-orb').dataset.state === 'listening', null, {timeout: 8000});
      await page.waitForTimeout(1500);
      await orb.click();
      await page.locator('.pending-message', {hasText: 'Revisa los logs de poleana'}).waitFor({timeout: 8000});
      await page.waitForFunction(() => !document.querySelector('.pending-message'), null, {timeout: 6000});
      const spoken = posts.filter(p => p.path === '/api/agent/send').at(-1);
      assert(/revisa los logs de poleana/i.test(spoken.text) && spoken.provider === 'claude', 'El dictado no se envió');

      // Crear proyectos sigue solo en Proyectos.
      await page.goto(`${base}/projects`);
      await page.locator('a.new-project-button', {hasText: 'Nuevo proyecto'}).waitFor();
      assert(errors.length === 0, errors.join('\n'));
      await context.close();
      console.log(`General agent OK at ${width}px`);
    }
    console.log('GENERAL_BROWSER_OK (360, 390, 1440)');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
