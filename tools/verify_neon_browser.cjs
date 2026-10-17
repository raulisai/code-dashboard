const {completeMfa} = require('./browser_auth.cjs');
/* Validación de lectura: Inicio general y Proyectos individuales. No envía tareas. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/home/dv1/.npm/_npx/fd3bca3c548369c0/node_modules/playwright-core');
const fs = require('node:fs');
const base = process.env.CM_TEST_URL || 'https://codex-dashboard.devdj.lat';
const out = process.env.CM_ARTIFACTS || 'artifacts/overview-20261017';
const assert = (ok, message) => { if (!ok) throw new Error(message); };
(async () => {
  fs.mkdirSync(out, {recursive: true});
  const browser = await chromium.launch({headless: true});
  const errors = [];
  try {
    const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, locale: 'es-MX'});
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(base);
    await page.getByLabel('Usuario', {exact: true}).fill(process.env.MONITOR_USER);
    await page.getByLabel('Contraseña', {exact: true}).fill(process.env.MONITOR_PASSWORD);
    await page.getByRole('button', {name: 'Entrar', exact: true}).click(); await completeMfa(page);
    await page.locator('.dashboard-home').waitFor();
    const state = await (await context.request.get(base + '/api/state')).json();
    assert(await page.locator('.bottom-nav a').count() === 5, 'La barra debe tener cinco opciones');
    const width = async label => {
      const dims = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth}));
      assert(dims.scroll <= dims.width + 1, `Desbordamiento en ${label}: ${JSON.stringify(dims)}`);
    };
    const stat = async name => Number(await page.locator(`[data-stat="${name}"] .stat-value`).innerText());
    assert(await stat('projects') === state.projects.length, 'El total de proyectos no coincide');
    assert(await stat('online') === state.projects.filter(p => p.running_containers > 0).length, 'El total en línea no coincide');
    assert(await stat('working') === state.task_records.filter(t => t.status === 'working').length, 'El trabajo en curso no coincide');
    assert(await stat('pending') === state.task_records.filter(t => t.status === 'espera').length, 'Las peticiones pendientes no coinciden');
    assert(await page.locator('.dashboard-server .meter').count() === 3, 'Faltan métricas del servidor');
    assert(await page.locator('.project-overview').count() === 0, 'Inicio sigue mostrando un proyecto individual');
    await width('home 390');
    await page.screenshot({path: `${out}/mobile-home-390.png`, fullPage: true});
    await page.locator('.bottom-nav').getByRole('link', {name: 'Proyectos', exact: true}).click();
    await page.locator('.project-identity h2').waitFor();
    assert(new URL(page.url()).pathname === '/projects', 'El carrusel debe estar en Proyectos');
    assert(await page.getByRole('link', {name: 'Nuevo proyecto', exact: true}).isVisible(), 'Falta Nuevo proyecto');
    assert(await page.getByLabel('Buscar proyecto', {exact: true}).isVisible(), 'Falta el buscador');
    const current = await page.locator('.project-identity h2').innerText();
    const project = state.projects.find(p => p.name === current.trim());
    assert(project, 'El resumen no corresponde a un proyecto real');
    assert((await page.locator('.project-online').innerText()).includes(`${project.running_containers}/${project.container_details.length}`), 'Contador de servicios incorrecto');
    await page.locator('.project-art').evaluate(img => img.decode());
    await page.screenshot({path: `${out}/mobile-projects.png`, fullPage: true});
    await page.getByRole('button', {name: 'Proyecto siguiente', exact: true}).click();
    assert((await page.locator('.project-identity h2').innerText()) !== current, 'El carrusel no cambia');
    await page.getByRole('button', {name: 'Proyecto anterior', exact: true}).click();
    assert((await page.locator('.project-identity h2').innerText()) === current, 'El carrusel no vuelve');
    await page.getByLabel('Buscar proyecto', {exact: true}).fill('  codex-dashboard  ');
    await page.waitForFunction(() => document.querySelector('.project-identity h2')?.textContent === 'codex-dashboard');
    assert(await page.locator('.carousel-pagination button').count() === 1, 'El filtro no limita el carrusel');
    assert(await page.getByRole('button', {name: 'Proyecto siguiente', exact: true}).count() === 0, 'No debe navegar fuera de resultados');
    await page.getByLabel('Buscar proyecto', {exact: true}).fill('no-existe-cm-overview-test');
    await page.getByText('No hay coincidencias', {exact: true}).waitFor();
    assert(await page.locator('.project-overview').count() === 0, 'Se conserva un proyecto ajeno al filtro');
    await page.getByRole('link', {name: 'Nuevo proyecto', exact: true}).click();
    await page.locator('.create').waitFor();
    assert(await page.getByRole('button', {name: 'Dictar por voz', exact: true}).isVisible(), 'Falta dictado en la creación');
    await page.locator('.bottom-nav').getByRole('link', {name: 'Proyectos', exact: true}).click();
    await page.getByLabel('Buscar proyecto', {exact: true}).fill('codex-dashboard');
    await page.getByRole('button', {name: 'Limpiar búsqueda', exact: true}).click();
    assert(await page.locator('.carousel-pagination button').count() === state.projects.length, 'Limpiar no recupera todos los proyectos');
    await page.getByRole('button', {name: 'Opciones del proyecto', exact: true}).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button', {name: 'Ajustes', exact: true}).click();
    await page.locator('.settings').waitFor(); await width('settings');
    for (const [label, path, selector] of [['Crear', '/new', '.create'], ['Cola', '/queue', '.task-list, .empty'], ['Servidor', '/server', '.meters.big'], ['Inicio', '/', '.dashboard-home'], ['Proyectos', '/projects', '.project-identity']]) {
      await page.locator('.bottom-nav').getByRole('link', {name: label, exact: true}).click();
      await page.locator(selector).first().waitFor();
      assert(new URL(page.url()).pathname === path, `Navegación incorrecta: ${label}`);
      await width(label);
    }
    await page.locator('.project-tool-dock').getByRole('link', {name: 'Archivos', exact: true}).click();
    await page.locator('.panel-files:not([hidden])').waitFor(); await width('workspace files');
    for (const tab of ['agent', 'preview', 'console', 'git', 'deploy']) {
      await page.goto(`${base}/p/codex-dashboard?tab=${tab}`);
      await page.locator(`.panel-${tab}:not([hidden])`).waitFor(); await width(`workspace ${tab}`);
    }
    await page.goto(`${base}/p/codex-dashboard?tab=agent`);
    await page.locator('.panel-agent:not([hidden])').waitFor();
    assert(await page.getByRole('button', {name: 'Dictar por voz', exact: true}).isVisible(), 'Falta dictado en el agente');
    for (const size of [{width: 360, height: 800}, {width: 768, height: 1024}, {width: 1440, height: 1000}]) {
      await page.setViewportSize(size);
      await page.goto(base); await page.locator('.dashboard-home').waitFor(); await width(`home ${size.width}`);
      await page.screenshot({path: `${out}/home-${size.width}.png`, fullPage: true});
      await page.goto(base + '/projects'); await page.locator('.project-identity').waitFor(); await page.locator('.project-art').evaluate(img => img.decode());
      await width(`projects ${size.width}`); await page.screenshot({path: `${out}/projects-${size.width}.png`, fullPage: true});
    }
    // Estados alternativos solo en el navegador, sin cambiar datos del servidor.
    let fixture = {...state, task_records: [{id: 'fixture-only-pending', project: 'codex-dashboard', provider: 'codex', status: 'espera', title: 'Petición de prueba local'}], approvals: [{id: 'fixture-only-approval', project: 'codex-dashboard', provider: 'claude'}]};
    await page.route('**/api/state', route => route.fulfill({json: fixture}));
    await page.goto(base); await page.locator('.dashboard-home').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-stat="pending"] .stat-value')?.textContent === '1');
    assert(await stat('pending') === 1, 'Falta indicador de pendientes');
    assert((await page.locator('.dashboard-pending').innerText()).includes('Petición de prueba local'), 'Falta detalle de pendientes');
    assert(await page.locator('.dashboard-approval').isVisible(), 'Falta aviso de aprobación');
    fixture = {...state, projects: [], task_records: [], approvals: []};
    await page.goto(base); await page.locator('.dashboard-home').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-stat="projects"] .stat-value')?.textContent === '0');
    assert(await stat('projects') === 0, 'No se admite el estado sin proyectos');
    await page.goto(base + '/projects'); await page.getByText('Tu próximo proyecto empieza aquí', {exact: true}).waitFor();
    assert(await page.getByRole('link', {name: 'Nuevo proyecto', exact: true}).isVisible(), 'No se puede crear el primer proyecto');
    await page.unroute('**/api/state');
    await page.setViewportSize({width: 390, height: 844});
    await page.goto(base); await page.locator('.dashboard-home').waitFor();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload(); await page.locator('.dashboard-home').waitFor();
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    await page.goto(base + '/projects'); await page.locator('.project-identity').waitFor(); await page.locator('.project-art').evaluate(img => img.decode());
    await context.setOffline(true); await page.reload({waitUntil: 'domcontentloaded'});
    await page.locator('.project-identity').waitFor({timeout: 12000});
    assert(await page.locator('.project-art').evaluate(img => img.complete && img.naturalWidth > 0), 'El arte no se conserva sin conexión');
    await page.locator('.bottom-nav').getByRole('link', {name: 'Inicio', exact: true}).click();
    await page.locator('.dashboard-home').waitFor();
    await context.setOffline(false);
    assert(errors.length === 0, errors.join('\n'));
    console.log('OVERVIEW_BROWSER_OK: Inicio general con datos reales; Proyectos individuales con búsqueda, creación y herramientas; estados de pendientes/aprobaciones/vacío; móvil 360/390, tableta 768, escritorio 1440 y PWA offline. Sin mutaciones del servidor.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
