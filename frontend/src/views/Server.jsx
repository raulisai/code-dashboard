import React, {useState} from 'react';
import {Box, ChevronRight, ExternalLink, Play, RotateCcw, Search, Square, SquareTerminal} from 'lucide-react';
import {useApp} from '../App.jsx';
import {bytes, navigate, post} from '../lib.js';
import {Confirm, Empty, Meter, Spinner, toast} from '../ui.jsx';

export default function Server() {
  const {state, refresh} = useApp();
  const [query, setQuery] = useState(''), [confirm, setConfirm] = useState(null), [busy, setBusy] = useState('');
  const projectNames = new Set(state.projects.map(p => p.name));
  const rows = state.docker.map(c => ({...c, name: (c.Names || [])[0]?.replace(/^\//, '') || c.Id.slice(0, 12)}))
    .filter(c => `${c.name} ${c.Image} ${c.Project}`.toLowerCase().includes(query.toLowerCase()));
  const running = state.docker.filter(c => c.State === 'running').length;
  const ram = state.memory.total_kb ? Math.round((1 - state.memory.available_kb / state.memory.total_kb) * 100) : 0;
  const disk = parseFloat(state.disk.percent) || 0;
  const act = async request => {
    setConfirm(null); setBusy(request.container);
    try { const result = await post('/api/docker', request, {timeout: 90000}); toast(result.message, 'success'); } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(''); refresh(); }
  };
  const ask = request => request.action === 'start' ? act(request) : setConfirm(request);
  return <div className="page-pad">
    <header className="page-title"><div><div className="eyebrow">VPS</div><h1>Servidor</h1></div></header>
    <div className="meters big">
      <Meter label="CPU" value={`${Math.round(state.cpu?.percent || 0)}%`} percent={state.cpu?.percent} tone="cpu" detail={`${state.cpu?.cores} núcleos · carga ${state.cpu?.load_1m}`}/>
      <Meter label="RAM" value={`${ram}%`} percent={ram} tone="ram" detail={`${bytes((state.memory.total_kb - state.memory.available_kb) * 1024)} de ${bytes(state.memory.total_kb * 1024)}`}/>
      <Meter label="Disco" value={`${Math.round(disk)}%`} percent={disk} tone="disk" detail={`${state.disk.used} de ${state.disk.total} · ${state.disk.free} libres`}/>
    </div>
    <div className="status-grid">
      <div><span className={state.docker_ok ? 'dot on' : 'dot bad'}/>Docker {state.docker_ok ? 'operativo' : 'sin conexión'}</div>
      <div><span className={state.tmux_ok ? 'dot on' : 'dot bad'}/>tmux del host {state.tmux_ok ? 'operativo' : 'caído'}</div>
      <div><Box size={14}/>{running}/{state.docker.length} contenedores activos</div>
    </div>

    <section className="block">
      <div className="block-head"><h2>Sesiones de terminal <span className="count">{state.sessions.length}</span></h2></div>
      {state.sessions.length ? <div className="session-list">{state.sessions.map(s => {
        const project = [s.name, s.name.replace(/-(claude|shell)$/, '')].find(name => projectNames.has(name));
        return <div key={s.name} className="session-row"><SquareTerminal size={16}/><div><b>{s.name}</b><small>{s.command}{s.attached ? ' · conectada' : ''}</small></div>
          {project && <button className="btn small" onClick={() => navigate(`/p/${project}?tab=shell`)}>Abrir<ChevronRight size={13}/></button>}</div>;
      })}</div> : <Empty title="Sin sesiones" text="Las terminales que abras desde un proyecto aparecerán aquí."/>}
    </section>

    <section className="block">
      <div className="block-head"><h2>Contenedores Docker</h2></div>
      <label className="search"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar contenedor, imagen o proyecto…"/></label>
      <div className="container-list">{rows.map(c => {
        const owned = projectNames.has(c.Project);
        return <div key={c.Id} className={c.State === 'running' ? 'container-row' : 'container-row stopped'}>
          <Box size={18}/>
          <div className="cr-main"><b><span className={c.State === 'running' ? 'dot on' : 'dot'}/>{c.name}</b><small>{c.Image} · {c.Status}</small>
            <div className="cr-links">{owned && <button className="link-small" onClick={() => navigate(`/p/${c.Project}`)}>{c.Project}<ChevronRight size={11}/></button>}
              {(c.Urls || []).map(url => <a key={url} href={url} target="_blank" rel="noreferrer" className="link-small">{url.replace('https://', '')}<ExternalLink size={11}/></a>)}</div></div>
          <span className="cr-mem">{c.State === 'running' ? bytes(c.MemoryUsage) : '—'}</span>
          <div className="row-actions">{!owned ? <small className="muted">Infra</small> : busy === c.Id ? <Spinner/> : <>
            {c.State === 'running' && <button className="icon-btn" onClick={() => ask({project: c.Project, action: 'restart', container: c.Id, label: `Reiniciar ${c.name}`})} aria-label="Reiniciar"><RotateCcw size={15}/></button>}
            {c.State === 'running' ? !c.Protected && <button className="icon-btn danger" onClick={() => ask({project: c.Project, action: 'stop', container: c.Id, label: `Detener ${c.name}`})} aria-label="Detener"><Square size={14}/></button>
              : <button className="icon-btn ok" onClick={() => ask({project: c.Project, action: 'start', container: c.Id})} aria-label="Iniciar"><Play size={15}/></button>}
          </>}</div>
        </div>;
      })}</div>
    </section>
    {confirm && <Confirm title={`¿${confirm.label}?`} danger={confirm.action === 'stop'} confirmLabel={confirm.label} text={confirm.action === 'stop' ? 'El servicio quedará apagado hasta que lo vuelvas a iniciar.' : 'El servicio estará unos segundos sin responder.'}
      onCancel={() => setConfirm(null)} onConfirm={() => act(confirm)}/>}
  </div>;
}
