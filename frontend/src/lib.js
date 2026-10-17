import {useEffect, useRef, useState} from 'react';

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// Todas las llamadas tienen tiempo límite: antes un servidor lento dejaba la
// interfaz esperando para siempre ("se queda colgado").
export async function api(url, {method = 'GET', body, timeout = 20000} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  try {
    const response = await fetch(url, {
      method, credentials: 'same-origin', signal: controller.signal,
      headers: body !== undefined && !isForm ? {'Content-Type': 'application/json'} : undefined,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && !url.startsWith('/api/login')) window.dispatchEvent(new Event('cm:unauthorized'));
    if (response.status === 403 && data.setup_required) window.dispatchEvent(new Event('cm:setup-required'));
    if (!response.ok) throw new ApiError(data.message || `Error ${response.status}`, response.status);
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'AbortError') throw new ApiError('El servidor tardó demasiado en responder. Reintenta.', 0);
    throw new ApiError('Sin conexión con el servidor', 0);
  } finally {
    clearTimeout(timer);
  }
}
export const post = (url, body, options) => api(url, {...options, method: 'POST', body});

export function clearPrivateCache() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key === 'cm-state-v2' || key.startsWith('cm-draft-')) localStorage.removeItem(key);
    }
  } catch { /* almacenamiento bloqueado */ }
}

// ---------------------------------------------------------------- rutas
export function navigate(to, {replace = false} = {}) {
  if (to === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', to);
  window.dispatchEvent(new Event('cm:navigate'));
}

export function useLocation() {
  const read = () => ({path: location.pathname, query: new URLSearchParams(location.search)});
  const [value, setValue] = useState(read);
  useEffect(() => {
    const update = () => setValue(read());
    window.addEventListener('popstate', update);
    window.addEventListener('cm:navigate', update);
    return () => { window.removeEventListener('popstate', update); window.removeEventListener('cm:navigate', update); };
  }, []);
  return value;
}

export function setQuery(key, value) {
  const query = new URLSearchParams(location.search);
  if (value) query.set(key, value); else query.delete(key);
  const text = query.toString();
  navigate(location.pathname + (text ? `?${text}` : ''), {replace: true});
}

// ---------------------------------------------------------------- formato
export const bytes = value => {
  if (!value) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
};

export function timeAgo(seconds) {
  if (!seconds) return '';
  const diff = Math.max(0, Date.now() / 1000 - seconds);
  if (diff < 45) return 'ahora';
  if (diff < 3600) return `hace ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.round(diff / 3600)} h`;
  if (diff < 86400 * 30) return `hace ${Math.round(diff / 86400)} d`;
  return new Date(seconds * 1000).toLocaleDateString();
}

export function duration(seconds) {
  if (seconds == null || isNaN(seconds)) return '';
  seconds = Math.max(0, Math.round(seconds));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export const providerLabel = provider => provider === 'codex' ? 'Codex' : 'Claude';
export const taskLabel = status => ({espera: 'En cola', working: 'Trabajando', terminado: 'Terminada', error: 'Error'})[status] || status;

export function slugify(text) {
  const stop = new Set(['un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'de', 'del', 'para', 'con', 'que', 'y', 'en', 'mi', 'me', 'quiero', 'crea', 'crear', 'haz', 'hacer', 'app', 'aplicacion', 'web', 'pagina', 'sitio', 'a', 'an', 'the', 'of', 'for', 'with']);
  const words = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(word => word && !stop.has(word));
  let slug = words.slice(0, 3).join('-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30).replace(/-$/, '');
  return slug || '';
}

export const PROJECT_NAME = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

// Color estable por proyecto para su miniatura.
export function projectHue(name) {
  let hash = 0;
  for (const char of String(name)) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

// ---------------------------------------------------------------- utilidades de React
export function usePolling(callback, delay, deps = []) {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    let stopped = false, timer, running = false;
    const tick = async () => {
      if (stopped || running) return;
      running = true;
      if (!document.hidden) { try { await saved.current(); } catch { /* el propio callback muestra el error */ } }
      running = false;
      if (!stopped) timer = setTimeout(tick, typeof delay === 'function' ? delay() : delay);
    };
    tick();
    const wake = () => { if (!document.hidden) { clearTimeout(timer); tick(); } };
    document.addEventListener('visibilitychange', wake);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', wake); };
  }, deps);
}

export function useNow(interval = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), interval); return () => clearInterval(timer); }, [interval]);
  return now;
}

export function useMedia(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export function relPath(path, project) {
  const text = String(path || '');
  const prefix = `/srv/projects/${project}/`;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}
