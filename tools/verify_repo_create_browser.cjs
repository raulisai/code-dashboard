/* Crear desde repo Git y opción de GitHub con la UI real y API simulada: no crea proyectos ni contacta GitHub. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/home/dv1/.npm/_npx/fd3bca3c548369c0/node_modules/playwright-core');
const fs = require('node:fs');
const base = process.env.CM_TEST_URL || 'http://127.0.0.1:4178';
const out = process.env.CM_ARTIFACTS || 'artifacts/repo-create-20261017';
const assert = (ok, message) => { if (!ok) throw new Error(message); };
(async () => {
  fs.mkdirSync(out, {recursive: true});
  const browser = await chromium.launch({headless: true});
  try {
    for (const width of [360, 390, 1440]) {
      console.log(`Checking repo create at ${width}px`);
      const context = await browser.newContext({viewport: {width, height: 900}, serviceWorkers: 'block'});
      const page = await context.newPage();
      const errors = [], posts = [];
      let github = {connected: false, login: ''};
      page.on('pageerror', error => { errors.push(String(error)); console.error('Browser error:', String(error)); });
      await context.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url()), data = request.method() === 'POST' ? request.postDataJSON() : {};
        if (request.method() === 'POST') posts.push({path: url.pathname, ...data});
        let result = {}, status = 200;
        if (url.pathname === '/api/state') result = {projects: [], task_records: [], approvals: [], docker: [], memory: {}, disk: {}, tmux: [], automation: {},
          stacks: {auto: 'La IA decide', web: 'HTML + CSS + JS'}, settings: {default_provider: 'codex'}, domain: 'devdj.lat'};
        else if (url.pathname === '/api/security') result = {totp_enabled: true, sessions: [], recovery_remaining: 10};
        else if (url.pathname === '/api/projects/trash') result = {projects: []};
        else if (url.pathname === '/api/github') {
          if (data.action === 'connect') { github = {connected: true, login: 'raulisai', message: 'GitHub conectado como raulisai'}; }
          result = github;
        } else if (url.pathname === '/api/projects/repo-check') {
          if (data.url.includes('nada')) { status = 422; result = {message: 'El repositorio no existe o esta cuenta no tiene acceso'}; }
          else result = {url: 'git@github.com:raulisai/poleana_game.git', repo: 'poleana_game', suggested: 'poleana-game', default_branch: 'main', branches: ['main', 'diseno'], empty: false};
        } else if (url.pathname === '/api/projects') { status = 201; result = {message: 'Proyecto creado', project: data.name}; }
        await route.fulfill({status, json: result});
      });

      // Proyecto nuevo sin GitHub conectado: la opción se ve, desactivada, con enlace a Ajustes.
      await page.goto(`${base}/new`);
      const githubToggle = page.locator('label.toggle', {hasText: 'Crear también el repositorio en GitHub'});
      await githubToggle.locator('a', {hasText: 'Ajustes'}).waitFor();
      assert(await githubToggle.locator('input').isDisabled(), 'Opción de GitHub activa sin conexión');
      await page.screenshot({path: `${out}/new-disconnected-${width}.png`, fullPage: true});

      // Conectar en Ajustes y volver: la opción queda marcada por defecto.
      await page.goto(`${base}/settings`);
      await page.getByLabel('Token de GitHub', {exact: true}).fill('github_pat_' + 'A1'.repeat(20));
      await page.getByRole('button', {name: 'Conectar', exact: true}).click();
      await page.locator('.github-settings', {hasText: 'raulisai'}).waitFor();
      assert(posts.some(p => p.path === '/api/github' && p.action === 'connect'), 'No se envió el token');
      await page.goto(`${base}/new`);
      await page.locator('label.toggle', {hasText: 'En la cuenta raulisai'}).waitFor();
      assert(await githubToggle.locator('input').isChecked(), 'Crear repo no viene marcado');
      await page.locator('.create textarea').fill('Una tienda de tacos');
      await page.getByRole('button', {name: 'Crear y empezar a construir'}).click();
      await page.waitForFunction(() => location.pathname.startsWith('/p/'));
      const created = posts.find(p => p.path === '/api/projects');
      assert(created.github === true && !created.repo_url, 'Proyecto nuevo sin opción de GitHub');
      console.log('New project with GitHub OK');

      // Importar: error visible, luego URL válida con ramas; el envío lleva URL normalizada y rama.
      await page.goto(`${base}/new`);
      await page.getByRole('radio', {name: 'Desde un repo Git'}).click();
      const urlField = page.getByLabel('URL del repositorio', {exact: true});
      await urlField.fill('raulisai/nada');
      await page.locator('.repo-status.form-error', {hasText: 'no existe'}).waitFor();
      assert(await page.getByRole('button', {name: /Importar/}).isDisabled(), 'Se puede importar sin validar');
      await urlField.fill('https://github.com/raulisai/poleana_game');
      await page.locator('.repo-status.ok').waitFor();
      assert(await page.getByLabel('Nombre del proyecto').inputValue() === 'poleana-game', 'Nombre no sugerido desde el repo');
      assert(await page.locator('.stack-grid').count() === 0, 'Tecnología visible al importar código');
      assert(await githubToggle.count() === 0, 'Opción de GitHub visible al importar');
      await page.locator('.repo-branch select').selectOption('diseno');
      const dimensions = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth}));
      assert(dimensions.scroll <= dimensions.width + 1, `Desbordamiento ${width}`);
      await page.screenshot({path: `${out}/import-${width}.png`, fullPage: true});
      await page.getByRole('button', {name: 'Importar y adaptar'}).click();
      await page.waitForFunction(() => location.pathname.startsWith('/p/poleana-game'));
      const imported = posts.filter(p => p.path === '/api/projects').at(-1);
      assert(imported.repo_url === 'git@github.com:raulisai/poleana_game.git' && imported.repo_branch === 'diseno' && imported.build === true && imported.deploy === false, 'Importación mal enviada');
      console.log('Import OK');
      assert(errors.length === 0, errors.join('\n'));
      await context.close();
    }
    console.log('REPO_CREATE_BROWSER_OK (360, 390, 1440)');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
