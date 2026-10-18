import React, {useEffect, useState} from 'react';
import {Bell, Download, Gauge, GitBranch, LogOut, Save, ShieldCheck, Trash2} from 'lucide-react';
import {useApp} from '../App.jsx';
import {api, post, clearPrivateCache} from '../lib.js';
import {ProviderPicker, Spinner, toast} from '../ui.jsx';
import {currentPush, disablePush, enablePush, pushSupported} from '../push.js';
import {ProjectTrash} from '../ProjectDelete.jsx';
import {SecuritySettings} from '../Security.jsx';
import Quota from '../Quota.jsx';

const CLAUDE_MODES = {
  ask: ['Aprobar desde la web', 'Edita archivos del proyecto sin preguntar; comandos, despliegues y accesos web te los pide aquí con Permitir / Denegar.'],
  auto: ['Modo auto de Claude', 'Un clasificador aprueba lo seguro y bloquea lo riesgoso sin preguntarte.'],
  edits: ['Solo lectura y ediciones', 'Puede leer y editar archivos, pero no ejecutar comandos (no podrá desplegar).'],
};
const CODEX_MODES = {
  full: ['Acceso completo', 'Equivale a codex --yolo: puede ejecutar cualquier comando, incluido docker. Es lo que ya usaba el servidor.'],
  workspace: ['Sandbox del proyecto', 'Solo escribe dentro del proyecto y sin red. No podrá desplegar con docker.'],
  'read-only': ['Solo lectura', 'Puede leer y responder, pero no cambia nada.'],
};
const VERSION_MODES = {
  on: ['Una versión por cada acción', 'Cada respuesta de un agente, guardado del editor, cambio de archivos y despliegue queda como commit para volver atrás cuando quieras.'],
  off: ['Solo versiones manuales', 'Las versiones se guardan únicamente al pulsar «Guardar» en Versiones.'],
};

export default function Settings({onLogout}) {
  const {state, refresh} = useApp();
  const [form, setForm] = useState(state.settings), [saving, setSaving] = useState(false);
  const [installable, setInstallable] = useState(!!window.cmInstallPrompt);
  const [rules, setRules] = useState({});
  const [notify, setNotify] = useState(false), [notifyBusy, setNotifyBusy] = useState(false);
  useEffect(() => { currentPush().then(subscription => setNotify(!!subscription)).catch(() => {}); }, []);
  useEffect(() => { const on = () => setInstallable(true); window.addEventListener('cm:installable', on); return () => window.removeEventListener('cm:installable', on); }, []);
  useEffect(() => {
    Promise.all(state.projects.map(p => api(`/api/agent?project=${encodeURIComponent(p.name)}`).then(r => [p.name, r.rules || []]).catch(() => [p.name, []])))
      .then(entries => setRules(Object.fromEntries(entries.filter(([, list]) => list.length))));
  }, []);
  const set = (key, value) => setForm(f => ({...f, [key]: value}));
  const save = async () => {
    setSaving(true);
    try { const result = await post('/api/settings', form); toast(result.message, 'success'); refresh(); } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };
  const removeRule = async (project, rule) => {
    try { const result = await post('/api/rules', {project, rule}); setRules(r => ({...r, [project]: result.rules})); toast(result.message); } catch (err) { toast(err.message, 'error'); }
  };
  const install = async () => { const prompt = window.cmInstallPrompt; if (!prompt) return; prompt.prompt(); await prompt.userChoice; window.cmInstallPrompt = null; setInstallable(false); };
  const logout = async () => {try {await disablePush().catch(() => {}); await post('/api/logout', {}); clearPrivateCache(); onLogout();} catch (err) {toast(err.message, 'error');}};
  const toggleNotifications = async () => {
    setNotifyBusy(true);
    try { await (notify ? disablePush() : enablePush()); setNotify(!notify); toast(notify ? 'Avisos desactivados' : 'Avisos activados', 'success'); }
    catch (err) { toast(err.message, 'error'); }
    finally { setNotifyBusy(false); }
  };
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return <div className="page-pad settings">
    <header className="page-title"><div><div className="eyebrow">PREFERENCIAS</div><h1>Ajustes</h1></div></header>
    <SecuritySettings/>
    <section className="block"><div className="block-head"><h2><Gauge size={18}/>Cupo de Claude y Codex</h2></div><Quota detail/></section>
    <GitHubSettings/>
    <ProjectTrash/>

    <section className="block">
      <div className="block-head"><h2>App en tu celular</h2></div>
      {standalone ? <p className="muted">Ya estás usando Codex Manager como app instalada. ✓</p>
        : installable ? <button className="btn primary" onClick={install}><Download size={16}/>Instalar Codex Manager</button>
        : <p className="muted">{ios ? 'En Safari toca Compartir → «Añadir a pantalla de inicio».' : 'En Chrome abre el menú ⋮ → «Instalar app» o «Añadir a pantalla de inicio».'} Se abrirá a pantalla completa, como una app.</p>}
      <div className="setting-row"><Bell size={17}/><div><b>Avisos {notify ? 'activados' : ''}</b><small>Recibe aprobaciones y resultados aunque cierres la app. En iPhone, instálala primero en la pantalla de inicio.</small></div>
        {pushSupported() ? <button className="btn small" disabled={notifyBusy} onClick={toggleNotifications}>{notifyBusy ? <Spinner/> : notify ? 'Desactivar' : 'Activar'}</button>
          : <span className="tag">Instala la app</span>}</div>
    </section>

    <section className="block">
      <div className="block-head"><h2>Agentes</h2></div>
      <label className="field"><span>Agente por defecto</span><ProviderPicker value={form.default_provider} onChange={value => set('default_provider', value)}/></label>
      <div className="field"><span>Permisos de Claude</span>{Object.entries(CLAUDE_MODES).map(([key, [title, text]]) => <label key={key} className={form.claude_permission === key ? 'radio-card on' : 'radio-card'}>
        <input type="radio" name="claude" checked={form.claude_permission === key} onChange={() => set('claude_permission', key)}/><div><b>{title}</b><small>{text}</small></div></label>)}</div>
      <div className="field"><span>Permisos de Codex</span>{Object.entries(CODEX_MODES).map(([key, [title, text]]) => <label key={key} className={form.codex_sandbox === key ? 'radio-card on' : 'radio-card'}>
        <input type="radio" name="codex" checked={form.codex_sandbox === key} onChange={() => set('codex_sandbox', key)}/><div><b>{title}</b><small>{text}</small></div></label>)}</div>
      <div className="field"><span>Versiones (Git)</span>{Object.entries(VERSION_MODES).map(([key, [title, text]]) => <label key={key} className={(form.auto_commit || 'on') === key ? 'radio-card on' : 'radio-card'}>
        <input type="radio" name="auto_commit" checked={(form.auto_commit || 'on') === key} onChange={() => set('auto_commit', key)}/><div><b>{title}</b><small>{text}</small></div></label>)}</div>
      <div className="two-col">
        <label className="field"><span>Modelo de Claude</span><input className="input" list="claude-models" value={form.claude_model} onChange={e => set('claude_model', e.target.value)} placeholder="Predeterminado"/></label>
        <label className="field"><span>Modelo de Codex</span><input className="input" value={form.codex_model} onChange={e => set('codex_model', e.target.value)} placeholder="Predeterminado"/></label>
        <datalist id="claude-models"><option value="opus"/><option value="sonnet"/><option value="haiku"/><option value="fable"/></datalist>
      </div>
      <button className="btn primary" onClick={save} disabled={saving}>{saving ? <Spinner/> : <Save size={16}/>}Guardar ajustes</button>
    </section>

    <section className="block">
      <div className="block-head"><h2>Permisos recordados</h2></div>
      {Object.keys(rules).length ? Object.entries(rules).map(([project, list]) => <div key={project} className="rule-group"><b>{project}</b>
        {list.map(rule => <div key={rule} className="rule-row"><ShieldCheck size={15}/><code>{rule.replace(/^Bash:/, '')}</code><span className="grow"/><button className="icon-btn" onClick={() => removeRule(project, rule)} aria-label="Quitar"><Trash2 size={15}/></button></div>)}
      </div>) : <p className="muted">Cuando pulses «Siempre» en una aprobación, la regla aparecerá aquí y podrás quitarla.</p>}
    </section>

    <section className="block">
      <button className="btn danger-soft" onClick={logout}><LogOut size={16}/>Cerrar sesión</button>
    </section>
  </div>;
}

