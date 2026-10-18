// Lógica del agente general (esfera central): de los eventos de una ejecución a titulares,
// filas de «Actividad en tiempo real» y texto para leer en voz alta. Sin React para poder probarla.
import {draftingType} from './presentations.js';

export const GENERAL = '_general';
export const generalHref = (chatId = 'main') => `/agent?chat=${encodeURIComponent(chatId)}`;
export const taskHref = task => task.project === GENERAL ? generalHref(task.chat_id || 'main') : `/p/${task.project}?chat=${encodeURIComponent(task.chat_id || 'main')}`;
export const projectLabel = name => name === GENERAL ? 'Agente general' : name;

const READ = new Set(['Read', 'NotebookRead']), SEARCH = new Set(['Glob', 'Grep', 'LS', 'ToolSearch']), EXPLORE_KINDS = new Set(['read', 'search']);
// Archivos de código: escribirlos se muestra como «Escribiendo código»; el resto, «Editando archivos».
const CODE_FILE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kts?|rb|php|c|h|cc|cpp|hpp|cs|swift|s?css|sass|less|html?|vue|svelte|astro|sh|bash|zsh|sql|ya?ml|toml|json|lua|dart|ex|exs|erl|scala|r|pl|dockerfile)$|(?:^|\/)(?:Dockerfile|Makefile|compose\.ya?ml)$/i;
const EDIT = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'FileChange']);
const BASH_RULES = [
  [/\bgit\s+push\b/, 'git', 'Subiendo cambios'],
  [/\bgit\s+(commit|add)\b/, 'git', 'Guardando una versión'],
  [/\bgit\b/, 'git', 'Revisando Git'],
  [/\b(npm\s+(run\s+)?test|pytest|unittest|node\s+--test|playwright|vitest|jest|verify_[a-z_]+)\b/, 'test', 'Ejecutando pruebas'],
  [/\b(psql|mysql|mariadb|sqlite3|mongosh|mongo|redis-cli|clickhouse-client|pg_dump|pg_restore|mysqldump|alembic)\b|\bprisma\s+(db|migrate)\b|\b(SELECT\b[\s\S]*\bFROM|INSERT\s+INTO|UPDATE\b[\s\S]*\bSET|DELETE\s+FROM)\b/, 'database', 'Consultando la base de datos'],
  [/\bdocker\s+(compose\s+)?(up|build|restart|pull)\b/, 'docker', 'Desplegando'],
  [/\bdocker\b/, 'docker', 'Revisando contenedores'],
  [/\b(npm|pnpm|yarn|pip|apt(-get)?)\s+(install|ci|add|upgrade)\b/, 'package', 'Instalando dependencias'],
  [/\b(curl|wget)\b|https?:\/\//, 'web', 'Verificando la web'],
  [/\b(df|du|free|uptime|top|htop|systemctl|journalctl|ps|ss|netstat)\b/, 'server', 'Revisando el servidor'],
  [/\b(npm\s+run\s+build|vite\s+build|make|cargo\s+build|go\s+build)\b/, 'build', 'Compilando'],
];

const clip = (text, limit) => { const value = String(text || '').replace(/\s+/g, ' ').trim(); return value.length > limit ? `${value.slice(0, limit - 1)}…` : value; };
const firstLine = text => String(text || '').split('\n').map(line => line.trim()).find(Boolean) || '';
const lastLine = text => String(text || '').split('\n').map(line => line.trim()).filter(Boolean).at(-1) || '';
const shortPath = path => String(path || '').replace(/^\/srv\/projects\//, '');
// «cd /srv/projects/x && git push» se muestra como «git push»: la carpeta ya se ve en el proyecto detectado.
const withoutCd = command => command.replace(/^\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*/, '');

export function classify(event) {
  const input = event.input || {};
  if (event.name === 'Bash') {
    const command = String(input.command || '');
    const rule = BASH_RULES.find(([pattern]) => pattern.test(command));
    return {kind: rule ? rule[1] : 'terminal', title: rule ? rule[2] : 'Ejecutando comandos', command: clip(withoutCd(firstLine(command)), 70), note: input.description || ''};
  }
  if (EDIT.has(event.name)) {
    const paths = (event.name === 'FileChange' ? (input.changes || []).map(change => change.path) : [input.file_path || input.notebook_path]).filter(Boolean);
    return {kind: 'edit', title: paths.some(path => CODE_FILE.test(path)) ? 'Escribiendo código' : 'Editando archivos', command: clip(paths.map(shortPath).join(', ') || 'archivos', 70), note: ''};
  }
  if (READ.has(event.name)) return {kind: 'read', title: 'Leyendo archivos', command: clip(shortPath(input.file_path || input.notebook_path || ''), 70), note: ''};
  if (SEARCH.has(event.name)) return {kind: 'search', title: 'Buscando en el código', command: clip(shortPath(input.pattern || input.path || input.query || ''), 70), note: ''};
  if (event.name === 'WebFetch' || event.name === 'WebSearch') return {kind: 'web', title: 'Buscando en la web', command: clip(input.url || input.query || '', 70), note: ''};
  if (event.name === 'Task' || event.name === 'Agent') return {kind: 'agent', title: 'Delegando una tarea', command: clip(input.description || 'Subagente', 70), note: ''};
  return {kind: 'terminal', title: 'Usando herramientas', command: clip(String(event.name || '').replace(/^mcp(__|:)/, '').replace(/__|\//g, ' · '), 70), note: ''};
}

/** Últimas filas de actividad. Las lecturas seguidas se agrupan para que no tapen lo importante. */
export function activityRows(events, limit = 4) {
  const rows = [];
  (events || []).forEach((event, index) => {
    if (event.t !== 'tool' || event.name === 'TodoWrite') return;
    const info = classify(event), last = rows.at(-1);
    if (EXPLORE_KINDS.has(info.kind) && EXPLORE_KINDS.has(last?.kind) && !event.sub) {
      last.count += 1; last.kind = info.kind; last.title = info.title; last.command = `${last.count} archivos · ${info.command}`; last.status = event.status; last.t1 = event.t1 ?? last.t1; last.last = index;
      return;
    }
    const detail = event.status === 'running' ? (info.note || 'En curso…')
      : event.status === 'error' ? clip(lastLine(event.output) || 'Falló', 80) : clip(info.note || lastLine(event.output) || 'Hecho', 80);
    // first/last: posición de los eventos, para cronometrar en el navegador los que no traen hora (Codex).
    rows.push({...info, count: 1, detail, status: event.status, t0: event.t0 ?? null, t1: event.t1 ?? null, exit: event.exit_code, first: index, last: index});
  });
  return rows.slice(-limit);
}

/** Último proyecto mencionado en rutas o comandos (`/srv/projects/<nombre>` o `cd <nombre>`). */
export function detectProject(events, names = []) {
  const known = new Set(names);
  let found = '';
  for (const event of events || []) {
    if (event.t !== 'tool') continue;
    const text = JSON.stringify(event.input || {});
    for (const match of text.matchAll(/\/srv\/projects\/([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)/g)) if (!known.size || known.has(match[1])) found = match[1];
    const cd = String(event.input?.command || '').match(/(?:^|&&|;)\s*cd\s+([a-z0-9][a-z0-9-]{0,39})(?:\s|$|&|;)/);
    if (cd && known.has(cd[1])) found = cd[1];
  }
  return found;
}

export function duration(row, now = Date.now() / 1000) {
  if (!row.t0) return '';
  const seconds = Math.max(0, Math.round((row.t1 || now) - row.t0));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/** Titular superior: qué hace ahora el agente (o el estado en reposo). */
export function headline(run, queued = 0) {
  if (!run) return queued ? {title: 'En cola', subtitle: 'Empieza en un momento…'} : null;
  const events = run.events || [];
  const latestText = clip(firstLine([...events].reverse().find(event => event.t === 'text' && !event.sub)?.text), 110);
  if (run.status === 'stopping') return {title: 'Deteniendo…', subtitle: ''};
  if (run.status === 'running') {
    const tools = events.filter(event => event.t === 'tool' && event.name !== 'TodoWrite');
    const current = tools.at(-1);
    if ((run.approvals || []).length) return {title: 'Esperando tu permiso', subtitle: latestText};
    if (current?.status === 'running') {
      const info = classify(current);
      return {title: info.title, subtitle: info.note || latestText || info.command};
    }
    return {title: events.at(-1)?.t === 'text' ? 'Respondiendo' : 'Pensando', subtitle: latestText};
  }
  if (run.status === 'error' && String(run.providers_tried || '').includes(',')) return {title:'Ahora no hay conexión disponible', subtitle:'Probé las dos conexiones. Puedes reintentar cuando se restablezcan.'};
  if (run.status === 'error') return {title: 'No se completó', subtitle: clip(run.error || run.result?.text || 'El agente terminó con un error', 140)};
  if (run.status === 'stopped') return {title: 'Detenido', subtitle: 'Puedes pedirme otra cosa'};
  return null;
}

const DRAFTS = {chart: ['chart', 'Preparando una gráfica'], stats: ['chart', 'Calculando datos'], progress: ['chart', 'Actualizando el progreso'],
  table: ['table', 'Armando una tabla'], image: ['image', 'Preparando una imagen'], file: ['image', 'Preparando un archivo'],
  html: ['image', 'Diseñando una vista'], code: ['edit', 'Escribiendo código'], visual: ['visual', 'Preparando una vista']};

/** Plan del agente (TodoWrite de Claude o lista de Codex): pasos con estado done/running/pending. */
export function planOf(events) {
  for (let index = (events || []).length - 1; index >= 0; index--) {
    const event = events[index];
    const items = event.t === 'tool' && event.name === 'TodoWrite' ? event.input?.todos : event.t === 'todo' ? event.items : null;
    if (!Array.isArray(items)) continue;
    return items.filter(item => item && typeof item === 'object').slice(0, 30).map(item => {
      const status = item.status === 'completed' ? 'done' : item.status === 'in_progress' ? 'running' : 'pending';
      return {text: clip(status === 'running' && item.activeForm ? item.activeForm : item.content, 90), status};
    });
  }
  return [];
}

/** Estado compacto de la esfera: solo actividad real, sin resumir proyectos ni comandos. */
export function presence({run, queued = 0, phase = 'idle', speaking = false, sending = false, connected = true, error = '', ready = false} = {}) {
  if (error) return {kind: 'error', title: 'Necesito tu atención', subtitle: error};
  if (phase === 'opening') return {kind: 'listening', title: 'Abriendo micrófono'};
  if (phase === 'listening') return {kind: 'listening', title: 'Te escucho'};
  if (phase === 'transcribing') return {kind: 'transcribing', title: 'Transcribiendo'};
  if (sending) return {kind: 'thinking', title: 'Enviando'};
  if (speaking) return {kind: 'speaking', title: 'Hablando'};
  if (!connected) return {kind: 'thinking', title: 'Conectando'};
  if (run?.status === 'running') {
    if ((run.approvals || []).length) return {kind: 'approval', title: 'Esperando tu permiso'};
    const tool = [...(run.events || [])].reverse().find(event => event.t === 'tool' && event.name !== 'TodoWrite' && event.status === 'running');
    if (tool) { const info = classify(tool); return {kind: info.kind, title: info.title}; }
    const last = run.events?.at(-1);
    if (last?.t !== 'text') return {kind: 'thinking', title: 'Pensando'};
    // Escribiendo un bloque cm-ui: la esfera anticipa qué va a mostrar.
    const draft = DRAFTS[draftingType(last.text)];
    return draft ? {kind: draft[0], title: draft[1]} : {kind: 'respond', title: 'Respondiendo'};
  }
  if (run?.status === 'stopping') return {kind: 'stopping', title: 'Deteniendo'};
  if (queued) return {kind: 'queue', title: 'En cola'};
  if (run?.status === 'error') return {kind: 'error', ...headline(run)};
  if (run?.status === 'stopped') return {kind: 'stopping', title: 'Detenido'};
  // Respuesta que no se pudo leer en voz alta: se avisa, pero el texto sigue oculto hasta pedirlo.
  if (ready) return {kind: 'done', title: 'Respuesta lista'};
  return {kind: 'idle', title: 'Disponible'};
}

/** Texto apto para voz: sin Markdown, código ni enlaces largos, y corto (unos 25 s). */
export function speakable(text, limit = 420) {
  const plain = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_~|>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= limit) return plain;
  const cut = plain.slice(0, limit);
  return cut.slice(0, Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '), limit * .6) + 1).trim();
}
