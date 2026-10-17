/* Agente general compacto con UI real y API simulada: no lanza agentes ni transcribe audio real. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/home/dv1/.npm/_npx/fd3bca3c548369c0/node_modules/playwright-core');
const fs = require('node:fs');
const base = process.env.CM_TEST_URL || 'http://127.0.0.1:4178';
const out = process.env.CM_ARTIFACTS || 'artifacts/general-responsive-20261018';
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
async function checkLayout(page, name, width, height) {
  const metrics = await page.evaluate(() => {
    const rect = selector => { const el = document.querySelector(selector); if (!el || !el.getClientRects().length) return null;
      const {top, bottom, left, right, width, height} = el.getBoundingClientRect(); return {top, bottom, left, right, width, height}; };
    return {orb: rect('.live-orb'), header: rect('.general-top'), actions: rect('.general-actions'), response: rect('.general-response'),
      nav: rect('.bottom-nav'), width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth};
  });
  const fits = metrics.scroll <= metrics.width + 1 && metrics.orb.top >= metrics.header.bottom - 1
    && metrics.orb.bottom <= (metrics.response?.top ?? metrics.actions.top) + 1
    && metrics.actions.bottom <= (metrics.nav?.top ?? metrics.height) + 1;
  if (!fits) await page.screenshot({path: `${out}/layout-error-${name}-${width}x${height}.png`});
  assert(fits, `Elementos solapados o fuera de pantalla (${name}): ${JSON.stringify(metrics)}`);
}

(async () => {
  fs.mkdirSync(out, {recursive: true});
  const wav = require('node:path').resolve(out, 'tono.wav'); toneWav(wav);
  const browser = await chromium.launch({headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`]});
  try {
    const sizes = JSON.parse(process.env.CM_TEST_SIZES || '[[320,640],[360,740],[390,844],[768,1024],[1440,900],[740,390]]');
    for (const [width, height] of sizes) {
      console.log(`Checking general agent at ${width}px`);
      const mobile = width < 1024;
      const context = await browser.newContext({viewport: {width, height}, serviceWorkers: 'block', permissions: ['microphone'], locale: 'es-MX', hasTouch: mobile, isMobile: mobile});
      await context.addInitScript(() => { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; });
      const page = await context.newPage();
      const errors = [], posts = [];
      let rejectSend = false;
      let sequence = 0;
      let agent = {rev: '1', runs: [{id: 'old-run', task_id: 'old-task', provider: 'codex', status: 'done', approvals: [], events: [],
        prompt: 'Pregunta de una visita anterior', result: {text: 'Respuesta guardada de la visita anterior.'}}], queue: [], working: [], settings: {default_provider: 'codex'}};
      page.on('pageerror', error => { errors.push(String(error)); console.error('Browser error:', error.stack); });
      await context.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url());
        const data = request.method() === 'POST' && url.pathname !== '/api/voice/transcribe' ? request.postDataJSON() : {};
        if (request.method() === 'POST') posts.push({path: url.pathname, ...data});
        if (url.pathname === '/api/agent/send' && rejectSend) return route.fulfill({status: 503, json: {error: 'Fallo temporal de prueba'}});
        let result = {};
        if (url.pathname === '/api/state') result = {projects: [project('poleana-game', 4), project('codex-dashboard', 2), project('tacos', 0)], task_records: [], approvals: [], docker: [],
          memory: {}, disk: {}, tmux: [], automation: {}, cpu: {percent: 12}, tmux_ok: true, stacks: {auto: 'La IA decide'}, settings: {default_provider: 'codex'}, domain: 'devdj.lat'};
        else if (url.pathname === '/api/agent') result = agent;
        else if (url.pathname === '/api/agent/chats') result = {chats: [{id: 'main', title: 'Chat principal', working: 0, queued: 0}]};
        else if (url.pathname === '/api/voice/transcribe') result = {text: 'revisa los logs de poleana'};
        else if (url.pathname === '/api/voice') result = {ready: true, local: true};
        else if (url.pathname === '/api/agent/send') {
          const id = `sent-${++sequence}`;
          agent = {...agent, rev: id, working: [{id}], runs: [...agent.runs, {id: `r-${id}`, task_id: id, provider: data.provider,
            status: 'running', prompt: data.text, approvals: [], events: []}]};
          result = {message: 'Enviado', task: {id, project: data.project}};
        }
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
      const status = page.locator('.general-status'), label = page.locator('.general-state-label');
      await label.filter({hasText: 'Disponible'}).waitFor();
      const idleText = await page.locator('.general').innerText();
      assert(!/¿Qué hacemos hoy\?|\d+ proyectos ·|CPU \d+%|Pregunta de una visita anterior|Respuesta guardada de la visita anterior/.test(idleText), 'La entrada muestra información que no se ha pedido');
      assert(await page.locator('.general-suggestions').count() === 0, 'Siguen visibles las sugerencias permanentes');
      assert(await page.locator('.general-response').count() === 0, 'La respuesta de otra visita se abrió sola');
      await page.waitForTimeout(1200);
      const box = await orb.boundingBox();
      assert(Math.abs(box.x + box.width / 2 - (mobile ? width / 2 : (await page.locator('.general').boundingBox()).x + (await page.locator('.general').boundingBox()).width / 2)) < 3, 'La esfera no está centrada');
      assert(box.width >= Math.min(width * .28, height * .22), `Esfera pequeña: ${box.width}`);
      await page.screenshot({path: `${out}/idle-${width}x${height}.png`});
      assert(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), 'La vista en reposo no cabe en pantalla');
      await checkLayout(page, 'idle', width, height);

      // Las respuestas guardadas solo aparecen al pedirlas y se pueden volver a ocultar.
      await page.getByRole('button', {name: 'Ver respuesta', exact: true}).click();
      await page.locator('.general-response', {hasText: 'Respuesta guardada de la visita anterior.'}).waitFor();
      await page.waitForTimeout(650);
      await checkLayout(page, 'response', width, height);
      await page.screenshot({path: `${out}/response-${width}x${height}.png`});
      await page.getByRole('button', {name: 'Ocultar respuesta', exact: true}).click();
      assert(await page.locator('.general-response').count() === 0, 'No ocultó la respuesta');

      // Proveedor y mensaje escrito.
      assert(await page.getByRole('radio').count() === 0, 'La conversación expone el selector de proveedor');
      assert(await page.locator('.orb-particles').count() >= 3, 'No se comparte la nube de partículas');
      await page.getByRole('button', {name: 'Escribir'}).click();
      await page.locator('.general-compose textarea').fill('¿Cómo está el servidor?');
      await page.getByRole('button', {name: 'Enviar', exact: true}).click();
      await page.waitForFunction(() => !document.querySelector('.general-compose'));
      const sent = posts.find(p => p.path === '/api/agent/send');
      assert(sent && sent.project === '_general' && sent.provider === 'codex' && sent.chat_id === 'main' && sent.text === '¿Cómo está el servidor?', 'Mensaje mal enviado');
      await label.filter({hasText: 'Pensando'}).waitFor({timeout: 8000});
      agent = {...agent, rev: 'sent-done', working: [], runs: [...agent.runs.slice(0, -1), {...agent.runs.at(-1), status: 'done', result: {text: 'Respuesta nueva a tu solicitud.'}}]};
      await page.locator('.general-response', {hasText: 'Respuesta nueva a tu solicitud.'}).waitFor({timeout: 8000});
      await page.getByRole('button', {name: 'Ocultar respuesta', exact: true}).click();

      // Un fallo conserva el borrador y permite reintentar.
      rejectSend = true;
      await page.getByRole('button', {name: 'Escribir', exact: true}).click();
      await page.locator('.general-compose textarea').fill('Conserva este mensaje');
      await page.getByRole('button', {name: 'Enviar', exact: true}).click();
      await page.waitForTimeout(300);
      assert(await page.locator('.general-compose textarea').inputValue() === 'Conserva este mensaje', 'Se perdió el mensaje fallido');
      rejectSend = false;
      await page.getByRole('button', {name: 'Enviar', exact: true}).click();
      await page.waitForFunction(() => !document.querySelector('.general-compose'));

      // Trabajando: solo estado e icono; comandos y proyecto se consultan en el panel.
      const t = now();
      agent = {...agent, rev: '2', working: [{id: 't-1'}], runs: [{id: 'r1', task_id: 't-1', provider: 'claude', status: 'running', approvals: [], events: [
        {t: 'text', text: 'Reviso poleana-game.'},
        {t: 'tool', name: 'Bash', input: {command: 'cd /srv/projects/poleana-game && git push origin preproduccion', description: 'Rama actualizada correctamente'}, status: 'done', t0: t - 40, t1: t - 28},
        {t: 'tool', name: 'Bash', input: {command: 'docker compose up -d'}, status: 'done', output: '4 servicios iniciados', t0: t - 27, t1: t - 1},
        {t: 'tool', name: 'Bash', input: {command: 'npm test', description: 'Ejecutando pruebas...'}, status: 'running', t0: t - 3},
        {t: 'text', text: 'Generando reporte...'}]}]};
      await label.filter({hasText: 'Ejecutando pruebas'}).waitFor({timeout: 8000});
      assert(await status.getAttribute('data-kind') === 'test', 'El estado no identifica las pruebas');
      assert(!/git push|docker compose|Generando reporte|poleana-game/.test(await page.locator('.general').innerText()), 'Los detalles de actividad aparecen sin pedirlos');
      assert(await page.locator('.activity-row:visible').count() === 0, 'La actividad aparece desplegada');
      await page.waitForTimeout(800); // Esperar el cambio de tamaño suave antes de medir layout.
      assert(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), 'La vista con actividad no cabe en pantalla');
      assert(await orb.getAttribute('data-state') === 'working', 'La esfera no indica trabajo');
      await checkLayout(page, 'working', width, height);
      const dimensions = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth}));
      assert(dimensions.scroll <= dimensions.width + 1, `Desbordamiento ${width}`);
      const orbBox = await orb.boundingBox(), navBox = mobile ? await page.locator('.bottom-nav').boundingBox() : null;
      if (navBox) assert(orbBox.y + orbBox.height <= navBox.y + 2, 'La esfera queda bajo la barra');
      await page.screenshot({path: `${out}/working-${width}x${height}.png`});

      const activityButton = page.getByRole('button', {name: 'Ver actividad', exact: true});
      await activityButton.click();
      const details = page.getByRole('dialog', {name: 'Actividad del agente general', exact: true});
      await details.waitFor();
      assert(await details.evaluate(el => el.tagName === 'DIALOG' && el.open), 'Actividad no usa diálogo modal nativo');
      const rows = details.locator('.activity-row');
      assert(await rows.count() === 3, 'Filas de actividad incorrectas');
      await details.locator('.general-project', {hasText: 'poleana-game'}).waitFor();
      assert(/^git push origin preproduccion/.test(await rows.first().locator('code').innerText()) && /12s/.test(await rows.first().innerText()), 'Fila de git sin comando o duración');
      assert(await details.locator('.activity-row.running .ring').count() === 1, 'Sin indicador de la tarea en curso');
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        const focus = await details.evaluate(el => ({inside: el.contains(document.activeElement), tag: document.activeElement?.tagName,
          label: document.activeElement?.getAttribute('aria-label')}));
        if (!focus.inside) await page.screenshot({path: `${out}/focus-error-${width}x${height}.png`});
        assert(focus.inside, `El foco escapó del panel de actividad: ${JSON.stringify(focus)}`);
      }
      await details.getByRole('button', {name: 'Cerrar actividad'}).focus();
      await activityButton.evaluate(el => el.focus());
      assert(await details.evaluate(el => el.contains(document.activeElement)), 'El fondo del modal acepta foco');
      await page.keyboard.press('Escape');
      await details.waitFor({state: 'hidden'});
      assert(await activityButton.evaluate(el => el === document.activeElement), 'Cerrar actividad no devuelve el foco');

      // Al cambiar de herramienta se actualiza el icono y el texto desde eventos reales.
      const previousIcon = await page.locator('.orb-state-icon svg').innerHTML();
      agent = {...agent, rev: 'deploying', runs: [{...agent.runs[0], events: [
        ...agent.runs[0].events.map(event => event.t === 'tool' && event.status === 'running' ? {...event, status: 'done', t1: now()} : event),
        {t: 'tool', name: 'Bash', input: {command: 'docker compose up -d --build'}, status: 'running', t0: now()}]}]};
      await label.filter({hasText: 'Desplegando'}).waitFor({timeout: 8000});
      assert(await status.getAttribute('data-kind') === 'docker', 'El icono no cambió a Docker');
      assert(await page.locator('.orb-state-icon svg').innerHTML() !== previousIcon, 'El dibujo del icono no cambió');

      // Menú compacto y conversación completa en una hoja voluntaria.
      await page.getByRole('button', {name: 'Más opciones'}).click();
      await page.getByRole('button', {name: 'Ver proyectos', exact: true}).waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('button', {name: 'Ver conversación', exact: true}).click();
      await page.getByRole('dialog', {name: 'Conversación con el agente general'}).waitFor();
      assert(await page.getByRole('dialog').getByRole('radio').count() === 0, 'El historial muestra modelos');
      assert(await page.getByRole('dialog', {name: 'Conversación con el agente general'}).evaluate(el => el.tagName === 'DIALOG'), 'Historial no usa diálogo nativo');
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', {name: 'Conversación con el agente general'}).waitFor({state: 'hidden'});
      await activityButton.click();
      await details.getByRole('button', {name: /^Detener/}).click();
      assert(posts.some(p => p.path === '/api/runs/r1/stop'), 'Detener no llamó a la API');
      await page.keyboard.press('Escape');

      // Hablar: tocar la esfera escucha, tocar otra vez transcribe y el texto se envía solo.
      agent = {...agent, rev: '3', working: [], runs: [{...agent.runs[0], status: 'done', result: {text: 'Listo: **poleana-game** está en línea.'}}]};
      await label.filter({hasText: 'Disponible'}).waitFor({timeout: 8000});
      await orb.click();
      await page.waitForFunction(() => document.querySelector('.live-orb').dataset.state === 'listening', null, {timeout: 8000});
      await page.waitForTimeout(1500);
      await orb.click();
      await page.waitForFunction(() => !document.querySelector('.pending-message') && document.querySelector('.general-action.selected[aria-label="Terminar conversación"]'), null, {timeout: 8000});
      for (let attempt = 0; attempt < 50 && !posts.some(p=>p.path === '/api/agent/send' && /revisa los logs de poleana/i.test(p.text || '')); attempt++) await page.waitForTimeout(100);
      const spoken = posts.filter(p => p.path === '/api/agent/send').at(-1);
      assert(/revisa los logs de poleana/i.test(spoken.text) && spoken.provider === 'codex', 'El dictado no se envió');

      await page.getByRole('button', {name:'Terminar conversación',exact:true}).click();

      // Un viewport bajo (teclado móvil) conserva el compositor y la acción de enviar.
      if (width === 390) {
        await page.setViewportSize({width: 390, height: 480});
        await page.getByRole('button', {name: 'Escribir', exact: true}).click();
        await page.locator('.general-compose textarea').fill('Borrador con el teclado abierto');
        await page.waitForTimeout(500);
        const sendBox = await page.getByRole('button', {name: 'Enviar', exact: true}).boundingBox();
        assert(sendBox && sendBox.y >= 0 && sendBox.y + sendBox.height <= 481, 'Enviar quedó fuera del viewport con el teclado abierto');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'El compositor desborda horizontalmente');
        await page.getByRole('button', {name: 'Cerrar teclado'}).click();
        await page.setViewportSize({width, height});
      }
      await page.emulateMedia({reducedMotion: 'reduce'});
      await page.waitForTimeout(300);
      const still = await page.locator('.live-orb canvas').evaluate(el=>el.toDataURL());
      await page.waitForTimeout(250);
      assert(await page.locator('.live-orb canvas').evaluate(el=>el.toDataURL()) === still, 'No respeta movimiento reducido');
      // Crear proyectos sigue solo en Proyectos.
      await page.goto(`${base}/projects`);
      await page.locator('a.new-project-button', {hasText: 'Nuevo proyecto'}).waitFor();
      assert(errors.length === 0, errors.join('\n'));
      await context.close();
      console.log(`General agent OK at ${width}px`);
    }
    console.log('GENERAL_BROWSER_OK (320, 360, 390, 768, 1440, paisaje 740x390): información bajo demanda, iconos, actividad, voz y teclado');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