function GitHubSettings() {
  const [status, setStatus] = useState(null), [token, setToken] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { api('/api/github').then(setStatus).catch(() => setStatus({connected: false})); }, []);
  const send = async body => {
    setBusy(true);
    try { const result = await post('/api/github', body, {timeout: 30000}); setStatus(result); setToken(''); toast(result.message, 'success'); }
    catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  };
  return <section className="block github-settings">
    <div className="block-head"><h2><GitBranch size={18}/>GitHub</h2>{status?.connected && <span className="tag">Conectado</span>}</div>
    {!status ? <p className="muted"><Spinner size={14}/> Comprobando…</p> : status.connected ? <>
      <p className="muted">Cuenta <b>{status.login}</b>. Al crear un proyecto nuevo puedes crear también su repositorio privado en GitHub; se sube el primer commit con la llave SSH del servidor. Después no se sube nada automáticamente.</p>
      <button className="btn danger-soft" disabled={busy} onClick={() => window.confirm('¿Desconectar GitHub? Se borra el token guardado; los repos existentes no cambian.') && send({action: 'disconnect'})}>{busy ? <Spinner/> : null}Desconectar</button>
    </> : <form onSubmit={event => { event.preventDefault(); if (token.trim()) send({action: 'connect', token: token.trim()}); }}>
      <p className="muted">Para crear repos nuevos hace falta un token. En GitHub: Settings → Developer settings → Personal access tokens → <b>Fine-grained</b>, acceso a todos tus repositorios con permiso <b>Administration: Read and write</b> (o un token clásico con <b>repo</b>). Se guarda cifrado en el servidor. Importar y clonar repos no lo necesita.</p>
      <div className="two-col"><input className="input" type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} placeholder="github_pat_…" aria-label="Token de GitHub"/>
        <button className="btn primary" disabled={busy || !token.trim()}>{busy ? <Spinner/> : <GitBranch size={16}/>}Conectar</button></div>
    </form>}
  </section>;
}
