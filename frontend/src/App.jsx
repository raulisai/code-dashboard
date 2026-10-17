import React, {createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState} from 'react';
import {Home as HomeIcon, ListTodo, FolderOpen, Sparkles, Server as ServerIcon, Settings as SettingsIcon, ShieldAlert, WifiOff} from 'lucide-react';
import {api, post, clearPrivateCache, navigate, useLocation, usePolling} from './lib.js';
import {Spinner, Toaster} from './ui.jsx';
import Orb from './Orb.jsx';
import Login from './views/Login.jsx';
import Home from './views/Home.jsx';
import Projects from './views/Projects.jsx';
import Create from './views/Create.jsx';
import Queue from './views/Queue.jsx';
import Server from './views/Server.jsx';
import Settings from './views/Settings.jsx';
import {AuthenticatorSetup} from './Security.jsx';

const Workspace = lazy(() => import('./views/Workspace.jsx'));
const General = lazy(() => import('./views/General.jsx'));
const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);
const CACHE_KEY = 'cm-state-v2';

function cachedState() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    return cached && Date.now() - cached.saved < 6 * 3600 * 1000 ? cached.data : null;
  } catch { return null; }
}

export default function App() {
  const [auth, setAuthState] = useState('checking');
  const authRef = useRef('checking');
  const setAuth = useCallback(value => {authRef.current = value; setAuthState(value);}, []);
  const [state, setState] = useState(cachedState);
  const [error, setError] = useState('');
  const location = useLocation();

  useEffect(() => {
    api('/api/me', {timeout: 8000}).then(data => setAuth(data.setup_required ? 'setup' : 'in')).catch(err => setAuth(err.status === 401 ? 'out' : 'in'));
    const out = () => { setAuth('out'); setState(null); try { localStorage.removeItem(CACHE_KEY); } catch {} };
    window.addEventListener('cm:unauthorized', out);
    const setup = () => {setAuth('setup'); setState(null); try {localStorage.removeItem(CACHE_KEY);} catch {}};
    window.addEventListener('cm:setup-required', setup);
    return () => {window.removeEventListener('cm:unauthorized', out); window.removeEventListener('cm:setup-required', setup);};
  }, []);

  const refresh = useCallback(async () => {
    const data = await api('/api/state');
    if (authRef.current !== 'in') return null;
    setState(data);
    setError('');
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({saved: Date.now(), data})); } catch { /* almacenamiento lleno o bloqueado */ }
    return data;
  }, []);

  usePolling(async () => {
    if (auth !== 'in') return;
    try { await refresh(); } catch (err) { if (err.status !== 401) setError(err.message); }
  }, 4000, [auth]);

  // Insignia del icono de la app y aviso cuando un agente espera tu aprobación.
  const approvals = state?.approvals || [];
  useEffect(() => {
    try { approvals.length ? navigator.setAppBadge?.(approvals.length) : navigator.clearAppBadge?.(); } catch { /* sin soporte */ }
  }, [approvals.length]);

  if (auth === 'checking') return <div className="boot"><Spinner size={22}/> Cargando Codex Manager…</div>;
  if (auth === 'out') return <><Login onLogin={result => {setAuth(result.setup_required ? 'setup' : 'in'); if (!result.setup_required) refresh().catch(() => {});}}/><Toaster/></>;
  if (auth === 'setup') return <><main className="login"><div className="login-card auth-onboarding"><AuthenticatorSetup onComplete={() => {setAuth('in'); refresh().catch(() => {});}}/><button className="link-btn" onClick={async () => {try {await post('/api/logout', {}); clearPrivateCache(); window.dispatchEvent(new Event('cm:unauthorized'));} catch (err) {setError(err.message);}}}>Cerrar sesión</button>{error && <p className="form-error" role="alert">{error}</p>}</div></main><Toaster/></>;
  if (!state) return <div className="boot"><Spinner size={22}/> Conectando con el servidor… {error && <small>{error}</small>}</div>;

  const {path} = location;
  const workspace = path.match(/^\/p\/([a-z0-9-]+)\/?$/);
  const context = {state, refresh, error};
  return <AppContext.Provider value={context}>
    {workspace
      ? <Suspense fallback={<div className="boot"><Spinner size={22}/> Abriendo el proyecto…</div>}><Workspace key={workspace[1]} name={workspace[1]}/></Suspense>
      : <Shell path={path}>
          {path === '/agent' ? <Suspense fallback={<div className="boot"><Spinner size={22}/> Despertando al agente…</div>}><General/></Suspense> : path === '/projects' ? <Projects/> : path === '/new' ? <Create/> : path === '/queue' ? <Queue/> : path === '/server' ? <Server/> : path === '/settings' ? <Settings onLogout={() => window.dispatchEvent(new Event('cm:unauthorized'))}/> : <Home/>}
        </Shell>}
    <Toaster/>
  </AppContext.Provider>;
}

