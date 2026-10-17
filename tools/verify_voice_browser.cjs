const {completeMfa} = require('./browser_auth.cjs');
/* Prueba con micrófono virtual REAL: captura MediaRecorder → HTTPS → Whisper CPU. */
const {chromium, webkit} = require(process.env.PLAYWRIGHT_MODULE || '/pw/playwright');
const fs = require('node:fs');
const base = 'https://codex-dashboard.devdj.lat';
const project = 'cm-voice-check-20261017';
const out = '/work/artifacts/voice-20261017';
const {execSync} = require('node:child_process');

async function login(page) {
  await page.goto(base); await page.getByLabel('Usuario', {exact: true}).fill(process.env.MONITOR_USER);
  await page.getByLabel('Contraseña', {exact: true}).fill(process.env.MONITOR_PASSWORD);
  await page.getByRole('button', {name: 'Entrar', exact: true}).click(); await completeMfa(page); await page.locator('.shell').waitFor();
  await page.goto(base + '/new'); await page.locator('.create').waitFor();
}

(async () => {
  fs.mkdirSync(out, {recursive: true});
  const browser = process.env.CM_BROWSER_MODE === 'webkit' ? null : await chromium.launch({args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-audio-capture=/work/artifacts/voice-20261017/peticion.wav']});
  const errors = [];
  if (browser) { try {
    const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, locale: 'es-MX', timezoneId: 'Europe/Berlin', permissions: ['microphone']});
    const page = await context.newPage(); page.on('pageerror', error => errors.push(String(error)));
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) console.log('PAGE:', frame.url()); });
    await login(page);
    const voiceStatus = await (await context.request.get(base + '/api/voice')).json();
    if (!voiceStatus.ready || !voiceStatus.local) throw new Error('Motor de voz no listo');
    await page.locator('.create textarea').fill('Contexto existente.');
    await page.getByRole('button', {name: 'Dictar por voz', exact: true}).click();
    await page.getByText('Te escucho. Habla con naturalidad.').waitFor();
    await page.waitForTimeout(1000); await page.getByRole('button', {name: 'Pausa', exact: true}).click();
    await page.getByText('En pausa. Continúa cuando quieras.').waitFor(); await page.waitForTimeout(500);
    await page.getByRole('button', {name: 'Continuar', exact: true}).click();
    await page.screenshot({path: `${out}/mobile-recording.png`, fullPage: true});
    await page.waitForTimeout(12000);
    await page.getByRole('button', {name: 'Terminar y transcribir', exact: true}).click();
    const transcript = page.getByLabel('Transcripción', {exact: true});
    await transcript.waitFor({timeout: 155000});
    const actual = await transcript.inputValue();
    if (!/aplicaci[oó]n|taquer/i.test(actual)) throw new Error('No reconoció el audio de prueba: ' + actual);
    fs.writeFileSync(`${out}/transcript.json`, JSON.stringify({text: actual}, null, 2));
    await page.screenshot({path: `${out}/mobile-transcript.png`, fullPage: true});
    await page.getByRole('button', {name: 'Insertar texto', exact: true}).click();
    const inserted = await page.locator('.create textarea').inputValue();
    if (!inserted.startsWith('Contexto existente.') || !inserted.includes(actual)) throw new Error('Se perdió texto al insertar dictado');
    // La captura vuelve a funcionar tras cancelar y después de una subida fallida.
    await page.getByRole('button', {name: 'Dictar por voz', exact: true}).click();
    await page.getByText('Te escucho. Habla con naturalidad.').waitFor();
    await page.waitForTimeout(1200);
    await page.route('**/api/voice/transcribe?*', route => route.abort('failed'));
    await page.getByRole('button', {name: 'Terminar y transcribir', exact: true}).click();
    await page.getByRole('button', {name: 'Reintentar audio', exact: true}).waitFor();
    if (await page.locator('.voice-audio audio').count() !== 1) throw new Error('Se perdió la grabación tras fallo de red');
    await page.unroute('**/api/voice/transcribe?*');
    await page.getByRole('button', {name: 'Cancelar dictado', exact: true}).click();
    const created = await context.request.post(base + '/api/projects', {data: {action: 'create', name: project, description: 'Prueba temporal de voz y papelera', stack: 'web', build: false, deploy: true}});
    if (created.status() !== 201) throw new Error(await created.text());
    await page.goto(base + '/p/' + project);
    await page.locator('.panel-agent > .agent').waitFor();
    await page.getByRole('button', {name: 'Dictar por voz', exact: true}).click();
    await page.getByText('Te escucho. Habla con naturalidad.').waitFor();
    await page.waitForTimeout(800);
    await page.route('**/api/voice/transcribe?*', route => route.fulfill({json: {text: 'Revisa el diseño del proyecto.', language: 'es', duration: 1, engine: 'whisper-small-local'}}));
    await page.getByRole('button', {name: 'Terminar y transcribir', exact: true}).click();
    await page.getByLabel('Transcripción', {exact: true}).waitFor();
    let sent;
    await page.route('**/api/agent/send', route => { sent = route.request().postDataJSON(); return route.fulfill({status: 201, json: {message: 'Prueba de envío', task: {id: 'test'}}}); });
    await page.getByRole('button', {name: /Enviar a (Claude|Codex)/}).click();
    await page.getByRole('dialog', {name: 'Dictar una petición'}).waitFor({state: 'hidden'});
    if (sent?.project !== project || sent?.text !== 'Revisa el diseño del proyecto.') throw new Error('El envío por voz perdió contexto');
    await page.unroute('**/api/agent/send'); await page.unroute('**/api/voice/transcribe?*');
    // Esperar el scaffold antes de ejercer la eliminación completa desde la UI.
    for (let i = 0; i < 100; i++) {
      const data = await (await context.request.get(base + '/api/jobs?project=' + project)).json();
      if (data.jobs?.[0]?.status === 'done') break;
      if (data.jobs?.[0]?.status === 'error') throw new Error(data.jobs[0].output);
      await page.waitForTimeout(1000);
    }
    const marker = await context.request.post(base + '/api/files/write', {data: {project, path: 'conservar.txt', content: 'DATOS_RECUPERABLES'}});
    if (marker.status() !== 200) throw new Error(await marker.text());
    await page.goto(base + '/projects');
    await page.getByLabel('Buscar proyecto', {exact: true}).fill(project);
    await page.getByRole('button', {name: 'Opciones del proyecto', exact: true}).click();
    await page.getByRole('button', {name: 'Eliminar proyecto', exact: true}).click();
    await page.getByLabel('Nombre para confirmar eliminación').fill('incorrecto');
    if (await page.getByRole('button', {name: 'Eliminar proyecto', exact: true}).isEnabled()) throw new Error('Borrado sin confirmación exacta');
    await page.getByLabel('Nombre para confirmar eliminación').fill(project);
    await page.screenshot({path: `${out}/mobile-delete-confirmation.png`, fullPage: true});
    await page.getByRole('button', {name: 'Eliminar proyecto', exact: true}).click();
    await page.getByText('La web está apagada y el proyecto ya no aparece en tu lista.').waitFor({timeout: 90000});
    await page.getByRole('button', {name: 'Volver a mis proyectos', exact: true}).click();
    await page.goto(base + '/settings');
    await page.locator('.trash-row').filter({hasText: project}).first().getByRole('button', {name: 'Restaurar', exact: true}).click();
    await page.getByText(project + ' restaurado.', {exact: false}).waitFor();
    const recovered = await context.request.get(base + '/api/files/read?project=' + project + '&path=conservar.txt');
    if ((await recovered.json()).content !== 'DATOS_RECUPERABLES') throw new Error('Restauración incompleta');
    // Retirar de nuevo solo nuestro proyecto; conservar evidencia en papelera para archivarla después.
    const deleted = await context.request.post(base + '/api/projects', {data: {action: 'delete', name: project, confirmation: project}});
    if (deleted.status() !== 202) throw new Error(await deleted.text());
    const deletion = await deleted.json();
    for (let i = 0; i < 90; i++) {
      const job = await (await context.request.get(base + '/api/jobs/' + deletion.job_id)).json();
      if (job.status === 'done') break;
      if (job.status === 'error') throw new Error(job.output);
      await page.waitForTimeout(1000);
    }
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('VOICE_BROWSER_OK: captura real, pausa, Whisper, inserción, fallo de red, envío, eliminación y restauración');
    await context.close();
  } finally { await browser.close(); } }
  // WebKit/Safari: la UI funciona y explica un micrófono denegado, sin desaparecer.
  const safari = await webkit.launch();
  try {
    const context = await safari.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, locale: 'es-MX'});
    await context.addInitScript(() => {
      // WebKit headless puede omitir MediaRecorder; en esta prueba no se llega
      // a usar, porque el permiso de entrada se deniega deliberadamente.
      if (!window.MediaRecorder) window.MediaRecorder = class {};
      Object.defineProperty(navigator, 'mediaDevices', {configurable: true, value: {getUserMedia: async () => { const error = new Error('denied'); error.name = 'NotAllowedError'; throw error; }}});
    });
    const page = await context.newPage(); await login(page);
    console.log('WEBKIT_CAPABILITIES:', await page.evaluate(() => ({recorder: typeof MediaRecorder, getUserMedia: String(navigator.mediaDevices?.getUserMedia)})));
    await page.getByRole('button', {name: 'Dictar por voz', exact: true}).click();
    await page.locator('.voice-error').waitFor();
    const message = await page.locator('.voice-error').innerText();
    if (!message.includes('El micrófono está bloqueado.')) throw new Error('Mensaje WebKit inesperado: ' + message);
    await page.screenshot({path: `${out}/webkit-permission-error.png`, fullPage: true});
    console.log('WEBKIT_VOICE_UI_OK: permiso denegado con recuperación');
  } finally { await safari.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
