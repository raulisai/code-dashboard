// Protocolo `cm-ui`: bloques ```cm-ui con JSON que el agente usa para mostrar datos, imágenes y vistas.
// Todo se valida y acota aquí (sin React) para poder probarlo.
export const PRESENTATION_TYPES = ['chart', 'table', 'html', 'file', 'stats', 'progress', 'image', 'code'];
const FENCE = '```cm-ui';
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'];

export function presentationParts(value) {
  const text = String(value || ''), parts = []; let offset = 0, count = 0;
  const pattern = /```cm-ui\s*\n([\s\S]*?)```/g;
  for (const match of text.matchAll(pattern)) {
    if (match.index > offset) parts.push({text: text.slice(offset, match.index)});
    try {
      if (++count > 6 || match[1].length > 64000) throw Error();
      const spec = JSON.parse(match[1]);
      if (!spec || !PRESENTATION_TYPES.includes(spec.type)) throw Error();
      parts.push({spec});
    } catch { parts.push({text:'No se pudo mostrar una presentación con formato inválido.'}); }
    offset = match.index + match[0].length;
  }
  if (offset < text.length) parts.push({text: text.slice(offset).replace(/```cm-ui[\s\S]*$/, '')});
  return parts;
}

/** Tipo del bloque `cm-ui` que se está escribiendo (aún sin cerrar) al final del texto, o ''. */
export function draftingType(value) {
  const text = String(value || ''), start = text.lastIndexOf(FENCE);
  if (start < 0) return '';
  const body = text.slice(start + FENCE.length);
  if (/\n[\s\S]*```/.test(body)) return '';
  const type = body.match(/"type"\s*:\s*"([a-z]+)"/)?.[1];
  return PRESENTATION_TYPES.includes(type) ? type : 'visual';
}

/**
 * Tarjetas vivas de una ejecución: todas las presentaciones de sus mensajes, en orden de aparición.
 * Un bloque con el mismo `id` actualiza su tarjeta (version sube); sin id, los bloques idénticos se juntan.
 */
export function liveSpecs(texts, limit = 8) {
  const cards = new Map();
  for (const text of texts || []) {
    for (const part of presentationParts(text)) {
      if (!part.spec) continue;
      const id = typeof part.spec.id === 'string' && part.spec.id.trim() ? part.spec.id.trim().slice(0, 60) : '';
      const json = JSON.stringify(part.spec), key = id ? `id:${id}` : `json:${json}`, before = cards.get(key);
      cards.set(key, {key, spec: part.spec, json, version: before ? before.version + (before.json !== json ? 1 : 0) : 0});
    }
  }
  return {cards: [...cards.values()].slice(-limit), drafting: draftingType((texts || []).at(-1))};
}

export function filePresentation(spec) {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(spec.project || '')) return null;
  const path = String(spec.path || '');
  if (!path || path.length > 400 || path.startsWith('/') || path.split('/').some(p => p === '..' || p === '.git') || /[\\\0]/.test(path)) return null;
  const ext = path.split('.').at(-1).toLowerCase();
  if (!['png','jpg','jpeg','gif','webp','svg','pdf','txt','md','json','csv','html'].includes(ext)) return null;
  return {ext, path, query: new URLSearchParams({project:spec.project, path}).toString()};
}

export function chartValues(spec) {
  if (!Array.isArray(spec.labels) || !Array.isArray(spec.values)) return [];
  return spec.values.slice(0,80).map((value, i) => ({label:String(spec.labels[i] ?? i+1).slice(0,50), value:Number(value)})).filter(p => Number.isFinite(p.value) && Math.abs(p.value) <= 1e12);
}

const text = (value, limit) => String(value ?? '').slice(0, limit);
const finite = value => { const number = typeof value === 'string' && value.trim() === '' ? NaN : Number(value); return Number.isFinite(number) && Math.abs(number) <= 1e15 ? number : null; };

/** Cifras de una tarjeta `stats`: etiqueta, valor (número o texto corto), unidad, variación y tendencia. */
export function statItems(spec) {
  return (Array.isArray(spec.items) ? spec.items : []).slice(0, 8).filter(item => item && typeof item === 'object').map(item => {
    const number = finite(item.value);
    return {label: text(item.label, 40), value: number ?? text(item.value, 24), numeric: number !== null, unit: text(item.unit, 10),
      delta: finite(item.delta), trend: (Array.isArray(item.trend) ? item.trend : []).slice(-40).map(finite).filter(value => value !== null)};
  });
}

const STEP_STATUS = {done: 'done', completed: 'done', ok: 'done', running: 'running', in_progress: 'running', active: 'running', error: 'error', failed: 'error'};
/** Progreso: porcentaje (0–100) y/o pasos con estado done/running/pending/error. */
export function progressOf(spec) {
  const steps = (Array.isArray(spec.steps) ? spec.steps : []).slice(0, 12).filter(step => step && typeof step === 'object')
    .map(step => ({label: text(step.label ?? step.content, 80), status: STEP_STATUS[step.status] || 'pending'}));
  let value = finite(spec.value);
  if (value === null && steps.length) value = steps.filter(step => step.status === 'done').length / steps.length * 100;
  return {value: value === null ? null : Math.max(0, Math.min(100, value)), steps};
}

const MEDIA = new RegExp(`^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\\.(?:${IMAGE_EXTENSIONS.join('|')})$`, 'i');
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/;
/** Imágenes seguras: carpeta de medios del agente, archivo de un proyecto o data URI pequeño. */
export function imageSources(spec) {
  const items = Array.isArray(spec.images) ? spec.images.slice(0, 12) : [spec];
  return items.filter(item => item && typeof item === 'object').map(item => {
    let src = '';
    if (typeof item.media === 'string' && MEDIA.test(item.media)) src = `/api/media/${encodeURIComponent(item.media)}`;
    else if (item.project && item.path) { const file = filePresentation(item); if (file && IMAGE_EXTENSIONS.includes(file.ext)) src = `/api/files/raw?${file.query}`; }
    else if (typeof item.src === 'string' && item.src.length <= 90000 && DATA_IMAGE.test(item.src)) src = item.src;
    return src && {src, caption: text(item.caption, 160), alt: text(item.alt || item.caption || item.media || item.path || 'Imagen', 160)};
  }).filter(Boolean);
}

/** Código para mostrar: lenguaje y hasta 400 líneas. */
export function codeOf(spec) {
  const lines = String(spec.code ?? '').slice(0, 16000).replace(/\r\n?/g, '\n').split('\n').slice(0, 400);
  return {language: text(spec.language, 20).replace(/[^\w+#.-]/g, ''), lines};
}
