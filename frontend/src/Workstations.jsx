import React, {useState} from 'react';
import {Monitor, ShieldCheck} from 'lucide-react';
import {api, post, usePolling} from './lib.js';
import {toast} from './ui.jsx';

const labels = {queued: 'En cola', running: 'En el equipo', completed: 'Terminada', failed: 'Falló', rejected: 'Rechazada aquí', cancelled: 'Cancelada', interrupted: 'Conexión interrumpida'};

export default function Workstations() {
  const [data, setData] = useState({devices: [], jobs: []});
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('Mi PC Windows'), [projects, setProjects] = useState('');
  const [pair, setPair] = useState(null), [device, setDevice] = useState('');
  const [project, setProject] = useState(''), [provider, setProvider] = useState('claude'), [prompt, setPrompt] = useState('');
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const refresh = async () => {
    try {const result = await api('/api/workstations'); if (!Array.isArray(result.devices) || !Array.isArray(result.jobs)) throw new Error('Actualiza el backend para activar los equipos remotos.'); setData(result); setError('');}
    catch (err) {setError(err.status === 404 ? 'Actualiza el backend para activar los equipos remotos.' : err.message);}
  };
  usePolling(refresh, 10000, []);
  const act = async (body, success) => {
    setBusy(true);
    try {const result = await post('/api/workstations', body); await refresh(); if (success) toast(success, 'success'); return result;}
    catch (err) {toast(err.message, 'error'); return null;}
    finally {setBusy(false);}
  };
  const selected = data.devices.find(d => d.id === device);
  return <section className="block" aria-label="Equipos remotos">
    <div className="block-head"><h2><Monitor size={18}/>Desarrollar en otra computadora</h2></div>
    <p className="muted">Envía tareas a Estado IA para usar las herramientas instaladas en ese equipo, como Android Studio. El equipo recibe la cola mediante HTTPS y decide qué proyectos permite ejecutar.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <details><summary>Vincular una computadora</summary>
      <form onSubmit={async event => {event.preventDefault(); const result = await act({action: 'enroll', label, projects: projects.split(/[\n,]/).map(p => p.trim()).filter(Boolean)}); if (result) setPair(result);}}>
        <label className="field"><span>Nombre del equipo</span><input className="input" required maxLength={80} value={label} onChange={e => setLabel(e.target.value)}/></label>
        <label className="field"><span>Identificadores de proyectos autorizados (uno por línea)</span><textarea className="input" required rows={3} value={projects} onChange={e => setProjects(e.target.value)} placeholder="mi-app-android"/></label>
        <p className="muted">Estos identificadores se asociarán a carpetas locales desde Estado IA. Solo letras minúsculas, números y guiones.</p>
        <button className="btn" disabled={busy}>Generar código de 10 minutos</button>
      </form>
      {pair && <div role="status"><p>Copia este código en Estado IA → Conector. Trátalo como una credencial; se muestra solo aquí.</p><code style={{overflowWrap: 'anywhere'}}>{pair.code}</code><p><button className="btn small" onClick={() => setPair(null)}>Ocultar código</button></p></div>}
    </details>
    <div className="task-list">{data.devices.map(d => <div className="task-row" key={d.id}>
      <Monitor size={22}/><div className="task-main"><b>{d.label}</b><small>{d.revoked ? 'Revocado' : d.online ? 'En línea' : d.paired ? 'Sin conexión' : 'Pendiente de vínculo'} · {d.projects.join(', ')}</small></div>
      {!d.revoked && <button className="btn small danger" disabled={busy} onClick={() => {if (window.confirm(`¿Revocar el acceso de ${d.label}? También se cancelará su cola.`)) act({action: 'revoke', device: d.id}, 'Equipo revocado');}}>Revocar</button>}
    </div>)}</div>
    <form onSubmit={async event => {event.preventDefault(); const result = await act({action: 'enqueue', device, project, provider, prompt, request_key: requestKey}, 'Tarea enviada al equipo'); if (result) {setPrompt(''); setRequestKey(crypto.randomUUID());}}}>
      <label className="field"><span>Computadora de destino</span><select className="select" required value={device} onChange={e => {setDevice(e.target.value); setProject(''); setRequestKey(crypto.randomUUID());}}><option value="">Selecciona equipo</option>{data.devices.filter(d => d.paired && !d.revoked).map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
      <label className="field"><span>Proyecto local autorizado</span><select className="select" required value={project} onChange={e => {setProject(e.target.value); setRequestKey(crypto.randomUUID());}}><option value="">Selecciona proyecto</option>{(selected?.projects || []).map(p => <option key={p}>{p}</option>)}</select></label>
      <label className="field"><span>Agente</span><select className="select" value={provider} onChange={e => {setProvider(e.target.value); setRequestKey(crypto.randomUUID());}}><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label>
      <label className="field"><span>Tarea para esta computadora</span><textarea className="input" required rows={4} maxLength={20000} value={prompt} onChange={e => {setPrompt(e.target.value); setRequestKey(crypto.randomUUID());}} placeholder="Implementa la pantalla de inicio y comprueba la compilación Android con las herramientas locales autorizadas."/></label>
      <button className="btn primary" disabled={busy || !device || !project || !prompt.trim()}><ShieldCheck size={16}/>Enviar al equipo</button>
    </form>
    <h3>Cola e informes de equipos</h3>
    {!data.jobs.length && <p className="muted">Todavía no hay tareas remotas.</p>}
    {data.jobs.map(job => <details key={job.id} className="block">
      <summary>{labels[job.status] || job.status} · {job.project} · {job.provider}{job.cancel && job.status === 'running' ? ' · Cancelación solicitada' : ''}</summary>
      <p style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{job.prompt}</p>
      <p className="muted">{data.devices.find(d => d.id === job.device)?.label || job.device}</p>
      {job.result?.summary && <pre style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{job.result.summary}</pre>}
      {job.result?.branch && <p>Rama local: <code>{job.result.branch}</code></p>}
      {job.result?.commit && <p>Commit: <code>{job.result.commit}</code></p>}
      {job.result?.validation && <p>{job.result.validation}</p>}
      {['queued', 'running'].includes(job.status) && <button className="btn small danger" disabled={busy} onClick={() => act({action: 'cancel', job: job.id}, 'Cancelación solicitada')}>Cancelar tarea</button>}
      {job.status === 'interrupted' && <p className="muted">No se repetirá automáticamente. Revisa el resultado en el equipo antes de enviar otra tarea.</p>}
    </details>)}
  </section>;
}