function Shell({path, children}) {
  const {state, error} = useApp();
  const working = state.task_records.filter(t => t.status === 'working').length;
  const queued = state.task_records.filter(t => t.status === 'espera').length;
  const approvals = state.approvals?.length || 0;
  const recent = [...state.projects].sort((a, b) => b.activity - a.activity).slice(0, 8);
  const items = [
    {to: '/', label: 'Inicio', icon: HomeIcon},
    {to: '/projects', label: 'Proyectos', icon: FolderOpen},
    {to: '/agent', label: 'Agente', icon: Sparkles, accent: true},
    {to: '/queue', label: 'Cola', icon: ListTodo, badge: approvals || working + queued || 0, alert: approvals > 0},
    {to: '/server', label: 'Servidor', icon: ServerIcon},
    {to: '/settings', label: 'Ajustes', icon: SettingsIcon},
  ];
  const go = (event, to) => {
    event.preventDefault();
    // La esfera de la barra «viaja» al centro: el agente general anima su llegada desde esta posición.
    if (to === '/agent' && path !== '/agent') window.cmOrbLaunch = event.currentTarget.querySelector('.orb-visual, .brand-orb')?.getBoundingClientRect() || null;
    navigate(to); window.scrollTo(0, 0);
  };
  return <div className={path === '/agent' ? 'shell general-shell' : 'shell'}>
    <aside className="side">
      <a href="/" className="brand" onClick={event => go(event, '/')}><span className="brand-orb" aria-hidden="true"/><span>Codex <b>Manager</b></span></a>
      <nav>{items.map(item => <a key={item.to} href={item.to} onClick={event => go(event, item.to)} className={`side-link ${path === item.to ? 'on' : ''} ${item.accent ? 'accent' : ''}`}>
        <span className="side-nav-icon">{item.accent ? <Orb className="nav-orb"/> : <item.icon size={18}/>}</span><span>{item.label}</span>{item.badge ? <em className={item.alert ? 'alert' : ''}>{item.badge}</em> : null}
      </a>)}</nav>
      <div className="side-label">RECIENTES</div>
      <div className="side-projects">{recent.map(p => <a key={p.name} href={`/p/${p.name}`} onClick={event => go(event, `/p/${p.name}`)}>
        <span className={p.working.length ? 'dot live' : p.running_containers ? 'dot on' : 'dot'}/>{p.name}</a>)}</div>
      <div className="side-foot"><span className={state.docker_ok && state.tmux_ok ? 'dot on' : 'dot bad'}/>{state.docker_ok && state.tmux_ok ? 'Servidor en línea' : 'Revisa el servidor'}</div>
    </aside>
    <div className="page">
      {error && <div className="offline-bar"><WifiOff size={15}/>{error}</div>}
      {!state.tmux_ok && <div className="offline-bar warn"><ShieldAlert size={15}/>El servidor tmux del host no responde: los agentes no pueden arrancar. Ejecuta <code>sudo systemctl restart codex-tmux</code>.</div>}
      {children}
    </div>
    <nav className="bottom-nav" aria-label="Navegación principal">{items.filter(item => item.to !== '/settings').map(item => <a key={item.to} href={item.to} onClick={event => go(event, item.to)} aria-label={item.label} aria-current={path === item.to ? 'page' : undefined} className={`${path === item.to ? 'on' : ''} ${item.accent ? 'accent' : ''}`}>
      <span className="bn-icon">{item.accent ? <Orb className="nav-orb"/> : <item.icon size={23} strokeWidth={1.6}/>}{item.badge ? <em className={item.alert ? 'alert' : ''}>{item.badge}</em> : null}</span><span>{item.label}</span>
    </a>)}</nav>
  </div>;
}
