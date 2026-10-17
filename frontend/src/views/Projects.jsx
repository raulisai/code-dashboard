import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, Bot, Check, ChevronLeft, ChevronRight, Circle, CircleAlert, Container, ExternalLink, FolderOpen, FolderPlus, GitBranch, Globe2, ListTodo, MoreHorizontal, Search, Settings, ShieldQuestion, Sparkles, SquareTerminal, Star, Trash2, X} from 'lucide-react';
import ProjectDelete from '../ProjectDelete.jsx';
import {useApp} from '../App.jsx';
import {navigate, post, providerLabel, taskLabel, timeAgo} from '../lib.js';
import {Empty, Monogram, Sheet, Spinner, toast} from '../ui.jsx';

const ART = {
  server: {image: '/art/server-neon.webp', color: '#20c7ff', label: 'Infraestructura'},
  game: {image: '/art/game-neon.webp', color: '#a084ff', label: 'Juego'},
  media: {image: '/art/media-neon.webp', color: '#ffac52', label: 'Aplicación web'},
};
function projectArt(project) {
  const text = `${project.name} ${project.description}`.toLowerCase();
  return /game|juego|snake|guitar|undertale|poleana/.test(text) ? ART.game : /dashboard|infra|servidor|server|api/.test(text) ? ART.server : ART.media;
}
function go(event, to) { event.preventDefault(); navigate(to); window.scrollTo(0, 0); }
function sortedProjects(projects, query = '', sort = 'recent') {
  return projects.filter(p => `${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase()))
    .slice().sort((a, b) => Number(b.featured) - Number(a.featured) || (sort === 'name' ? a.name.localeCompare(b.name) : b.activity - a.activity));
}
function useProjectActions() {
  const {refresh} = useApp();
  const [deleting, setDeleting] = useState(null);
  const toggleStar = async project => {
    try { const result = await post('/api/projects', {action: 'toggle_featured', name: project.name}); toast(result.message); await refresh(); }
    catch (err) { toast(err.message, 'error'); }
  };
  return {deleting, setDeleting, toggleStar};
}

export default function Projects() {
  const {state} = useApp();
  const [query, setQuery] = useState('');
  const projects = useMemo(() => sortedProjects(state.projects, query.trim()), [state.projects, query]);
  const [selected, setSelected] = useState(() => {
    try { return localStorage.getItem('cm-overview-project') || 'codex-dashboard'; } catch { return 'codex-dashboard'; }
  });
  const [menu, setMenu] = useState(false);
  const {deleting, setDeleting, toggleStar} = useProjectActions();
  const touch = useRef(null);
  const index = Math.max(0, projects.findIndex(p => p.name === selected));
  const project = projects[index];
  useEffect(() => { if (project) { try { localStorage.setItem('cm-overview-project', project.name); } catch {} } }, [project?.name]);
  const move = direction => { if (projects.length > 1) setSelected(projects[(index + direction + projects.length) % projects.length].name); };
  const tasks = state.task_records.filter(t => t.project === project?.name).slice().reverse()
    .sort((a, b) => Number(['working', 'espera'].includes(b.status)) - Number(['working', 'espera'].includes(a.status))).slice(0, 3);
  const approvals = state.approvals || [];
  const art = project ? projectArt(project) : ART.server;
  return <div className="home neon-home projects-page projects-carousel" style={{'--project-glow': art.color}}>
    <header className="overview-top">
      <a href="/" className="glass-circle" aria-label="Volver al resumen general" onClick={e => go(e, '/')}><ArrowLeft size={20}/></a>
      <a href="/" className="overview-brand" onClick={e => go(e, '/')}><span className="brand-spark"><Sparkles size={14}/></span> Codex <b>Manager</b></a>
      <button className="glass-circle" aria-label="Opciones del proyecto" onClick={() => setMenu(true)}><MoreHorizontal size={21}/></button>
    </header>
    <div className="projects-heading"><div><span className="eyebrow">TU ESPACIO DE TRABAJO</span><h1>Proyectos <span className="count">{state.projects.length}</span></h1></div><a className="btn primary new-project-button" href="/new" onClick={e => go(e, '/new')}><FolderPlus size={16}/>Nuevo proyecto</a></div>
    <div className="projects-toolbar"><label className="search"><Search size={17}/><input aria-label="Buscar proyecto" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por nombre o descripción…"/>{query && <button className="ghost-icon" aria-label="Limpiar búsqueda" onClick={() => setQuery('')}><X size={16}/></button>}</label></div>
    {approvals.length > 0 && <a className="approval-banner overview-approval" href={`/p/${approvals[0].project}?tab=agent`} onClick={e => go(e, `/p/${approvals[0].project}?tab=agent`)}>
      <ShieldQuestion size={20}/><div><b>{approvals.length} {approvals.length === 1 ? 'acción espera' : 'acciones esperan'} tu aprobación</b><small>{approvals[0].project} · {providerLabel(approvals[0].provider)}</small></div><ChevronRight size={18}/>
    </a>}
    {project ? <>
      <section className="project-overview" aria-label="Resumen del proyecto">
        <div className="project-identity" key={project.name}>
          <Monogram name={project.name} size={42}/>
          <h2>{project.name}{project.featured && <Star size={14} fill="currentColor" className="star-on"/>}</h2>
          <p>{project.description || project.url.replace('https://', '')}</p>
          <div className="project-online"><span className={project.running_containers ? 'online-indicator' : 'online-indicator stopped'}/><span className={project.running_containers ? 'online-text' : ''}>{project.running_containers ? 'En línea' : 'Sin desplegar'}</span><i/> <span>{project.running_containers}/{project.container_details.length} servicios</span></div>
        </div>
        <div className="project-visual" onTouchStart={e => { touch.current = {x: e.touches[0].clientX, y: e.touches[0].clientY}; }} onTouchEnd={e => {
          if (!touch.current) return;
          const dx = e.changedTouches[0].clientX - touch.current.x, dy = e.changedTouches[0].clientY - touch.current.y;
          if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? -1 : 1);
          touch.current = null;
        }}>
          <a className="project-art-link" href={`/p/${project.name}`} onClick={e => go(e, `/p/${project.name}`)} aria-label={`Abrir proyecto ${project.name}`}>
            <img key={art.image} className="project-art" src={art.image} alt="" fetchPriority="high" draggable="false"/>
          </a>
          {projects.length > 1 && <><button className="glass-circle carousel-prev" aria-label="Proyecto anterior" onClick={() => move(-1)}><ChevronLeft size={23}/></button><button className="glass-circle carousel-next" aria-label="Proyecto siguiente" onClick={() => move(1)}><ChevronRight size={23}/></button></>}
          <div className="visual-caption"><span>{art.label}</span><a href={`/p/${project.name}`} onClick={e => go(e, `/p/${project.name}`)}>Abrir proyecto <ArrowRight size={13}/></a></div>
        </div>
        <div className="carousel-pagination" aria-label="Elegir proyecto">
          {projects.map((p, i) => <button key={p.name} className={i === index ? 'on' : ''} aria-label={`Ver ${p.name}`} aria-current={i === index ? 'true' : undefined} title={p.name} onClick={() => setSelected(p.name)}><span/></button>)}
        </div>
        <span className="sr-only" role="status" aria-live="polite">{project.name}, proyecto {index + 1} de {projects.length}</span>
      </section>
      <div className="overview-details">
        <nav className="project-tool-dock glass-panel" aria-label="Herramientas del proyecto">
          <a href={`/p/${project.name}?tab=agent`} onClick={e => go(e, `/p/${project.name}?tab=agent`)} aria-label="Agente" title="Agente"><span className="tool-tile agent-tile"><Bot size={24}/></span><small>Agente</small></a>
          <a href={`/p/${project.name}?tab=files`} onClick={e => go(e, `/p/${project.name}?tab=files`)} aria-label="Archivos" title="Archivos"><span className="tool-tile files-tile"><FolderOpen size={23}/></span><small>Archivos</small></a>
          <a href={`/p/${project.name}?tab=shell`} onClick={e => go(e, `/p/${project.name}?tab=shell`)} aria-label="Terminal" title="Terminal"><span className="tool-tile terminal-tile"><SquareTerminal size={23}/></span><small>Terminal</small></a>
          <a href={`/p/${project.name}?tab=deploy`} onClick={e => go(e, `/p/${project.name}?tab=deploy`)} aria-label="Servicios" title={`${project.container_details.length} servicios`}><span className="tool-tile docker-tile"><Container size={24}/></span><small>Servicios</small></a>
          <button onClick={() => setMenu(true)} aria-label="Más herramientas" title="Más herramientas"><span className="tool-tile more-tile">+3</span><small>Más</small></button>
        </nav>
        <section className="overview-tasks glass-panel">
          <header><h2>Actividad reciente</h2><a href={`/queue?project=${project.name}`} onClick={e => go(e, `/queue?project=${project.name}`)} aria-label="Ver todas las peticiones"><ListTodo size={16}/></a></header>
          {tasks.length ? tasks.map(task => <a className={`overview-task ${task.status}`} key={task.id} href={`/p/${project.name}?tab=agent`} onClick={e => go(e, `/p/${project.name}?tab=agent`)}>
            <span className="task-check">{task.status === 'terminado' ? <Check size={14}/> : task.status === 'working' ? <Spinner size={15}/> : task.status === 'error' ? <CircleAlert size={17}/> : <Circle size={19}/>}</span>
            <span className="overview-task-body"><b>{task.title || 'Petición al agente'}</b><small>{providerLabel(task.provider)} · {taskLabel(task.status)}</small></span><span className="task-when">{task.status === 'working' ? 'Ahora' : task.status === 'espera' ? 'En cola' : timeAgo(Number(task.id) > 1e15 ? Number(task.id) / 1e9 : Date.parse(task.started_at || task.date) / 1000)}</span>
          </a>) : <div className="overview-no-tasks"><span className="task-check"><Check size={16}/></span><div><b>Todo listo para empezar</b><small>Abre el agente para trabajar en este proyecto.</small></div><a href={`/p/${project.name}`} onClick={e => go(e, `/p/${project.name}`)} aria-label="Abrir agente"><ChevronRight size={18}/></a></div>}
        </section>
        <div className="overview-foot"><span><span className={state.docker_ok && state.tmux_ok ? 'dot on' : 'dot bad'}/> {state.docker_ok && state.tmux_ok ? 'Servidor conectado' : 'Revisa el servidor'}</span><span>{index + 1} de {projects.length} {query.trim() ? 'resultados' : 'proyectos'}</span></div>
      </div>
    </> : <Empty icon={<FolderOpen/>} title={query.trim() ? 'No hay coincidencias' : 'Tu próximo proyecto empieza aquí'} text={query.trim() ? 'Prueba con otro nombre o descripción.' : 'Crea tu primer proyecto para empezar.'}>{query.trim() ? <button className="btn" onClick={() => setQuery('')}>Limpiar búsqueda</button> : <a className="btn primary" href="/new" onClick={e => go(e, '/new')}>Crear proyecto <ArrowRight size={16}/></a>}</Empty>}
    {menu && <Sheet title={project ? project.name : 'Codex Manager'} onClose={() => setMenu(false)}><div className="menu-list">
      {project && <>
        <button onClick={() => { setMenu(false); navigate(`/p/${project.name}?tab=agent`); }}><Bot size={18}/>Abrir agente</button>
        <button onClick={() => { setMenu(false); navigate(`/p/${project.name}?tab=preview`); }}><Globe2 size={18}/>Vista previa</button>
        <button onClick={() => { setMenu(false); navigate(`/p/${project.name}?tab=git`); }}><GitBranch size={18}/>Git</button>
        <button onClick={() => { setMenu(false); navigate(`/p/${project.name}?tab=console`); }}><SquareTerminal size={18}/>Consola y logs</button>
        <button onClick={() => { setMenu(false); window.open(project.url, '_blank', 'noopener'); }}><ExternalLink size={18}/>Abrir web</button>
        <button onClick={() => { toggleStar(project); setMenu(false); }}><Star size={18}/>{project.featured ? 'Quitar de destacados' : 'Destacar proyecto'}</button>
      </>}
      <button onClick={() => { setMenu(false); navigate('/settings'); }}><Settings size={18}/>Ajustes</button>
      {project && !project.protected && <button className="danger" disabled={project.deleting} onClick={() => { setMenu(false); setDeleting(project); }}><Trash2 size={18}/>Eliminar proyecto</button>}
    </div></Sheet>}
    {deleting && <ProjectDelete project={deleting} onClose={() => setDeleting(null)}/>}
  </div>;
}
