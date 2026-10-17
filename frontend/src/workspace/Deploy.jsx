import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Box, CheckCircle2, ExternalLink, Hammer, Play, Power, RotateCcw, Rocket, Square, Wrench, XCircle} from 'lucide-react';
import {api, bytes, duration, post, timeAgo, usePolling} from '../lib.js';
import {useApp} from '../App.jsx';
import {Confirm, Empty, Spinner, toast} from '../ui.jsx';

const stateLabel = state => ({running: 'Activo', exited: 'Detenido', created: 'Creado', paused: 'En pausa', restarting: 'Reiniciando', dead: 'Caído'})[state] || state || 'Desconocido';

export function useDeploy(project) {
  const {refresh} = useApp();
  return async (action = 'deploy') => {
    try { const result = await post('/api/jobs', {project: project.name, action}); toast(result.message); window.dispatchEvent(new CustomEvent('cm:job-started', {detail: {project: project.name}})); refresh().catch(() => {}); return true; }
    catch (err) { toast(err.message, 'error'); return false; }
  };
}

export default function Deploy({project, active}) {
  const {refresh} = useApp();
  const deploy = useDeploy(project);
  const [jobs, setJobs] = useState(null), [selected, setSelected] = useState(null), [confirm, setConfirm] = useState(null), [busy, setBusy] = useState('');
  const running = jobs?.some(job => job.status === 'running');
  const seen = useRef({});
  const load = async () => {
    const result = await api(`/api/jobs?project=${encodeURIComponent(project.name)}`);
    for (const job of result.jobs) {
      if (seen.current[job.id] === 'running' && job.status !== 'running') {
        toast(job.status === 'done' ? `${job.title}: listo` : `${job.title}: falló`, job.status === 'done' ? 'success' : 'error');
        window.dispatchEvent(new CustomEvent('cm:job-finished', {detail: {project: project.name}}));
        refresh().catch(() => {});
      }
      seen.current[job.id] = job.status;
    }
    setJobs(result.jobs);
  };
  usePolling(async () => { if (active) { try { await load(); } catch { /* reintenta en la siguiente vuelta */ } } }, () => (running ? 1500 : 6000), [project.name, active, running]);
  useEffect(() => { const wake = event => { if (event.detail?.project === project.name) load().catch(() => {}); }; window.addEventListener('cm:job-started', wake); return () => window.removeEventListener('cm:job-started', wake); }, [project.name]);
  const job = jobs?.find(j => j.id === selected) || jobs?.[0];

  const containers = project.container_details || [];
  const docker = async request => {
    setConfirm(null); setBusy(request.container || '*');
    try { const result = await post('/api/docker', {project: project.name, action: request.action, container: request.container || ''}, {timeout: 90000}); toast(result.message, 'success'); }
    catch (err) { toast(err.message, 'error'); }
    finally { setBusy(''); refresh().catch(() => {}); }
  };
  const ask = request => request.action === 'start' ? docker(request) : setConfirm(request);

  return <div className="deploy">
    <section className="deploy-actions">
      <button className="btn primary big run-btn" onClick={() => deploy('deploy')} disabled={running}>{running ? <Spinner/> : <Rocket size={18}/>}{running ? 'Desplegando…' : 'Desplegar cambios'}</button>
      <div className="deploy-secondary">
        {project.dev_compose && <button className="btn" onClick={() => deploy('dev')} disabled={running}><Wrench size={15}/>Modo dev en vivo</button>}
        <button className="btn" onClick={() => deploy('build')} disabled={running}><Hammer size={15}/>Solo construir</button>
        <button className="btn" onClick={() => deploy('restart')} disabled={running || !containers.length}><RotateCcw size={15}/>Reiniciar</button>
        <button className="btn" onClick={() => setConfirm({action: 'down', label: 'Apagar con compose down'})} disabled={running || !containers.length}><Power size={15}/>Apagar</button>
      </div>
      <small className="muted">Desplegar ejecuta <code>docker compose up -d --build</code> en el servidor.</small>
    </section>

    {jobs?.length > 0 && <section className="block">
      <div className="block-head"><h3>Últimos despliegues</h3></div>
      <div className="job-tabs">{jobs.map(j => <button key={j.id} className={job?.id === j.id ? 'on' : ''} onClick={() => setSelected(j.id)}>
        {j.status === 'running' ? <Spinner size={13}/> : j.status === 'done' ? <CheckCircle2 size={13} className="ok-icon"/> : <XCircle size={13} className="err-icon"/>}{j.title}<small>{timeAgo(j.created_at)}</small></button>)}</div>
      {job && <JobOutput job={job}/>}
    </section>}

    <section className="block">
      <div className="block-head"><h3>Contenedores</h3>
        {containers.length > 0 && <div className="row-actions">
          {containers.some(c => c.state !== 'running') && <button className="btn small" onClick={() => ask({action: 'start'})}><Play size={13}/>Iniciar</button>}
          {containers.some(c => c.state === 'running') && <button className="btn small" onClick={() => ask({action: 'restart', label: 'Reiniciar todos'})}><RotateCcw size={13}/>Reiniciar</button>}
        </div>}
      </div>
      {containers.length ? <div className="container-list">{containers.map(c => <div key={c.id} className={c.state === 'running' ? 'container-row' : 'container-row stopped'}>
        <Box size={18}/>
        <div className="cr-main"><b><span className={c.state === 'running' ? 'dot on' : 'dot'}/>{c.name}</b><small>{stateLabel(c.state)} · {c.status}</small>
          {c.urls?.map(url => <a key={url} href={url} target="_blank" rel="noreferrer" className="link-small">{url.replace('https://', '')}<ExternalLink size={11}/></a>)}</div>
        <span className="cr-mem">{c.state === 'running' ? bytes(c.memory_bytes) : '—'}</span>
        <div className="row-actions">{busy === c.id || busy === '*' ? <Spinner/> : <>
          {c.state === 'running' && <button className="icon-btn" onClick={() => ask({action: 'restart', container: c.id, label: `Reiniciar ${c.name}`})} aria-label="Reiniciar"><RotateCcw size={15}/></button>}
          {c.state === 'running' ? !c.protected && <button className="icon-btn danger" onClick={() => ask({action: 'stop', container: c.id, label: `Detener ${c.name}`})} aria-label="Detener"><Square size={14}/></button>
            : <button className="icon-btn ok" onClick={() => ask({action: 'start', container: c.id})} aria-label="Iniciar"><Play size={15}/></button>}
        </>}</div>
      </div>)}</div> : <Empty title="Sin contenedores" text="Pulsa «Desplegar cambios» para construir y arrancar el proyecto."/>}
    </section>
    {confirm && <Confirm title={`¿${confirm.label || 'Confirmar'}?`} danger={confirm.action === 'stop' || confirm.action === 'down'} confirmLabel={confirm.label || 'Confirmar'}
      text={confirm.action === 'restart' ? 'El servicio estará unos segundos sin responder.' : 'La web del proyecto dejará de responder hasta que la vuelvas a iniciar. Los datos en volúmenes se conservan.'}
      onCancel={() => setConfirm(null)} onConfirm={() => confirm.action === 'down' ? (setConfirm(null), deploy('down')) : docker(confirm)}/>}
  </div>;
}

function JobOutput({job}) {
  const box = useRef(null);
  useLayoutEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [job.output]);
  const took = job.finished_at ? duration(job.finished_at - job.created_at) : '';
  return <div className="job-output">
    <div className={`job-status ${job.status}`}>{job.status === 'running' ? <><Spinner size={13}/>En curso…</> : job.status === 'done' ? <><CheckCircle2 size={14}/>Completado{took && ` en ${took}`}</> : <><XCircle size={14}/>Falló (código {job.code}){took && ` tras ${took}`}</>}</div>
    <pre ref={box}>{job.output || 'Esperando salida…'}</pre>
  </div>;
}
