import test from 'node:test';
import assert from 'node:assert/strict';
import {GENERAL, activityRows, classify, detectProject, duration, headline, planOf, presence, projectLabel, speakable, taskHref} from '../src/general.js';

const bash = (command, extra = {}) => ({t: 'tool', name: 'Bash', input: {command}, status: 'done', ...extra});

test('los comandos se clasifican como en la actividad en tiempo real', () => {
  assert.deepEqual([classify(bash('git push origin preproduccion')).kind, classify(bash('docker compose up -d --build')).title],
    ['git', 'Desplegando']);
  assert.equal(classify(bash('npm test')).kind, 'test');
  assert.equal(classify(bash('curl -sI https://poleana-game.devdj.lat')).kind, 'web');
  assert.equal(classify(bash('df -h')).kind, 'server');
  assert.equal(classify({t: 'tool', name: 'Edit', input: {file_path: '/srv/projects/poleana-game/app.py'}}).command, 'poleana-game/app.py');
  assert.equal(classify({t: 'tool', name: 'mcp__github__create_issue', input: {}}).command, 'github · create_issue');
});

test('las lecturas seguidas se agrupan y se muestran solo las últimas filas', () => {
  const events = [
    {t: 'tool', name: 'Read', input: {file_path: '/srv/projects/a/x.py'}, status: 'done'},
    {t: 'tool', name: 'Grep', input: {pattern: 'def main'}, status: 'done'},
    {t: 'tool', name: 'TodoWrite', input: {}, status: 'done'},
    bash('git push origin main', {output: 'ok\nRama actualizada', t0: 10, t1: 22}),
    bash('docker compose up -d', {status: 'running', t0: 30}),
  ];
  const rows = activityRows(events, 4);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].count, 2);
  assert.equal(rows[1].detail, 'Rama actualizada');
  assert.equal(duration(rows[1]), '12s');
  assert.equal(rows[2].detail, 'En curso…');
  assert.equal(duration(rows[2], 125), '1m 35s');
  assert.equal(activityRows(events, 2).length, 2);
});

test('detecta el proyecto por rutas o cd, solo si existe', () => {
  const names = ['poleana-game', 'codex-dashboard'];
  assert.equal(detectProject([bash('cd /srv/projects/poleana-game && docker compose ps')], names), 'poleana-game');
  assert.equal(detectProject([bash('cd codex-dashboard && git status')], names), 'codex-dashboard');
  assert.equal(detectProject([bash('cd /srv/projects/inexistente')], names), '');
});

test('el titular resume el estado del agente', () => {
  assert.equal(headline(null), null);
  assert.equal(headline(null, 1).title, 'En cola');
  assert.equal(headline({status: 'running', events: [bash('npm test', {status: 'running'})]}).title, 'Ejecutando pruebas');
  assert.equal(headline({status: 'running', approvals: [{id: 1}], events: []}).title, 'Esperando tu permiso');
  assert.equal(headline({status: 'running', events: [{t: 'text', text: 'Listo, ya revisé'}]}).title, 'Respondiendo');
  assert.equal(headline({status: 'done', events: []}), null);
});

test('el texto para voz no lee Markdown, código ni enlaces', () => {
  const text = speakable('## Listo\n- Desplegué **poleana-game** en https://x.devdj.lat\n```bash\nls\n```\nUsa `docker ps`.');
  assert.equal(text, 'Listo Desplegué poleana-game en Usa docker ps.');
  assert.ok(speakable('Hola. '.repeat(400), 100).length <= 100);
});

test('las tareas del agente general enlazan a su vista', () => {
  assert.equal(taskHref({project: GENERAL, chat_id: 'main'}), '/agent?chat=main');
  assert.equal(taskHref({project: 'poleana-game', chat_id: 'c-1'}), '/p/poleana-game?chat=c-1');
  assert.equal(projectLabel(GENERAL), 'Agente general');
});


