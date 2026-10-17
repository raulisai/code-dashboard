import React, {lazy, Suspense, useEffect, useState} from 'react';
import {ArrowLeft, Bot, ExternalLink, FolderTree, GitBranch, Globe2, MoreHorizontal, PanelRightClose, PanelRightOpen, Rocket, ScrollText, SquareTerminal, Trash2} from 'lucide-react';
import ProjectDelete from '../ProjectDelete.jsx';
import {useApp} from '../App.jsx';
import {navigate, providerLabel, setQuery, useLocation, useMedia} from '../lib.js';
import {Empty, Monogram, Sheet, Spinner} from '../ui.jsx';
import Agent from '../workspace/Agent.jsx';
import Preview from '../workspace/Preview.jsx';
import Files from '../workspace/Files.jsx';
import Console from '../workspace/Console.jsx';
import Deploy, {useDeploy} from '../workspace/Deploy.jsx';
import Git from '../workspace/Git.jsx';

const Terminal = lazy(() => import('../workspace/Terminal.jsx'));
const TOOLS = [
  {key: 'agent', label: 'Agente', icon: Bot},
  {key: 'preview', label: 'Vista previa', short: 'Vista', icon: Globe2},
  {key: 'files', label: 'Archivos', icon: FolderTree},
  {key: 'shell', label: 'Terminal', icon: SquareTerminal},
  {key: 'console', label: 'Consola', icon: ScrollText},
  {key: 'deploy', label: 'Desplegar', icon: Rocket},
  {key: 'git', label: 'Versiones (Git)', short: 'Versiones', icon: GitBranch},
];
const MOBILE_TABS = ['agent', 'preview', 'files', 'shell'];

export default function Workspace({name}) {
  const {state} = useApp();
  const {query} = useLocation();
  const desktop = useMedia('(min-width: 1024px)');
  const project = state.projects.find(p => p.name === name);
  const tab = TOOLS.some(t => t.key === query.get('tab')) ? query.get('tab') : 'agent';
  const [visited, setVisited] = useState(() => new Set([tab]));
  const [side, setSide] = useState(() => localStorage.getItem('cm-side-preview') !== '0');
  const [more, setMore] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { setVisited(v => v.has(tab) ? v : new Set([...v, tab])); }, [tab]);
  useEffect(() => { document.title = `${name} · Codex Manager`; return () => { document.title = 'Codex Manager'; }; }, [name]);
  const deploy = useDeploy(project || {name});
  if (!project) return <div className="ws-missing"><Empty title={deleting ? 'Proyecto eliminado' : 'Proyecto no encontrado'} text={deleting ? 'Sus archivos están en la papelera de Ajustes. Puedes restaurarlos cuando quieras.' : `No existe /srv/projects/${name}.`}><button className="btn primary" onClick={() => navigate('/')}>Volver al inicio</button></Empty></div>;

  const open = key => { setQuery('tab', key === 'agent' ? '' : key); setMore(false); };
  const toggleSide = () => { const next = !side; setSide(next); try { localStorage.setItem('cm-side-preview', next ? '1' : '0'); } catch { /* sin almacenamiento */ } };
  const run = async () => { if (await deploy('deploy') && !desktop) open('deploy'); };
  const working = project.working[0];
  const showSide = desktop && side && tab !== 'preview';
  const panel = key => {
    const active = tab === key;
    if (!visited.has(key) && !active) return null;
    const props = {project, active, desktop};
    const content = {
      agent: <Agent {...props}/>, preview: <Preview {...props} onDeploy={run}/>, files: <Files {...props}/>,
      shell: <Suspense fallback={<div className="editor-empty"><Spinner/> Cargando terminal…</div>}><Terminal {...props}/></Suspense>,
      console: <Console {...props}/>, deploy: <Deploy {...props}/>, git: <Git {...props}/>,
    }[key];
    return <div key={key} className={`ws-panel panel-${key}`} hidden={!active}>{content}</div>;
  };

  return <div className="ws">
    <header className="ws-top">
      <button className="icon-btn" onClick={() => navigate('/')} aria-label="Volver al inicio"><ArrowLeft size={20}/></button>
      <Monogram name={name} size={28}/>
      <div className="ws-title"><b>{name}</b>
        <small>{working ? <><span className="pulse-dot"/>{providerLabel(working.provider)} trabajando</> : project.queued ? `${project.queued} en cola` : project.running_containers ? <><span className="dot on"/>En línea</> : 'Sin desplegar'}</small></div>
      <span className="grow"/>
      <a className="icon-btn" href={project.url} target="_blank" rel="noreferrer" aria-label="Abrir la web"><ExternalLink size={18}/></a>
      {desktop && !project.protected && <button className="icon-btn danger" onClick={() => setDeleting(true)} aria-label="Eliminar proyecto" title="Eliminar proyecto"><Trash2 size={17}/></button>}
      {desktop && <button className="icon-btn" onClick={toggleSide} aria-label={side ? 'Ocultar vista previa' : 'Mostrar vista previa'} title="Vista previa lateral">{side ? <PanelRightClose size={18}/> : <PanelRightOpen size={18}/>}</button>}
      <button className="btn run" onClick={run}><Rocket size={16}/><span>Desplegar</span></button>
    </header>
    <div className="ws-body">
      {desktop && <nav className="ws-rail">{TOOLS.map(tool => <button key={tool.key} className={tab === tool.key ? 'on' : ''} onClick={() => open(tool.key)} title={tool.label}>
        <tool.icon size={19}/><span>{tool.short || tool.label}</span>{tool.key === 'agent' && working && <i className="rail-live"/>}</button>)}</nav>}
      <main className="ws-main">{TOOLS.map(tool => panel(tool.key))}</main>
      {showSide && <aside className="ws-side"><Preview project={project} onDeploy={run} desktop/></aside>}
    </div>
    {!desktop && <nav className="ws-tabs">
      {TOOLS.filter(t => MOBILE_TABS.includes(t.key)).map(tool => <button key={tool.key} className={tab === tool.key ? 'on' : ''} onClick={() => open(tool.key)}>
        <span className="bn-icon"><tool.icon size={20}/>{tool.key === 'agent' && working && <i className="rail-live"/>}</span><span>{tool.short || tool.label}</span></button>)}
      <button className={!MOBILE_TABS.includes(tab) ? 'on' : ''} onClick={() => setMore(true)}><span className="bn-icon"><MoreHorizontal size={20}/></span><span>Más</span></button>
    </nav>}
    {more && <Sheet title="Herramientas" onClose={() => setMore(false)}>
      <div className="menu-list">{TOOLS.filter(t => !MOBILE_TABS.includes(t.key)).map(tool => <button key={tool.key} onClick={() => open(tool.key)}><tool.icon size={18}/>{tool.label}</button>)}{!project.protected && <button className="danger" onClick={() => { setMore(false); setDeleting(true); }}><Trash2 size={18}/>Eliminar proyecto</button>}</div>
    </Sheet>}
    {deleting && <ProjectDelete project={project} onClose={() => setDeleting(false)}/>}
  </div>;
}
