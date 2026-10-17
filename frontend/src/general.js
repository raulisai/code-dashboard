// Lógica del agente general (esfera central): de los eventos de una ejecución a titulares,
// filas de «Actividad en tiempo real» y texto para leer en voz alta. Sin React para poder probarla.
export const GENERAL = '_general';
export const generalHref = (chatId = 'main') => `/agent?chat=${encodeURIComponent(chatId)}`;
export const taskHref = task => task.project === GENERAL ? generalHref(task.chat_id || 'main') : `/p/${task.project}?chat=${encodeURIComponent(task.chat_id || 'main')}`;
export const projectLabel = name => name === GENERAL ? 'Agente general' : name;

const EXPLORE = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'ToolSearch']);
const EDIT = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'FileChange']);
const BASH_RULES = [
  [/\bgit\s+push\b/, 'git', 'Subiendo cambios'],
  [/\bgit\s+(commit|add)\b/, 'git', 'Guardando una versión'],
  [/\bgit\b/, 'git', 'Revisando Git'],
  [/\b(npm\s+(run\s+)?test|pytest|unittest|node\s+--test|playwright|vitest|jest|verify_[a-z_]+)\b/, 'test', 'Ejecutando pruebas'],
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
    const paths = event.name === 'FileChange' ? (input.changes || []).map(change => change.path) : [input.file_path || input.notebook_path];
    return {kind: 'edit', title: 'Editando archivos', command: clip(paths.filter(Boolean).map(shortPath).join(', ') || 'archivos', 70), note: ''};
  }
  if (EXPLORE.has(event.name)) return {kind: 'read', title: 'Revisando el código', command: clip(shortPath(input.file_path || input.path || input.pattern || ''), 70), note: ''};
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
    if (info.kind === 'read' && last?.kind === 'read' && !event.sub) {
      last.count += 1; last.command = `${last.count} archivos · ${info.command}`; last.status = event.status; last.t1 = event.t1 ?? last.t1; last.last = index;
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
  if (run.status === 'error') return {title: 'No se completó', subtitle: clip(run.error || run.result?.text || 'El agente terminó con un error', 140)};
  if (run.status === 'stopped') return {title: 'Detenido', subtitle: 'Puedes pedirme otra cosa'};
  return null;
}

/** Texto apto para voz: sin Markdown, código ni enlaces largos. */
export function speakable(text, limit = 700) {
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