test('la presencia distingue actividad real, voz, cola y reposo sin datos permanentes', () => {
  assert.deepEqual(presence(), {kind: 'idle', title: 'Disponible'});
  assert.deepEqual(presence({run: {status: 'done', result: {text: 'Respuesta anterior'}}}), {kind: 'idle', title: 'Disponible'});
  assert.equal(presence({phase: 'listening', run: {status: 'running'}}).kind, 'listening');
  assert.equal(presence({phase: 'transcribing'}).title, 'Transcribiendo');
  assert.equal(presence({speaking: true}).kind, 'speaking');
  assert.equal(presence({queued: 2}).kind, 'queue');
  assert.equal(presence({sending: true}).title, 'Enviando');
  assert.equal(presence({connected: false}).title, 'Conectando');
  assert.equal(presence({run: {status: 'stopping'}}).kind, 'stopping');
  assert.equal(presence({run: {status: 'running', approvals: [{id: 1}]}}).kind, 'approval');
  const run = {status: 'running', events: [bash('npm test', {status: 'running'}), bash('git status')]};
  assert.deepEqual(presence({run}), {kind: 'test', title: 'Ejecutando pruebas'});
  run.events[0].status = 'done';
  run.events.push(bash('docker compose up -d --build', {status: 'running'}));
  assert.deepEqual(presence({run}), {kind: 'docker', title: 'Desplegando'});
  assert.equal(presence({run: {status: 'error', providers_tried: 'codex,claude'}}).title, 'Ahora no hay conexión disponible');
  assert.equal(presence({error: 'Sin red', phase: 'listening'}).kind, 'error');
  // Respuesta que no se leyó en voz alta: se avisa sin mostrar el texto; hablando manda la voz.
  assert.deepEqual(presence({ready: true, run: {status: 'done'}}), {kind: 'done', title: 'Respuesta lista'});
  assert.equal(presence({ready: true, speaking: true}).kind, 'speaking');
  assert.ok(speakable('Frase corta. '.repeat(100)).length <= 420);
});

test('acciones con su propia animación: código, terminal, base de datos, lectura y búsqueda', () => {
  const edit = path => classify({t: 'tool', name: 'Write', input: {file_path: path}});
  assert.deepEqual([edit('/srv/projects/a/src/app.jsx').title, edit('/srv/projects/a/README.md').title], ['Escribiendo código', 'Editando archivos']);
  assert.equal(classify({t: 'tool', name: 'FileChange', input: {changes: [{path: 'notas.txt'}, {path: 'main.py'}]}}).title, 'Escribiendo código');
  for (const command of ['docker compose exec db psql -c "select 1"', 'sqlite3 data.db ".tables"', 'redis-cli ping', 'echo "SELECT id FROM users" | mysql app'])
    assert.equal(classify(bash(command)).kind, 'database', command);
  assert.equal(classify(bash('apt-get update && apt-get install -y jq')).kind, 'package');
  assert.equal(classify(bash('ls -la')).kind, 'terminal');
  assert.deepEqual([classify({t: 'tool', name: 'Read', input: {file_path: '/srv/projects/a/x.py'}}).kind, classify({t: 'tool', name: 'Grep', input: {pattern: 'main'}}).kind], ['read', 'search']);
});

test('la presencia anticipa lo que va a mostrar y distingue responder de pensar', () => {
  const running = events => presence({run: {status: 'running', events}});
  assert.deepEqual(running([{t: 'thinking', text: '…'}]), {kind: 'thinking', title: 'Pensando'});
  assert.deepEqual(running([{t: 'text', text: 'Listo, ya revisé'}]), {kind: 'respond', title: 'Respondiendo'});
  assert.deepEqual(running([{t: 'text', text: 'Mira:\n```cm-ui\n{"type":"table","columns":['}]), {kind: 'table', title: 'Armando una tabla'});
  assert.equal(running([{t: 'text', text: '```cm-ui\n{"type":"image"'}]).kind, 'image');
  assert.equal(running([{t: 'text', text: '```cm-ui\n{"type":"chart","values":[1]}\n```'}]).kind, 'respond');
});

test('el plan del agente sale de TodoWrite o de la lista de Codex', () => {
  const todos = [{content: 'Compilar', status: 'completed'}, {content: 'Desplegar', activeForm: 'Desplegando', status: 'in_progress'}, {content: 'Verificar', status: 'pending'}];
  assert.deepEqual(planOf([{t: 'tool', name: 'TodoWrite', input: {todos: [{content: 'Viejo', status: 'pending'}]}}, {t: 'tool', name: 'TodoWrite', input: {todos}}]),
    [{text: 'Compilar', status: 'done'}, {text: 'Desplegando', status: 'running'}, {text: 'Verificar', status: 'pending'}]);
  assert.deepEqual(planOf([{t: 'todo', items: [{content: 'Uno', status: 'completed'}, {content: 'Dos', status: 'pending'}]}]).map(step => step.status), ['done', 'pending']);
  assert.deepEqual(planOf([bash('ls')]), []);
});
