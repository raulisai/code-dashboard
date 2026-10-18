import React from 'react';
import {Activity, ArrowRight, Gauge, Bot, ChevronRight, CircleCheck, Clock3, Container, FolderOpen, Globe2, ListTodo, Server, Settings, ShieldQuestion, Sparkles} from 'lucide-react';
import {useApp} from '../App.jsx';
import {bytes, navigate, providerLabel} from '../lib.js';
import {Meter, ProviderMark, Spinner} from '../ui.jsx';
import {projectLabel, taskHref} from '../general.js';
import Quota from '../Quota.jsx';

function go(event, to) { event.preventDefault(); navigate(to); window.scrollTo(0, 0); }

export default function Home() {
  const {state} = useApp();
  const working = state.task_records.filter(task => task.status === 'working');
  const queued = state.task_records.filter(task => task.status === 'espera');
  const approvals = state.approvals || [];
  const online = state.projects.filter(project => project.running_containers > 0).length;
  const containers = state.docker.filter(container => container.State === 'running').length;
  const connected = state.docker_ok && state.tmux_ok;
  const ram = state.memory.total_kb ? Math.round((1 - state.memory.available_kb / state.memory.total_kb) * 100) : 0;
  const stats = [
    {key: 'projects', label: 'Proyectos', value: state.projects.length, detail: 'En total', icon: FolderOpen, to: '/projects'},
    {key: 'online', label: 'En línea', value: online, detail: 'Proyectos publicados', icon: Globe2, to: '/projects'},
    {key: 'working', label: 'Trabajando', value: working.length, detail: 'Peticiones en curso', icon: Bot, to: '/queue'},
    {key: 'pending', label: 'Pendientes', value: queued.length, detail: 'Peticiones en cola', icon: Clock3, to: '/queue'},
  ];
  return <div className="page-pad dashboard-home">
    <header className="dashboard-top"><a href="/" className="overview-brand" onClick={event => go(event, '/')}><span className="brand-spark"><Sparkles size={16}/></span> Codex <b>Manager</b></a><a href="/settings" className="glass-circle" aria-label="Ajustes" onClick={event => go(event, '/settings')}><Settings size={19}/></a></header>
    <div className="dashboard-heading"><div><span className="eyebrow">TODO DE UN VISTAZO</span><h1>Resumen general</h1><p>Tu servidor, tus proyectos y lo que está en marcha.</p></div><span className={`dashboard-live ${connected ? '' : 'warn'}`}><span className={connected ? 'dot on' : 'dot bad'}/>{connected ? 'Servidor conectado' : 'Revisa el servidor'}</span></div>
    <div className="dashboard-stats">{stats.map(stat => <a key={stat.key} className={`dashboard-stat glass-panel stat-${stat.key}`} href={stat.to} onClick={event => go(event, stat.to)} data-stat={stat.key}>
      <span className="stat-label"><stat.icon size={16}/>{stat.label}<ChevronRight size={13}/></span><b className="stat-value">{stat.value}</b><small>{stat.detail}</small>
    </a>)}</div>
    {approvals.length > 0 && <a className="approval-banner dashboard-approval" href="/queue" onClick={event => go(event, '/queue')}><ShieldQuestion size={22}/><div><b>{approvals.length} {approvals.length === 1 ? 'acción necesita' : 'acciones necesitan'} tu aprobación</b><small>{[...new Set(approvals.map(approval => approval.project))].join(' · ')}</small></div><ChevronRight size={18}/></a>}
    <div className="dashboard-panels">
      <section className="dashboard-server glass-panel" aria-label="Estado del servidor">
        <header className="dashboard-section-head"><div><span className="section-icon"><Server size={18}/></span><h2>Estado del servidor</h2></div><a href="/server" onClick={event => go(event, '/server')}>Ver detalles <ChevronRight size={14}/></a></header>
        <div className="meters">
          <Meter label="CPU" value={`${Math.round(state.cpu?.percent || 0)}%`} percent={state.cpu?.percent} tone="cpu" detail={`${state.cpu?.cores || 0} núcleos`}/>
          <Meter label="RAM" value={`${ram}%`} percent={ram} tone="ram" detail={`${bytes((state.memory.total_kb - state.memory.available_kb) * 1024)} en uso`}/>
          <Meter label="Disco" value={state.disk.percent || '0%'} percent={parseFloat(state.disk.percent) || 0} tone="disk" detail={`${state.disk.free} libres`}/>
        </div>
        <div className="dashboard-services"><span><span className={state.docker_ok ? 'dot on' : 'dot bad'}/>Docker {state.docker_ok ? 'operativo' : 'sin conexión'}</span><span><span className={state.tmux_ok ? 'dot on' : 'dot bad'}/>Agentes {state.tmux_ok ? 'disponibles' : 'sin conexión'}</span></div>
        <a href="/server" className="dashboard-containers" onClick={event => go(event, '/server')}><Container size={16}/><span><b>{containers}/{state.docker.length}</b> contenedores activos</span><ChevronRight size={14}/></a>
      </section>
      <section className="dashboard-working glass-panel" aria-label="Trabajando ahora">
        <header className="dashboard-section-head"><div><span className="section-icon"><Activity size={18}/></span><h2>Trabajando ahora <span className="count">{working.length}</span></h2></div><a href="/queue" onClick={event => go(event, '/queue')} aria-label="Ver toda la actividad"><ArrowRight size={16}/></a></header>
        {working.length ? <div className="dashboard-task-list">{working.map(task => <a className="dashboard-task" key={task.id} href={taskHref(task)} onClick={event => go(event, taskHref(task))}><ProviderMark provider={task.provider} size={32}/><div><b>{projectLabel(task.project)}</b><p>{task.title || 'Petición al agente'}</p><small>{providerLabel(task.provider)} · En curso</small></div><Spinner size={15}/></a>)}</div> : <div className="dashboard-empty"><CircleCheck size={24}/><b>Los agentes están libres</b><p>Las peticiones en curso aparecerán aquí con su proyecto.</p></div>}
      </section>
      <section className="dashboard-pending glass-panel" aria-label="Tareas pendientes">
        <header className="dashboard-section-head"><div><span className="section-icon"><ListTodo size={18}/></span><h2>Tareas pendientes <span className="count">{queued.length}</span></h2></div><a href="/queue" onClick={event => go(event, '/queue')}>Ver cola <ChevronRight size={14}/></a></header>
        {queued.length ? <div className="dashboard-task-list">{queued.slice(0, 3).map(task => <a className="dashboard-task" key={task.id} href={taskHref(task)} onClick={event => go(event, taskHref(task))}><span className="pending-icon"><Clock3 size={19}/></span><div><b>{projectLabel(task.project)}</b><p>{task.title || 'Petición al agente'}</p><small>{providerLabel(task.provider)} · {task.priority === 'alta' ? 'Prioridad alta' : 'En cola'}</small></div><ChevronRight size={16}/></a>)}{queued.length > 3 && <a className="dashboard-more" href="/queue" onClick={event => go(event, '/queue')}>Ver las {queued.length} peticiones <ArrowRight size={14}/></a>}</div> : <div className="dashboard-empty compact"><CircleCheck size={21}/><div><b>No hay peticiones en espera</b><p>La cola está al día.</p></div></div>}
      </section>
      <section className="dashboard-quota glass-panel" aria-label="Cupo de Claude y Codex">
        <header className="dashboard-section-head"><div><span className="section-icon"><Gauge size={18}/></span><h2>Cupo de Claude y Codex</h2></div><a href="/settings" onClick={event => go(event, '/settings')}>Detalle <ChevronRight size={14}/></a></header>
        <Quota/>
      </section>
      <a className="dashboard-project-link glass-panel" href="/projects" onClick={event => go(event, '/projects')}><span className="section-icon"><FolderOpen size={22}/></span><div><b>Explora tus proyectos</b><small>{state.projects.length} en total · {online} en línea</small></div><ArrowRight size={19}/></a>
    </div>
    <p className="dashboard-updated">Se actualiza automáticamente{state.time ? ` · ${state.time}` : ''}</p>
  </div>;
}
