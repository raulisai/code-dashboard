import React, {useEffect, useMemo, useRef, useState} from 'react';
import {AlertTriangle, ArrowLeft, Check, CheckCircle2, GitBranch, Globe2, Rocket, Sparkles, Wand2} from 'lucide-react';
import {useApp} from '../App.jsx';
import {api, navigate, post, PROJECT_NAME, slugify} from '../lib.js';
import {ProviderMark, Spinner, toast, VoiceButton} from '../ui.jsx';

const STACK_HINTS = {
  auto: 'El agente elige lo más simple que funcione', web: 'Sitio estático rápido, sin build', react: 'SPA moderna con componentes',
  node: 'API y servidor en JavaScript', python: 'API en Python con docs automáticas', next: 'React con rutas y SSR', game: 'Canvas / Three.js, táctil',
};
const AGENTS = {
  claude: {name: 'Claude Code', by: 'Anthropic', text: 'Edita el proyecto por su cuenta y te pide permiso en la app para comandos y despliegues.'},
  codex: {name: 'Codex', by: 'OpenAI', text: 'Trabaja con acceso completo al proyecto, como ya estaba configurado en el servidor.'},
};

export default function Create() {
  const {state, refresh} = useApp();
  const params = new URLSearchParams(location.search);
  const [idea, setIdea] = useState(params.get('idea') || '');
  const [stack, setStack] = useState('auto');
  const [provider, setProvider] = useState(params.get('provider') || state.settings?.default_provider || 'claude');
  const [name, setName] = useState(''), [nameTouched, setNameTouched] = useState(false);
  const [deploy, setDeploy] = useState(true), [build, setBuild] = useState(!params.get('blank'));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [source, setSource] = useState(params.get('repo') ? 'repo' : 'new');
  const [repoUrl, setRepoUrl] = useState(params.get('repo') || ''), [repo, setRepo] = useState(null), [branch, setBranch] = useState('');
  const [github, setGithub] = useState(true), [githubStatus, setGithubStatus] = useState(null);
  const importing = source === 'repo';
  const existing = useMemo(() => new Set(state.projects.map(p => p.name)), [state.projects]);
  useEffect(() => { api('/api/github').then(setGithubStatus).catch(() => setGithubStatus({connected: false})); }, []);

  // Validación en el servidor (ls-remote con la llave del VPS) un momento después de dejar de escribir.
  const checking = useRef('');
  const checkRepo = async value => {
    const url = value.trim();
    if (!url) { setRepo(null); return; }
    checking.current = url;
    setRepo({url, state: 'checking'});
    try {
      const result = await api('/api/projects/repo-check', {method: 'POST', body: {url}, timeout: 60000});
      if (checking.current !== url) return;
      setRepo({...result, input: url, state: 'ok'}); setBranch(result.default_branch || '');
    } catch (err) { if (checking.current === url) setRepo({input: url, state: 'error', error: err.message}); }
  };
  useEffect(() => {
    if (!importing || !repoUrl.trim()) { setRepo(null); return; }
    const timer = setTimeout(() => checkRepo(repoUrl), 900);
    return () => clearTimeout(timer);
  }, [repoUrl, importing]);
  const repoReady = repo?.state === 'ok' && repo.input === repoUrl.trim();

  const suggested = useMemo(() => {
    let base = (importing && repoReady && repo.suggested) || slugify(idea) || 'mi-proyecto';
    let candidate = base, n = 2;
    while (existing.has(candidate)) candidate = `${base}-${n++}`;
    return candidate;
  }, [idea, existing, importing, repoReady, repo]);
  const finalName = nameTouched ? name : suggested;
  const nameError = !finalName ? 'Escribe un nombre' : !PROJECT_NAME.test(finalName) ? 'Solo minúsculas, números y guiones (sin guion al final)' : existing.has(finalName) ? 'Ya existe un proyecto con ese nombre' : '';
  const importsCode = importing && repoReady && !repo.empty;
  const willBuild = build && (importsCode || idea.trim().length > 0);
  const githubOn = !importing && github && !!githubStatus?.connected;
  const blocked = busy || !!nameError || (importing && !repoReady);

  const submit = async event => {
    event.preventDefault();
    if (blocked) return;
    setBusy(true); setError('');
    try {
      const payload = {action: 'create', name: finalName, description: idea.trim(), stack, provider, deploy: deploy && !importsCode, build: willBuild};
      if (importing) Object.assign(payload, {repo_url: repo.url, repo_branch: branch});
      else payload.github = githubOn;
      const result = await post('/api/projects', payload, {timeout: importing ? 660000 : 240000});
      toast(result.message, 'success');
      await refresh().catch(() => {});
      navigate(`/p/${finalName}?tab=${willBuild ? 'agent' : 'files'}`);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  let step = 0;
  const next = () => ++step; // los pasos ocultos no dejan huecos en la numeración
  return <form className="create" onSubmit={submit}>
    <header className="create-head">
      <button type="button" className="icon-btn" onClick={() => history.length > 1 ? history.back() : navigate('/')} aria-label="Volver"><ArrowLeft size={20}/></button>
      <div><div className="eyebrow">NUEVO PROYECTO</div><h1>Crea algo nuevo</h1></div>
    </header>

    <div className="segmented source-picker" role="radiogroup" aria-label="Origen del proyecto">
      <button type="button" role="radio" aria-checked={!importing} className={!importing ? 'on' : ''} onClick={() => setSource('new')}><Sparkles size={16}/>Nuevo desde cero</button>
      <button type="button" role="radio" aria-checked={importing} className={importing ? 'on' : ''} onClick={() => setSource('repo')}><GitBranch size={16}/>Desde un repo Git</button>
    </div>

    {importing && <section className="create-step">
      <div className="step-label"><span>{next()}</span> Repositorio Git</div>
      <div className={repo?.state === 'error' ? 'name-field invalid repo-field' : 'name-field repo-field'}>
        <input value={repoUrl} onChange={e => setRepoUrl(e.target.value)} onBlur={() => repoUrl.trim() && !repoReady && repo?.state !== 'checking' && checkRepo(repoUrl)}
          placeholder="https://github.com/usuario/repo o git@github.com:usuario/repo.git" aria-label="URL del repositorio" spellCheck={false} autoCapitalize="none" autoCorrect="off" inputMode="url" autoFocus/>
      </div>
      {repo?.state === 'checking' && <small className="muted repo-status"><Spinner size={13}/> Comprobando acceso al repositorio…</small>}
      {repo?.state === 'error' && repo.input === repoUrl.trim() && <small className="form-error repo-status"><AlertTriangle size={13}/> {repo.error}</small>}
      {repoReady && <div className="repo-ok">
        <small className="repo-status ok"><CheckCircle2 size={14}/> Repositorio accesible{repo.empty ? ' · está vacío: se creará la base del proyecto' : ` · ${repo.branches.length} rama${repo.branches.length === 1 ? '' : 's'}`}</small>
        {repo.branches.length > 1 && <label className="field repo-branch"><span>Rama a clonar</span>
          <select className="select" value={branch} onChange={e => setBranch(e.target.value)}>{repo.branches.map(name => <option key={name} value={name}>{name}{name === repo.default_branch ? ' (principal)' : ''}</option>)}</select></label>}
        <small className="muted">Se clona con todo su historial y ramas; quedarán disponibles en Versiones.</small>
      </div>}
      {!repo && <small className="muted">Privados de GitHub incluidos: el servidor entra con su llave SSH{githubStatus?.login ? ` (${githubStatus.login})` : ''}.</small>}
    </section>}

    <section className="create-step">
      <div className="step-label"><span>{next()}</span> {importing ? 'Indicaciones para el agente (opcional)' : 'Describe tu app'}</div>
      <div className="prompt-box tall">
        <textarea value={idea} onChange={e => setIdea(e.target.value)} rows={importing ? 3 : 5} autoFocus={!idea && !importing}
          placeholder={importing ? 'Ej.: Actualiza las dependencias y cambia el título a «Mi taller».' : 'Ej.: Una app para mi taquería donde los clientes vean el menú, armen su pedido y lo manden por WhatsApp. Colores cálidos, fotos grandes y botón flotante de pedido.'}/>
        <div className="prompt-tools"><small className="muted">{idea.trim() ? `${idea.trim().length} caracteres` : 'Mientras más detalle, mejor resultado'}</small><span className="grow"/>
          <VoiceButton onText={text => setIdea(current => current ? `${current} ${text}` : text)}/></div>
      </div>
    </section>

    {!importsCode && <section className="create-step">
      <div className="step-label"><span>{next()}</span> Tecnología</div>
      <div className="stack-grid">{Object.entries(state.stacks || {auto: 'La IA decide'}).map(([key, label]) => <button type="button" key={key} className={stack === key ? 'stack on' : 'stack'} onClick={() => setStack(key)}>
        {key === 'auto' ? <Wand2 size={18}/> : <Sparkles size={18}/>}<b>{label}</b><small>{STACK_HINTS[key]}</small>{stack === key && <Check size={16} className="stack-check"/>}
      </button>)}</div>
    </section>}

    <section className="create-step">
      <div className="step-label"><span>{next()}</span> {importsCode ? 'Agente que lo adapta y publica' : 'Agente que lo construye'}</div>
      <div className="agent-grid">{Object.entries(AGENTS).map(([key, agent]) => <button type="button" key={key} className={provider === key ? 'agent-card on' : 'agent-card'} onClick={() => setProvider(key)}>
        <ProviderMark provider={key} size={34}/><div><b>{agent.name}</b><small className="by">{agent.by}</small><small>{agent.text}</small></div>{provider === key && <Check size={18} className="stack-check"/>}
      </button>)}</div>
    </section>

    <section className="create-step">
      <div className="step-label"><span>{next()}</span> Nombre y dirección</div>
      <div className={nameError ? 'name-field invalid' : 'name-field'}>
        <input value={finalName} onChange={e => { setNameTouched(true); setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-')); }} aria-label="Nombre del proyecto" spellCheck={false} autoCapitalize="none"/>
        <span>.{state.domain || 'devdj.lat'}</span>
      </div>
      <small className={nameError ? 'form-error' : 'muted'}>{nameError || <><Globe2 size={13}/> Se publicará en https://{finalName}.{state.domain || 'devdj.lat'} con HTTPS</>}</small>
      <div className="toggles">
        {!importing && <label className={githubStatus?.connected ? 'toggle' : 'toggle disabled'}><input type="checkbox" checked={githubOn} disabled={!githubStatus?.connected} onChange={e => setGithub(e.target.checked)}/><span/>
          <div>Crear también el repositorio en GitHub (privado)<small className="muted toggle-note">{githubStatus?.connected ? `En la cuenta ${githubStatus.login}; se sube el primer commit.` : githubStatus ? <>Conecta GitHub en <a href="/settings" onClick={event => { event.preventDefault(); navigate('/settings'); }}>Ajustes</a> para activarlo. El repo Git local se crea siempre.</> : 'Comprobando GitHub…'}</small></div></label>}
        {!importsCode && <label className="toggle"><input type="checkbox" checked={deploy} onChange={e => setDeploy(e.target.checked)}/><span/>Publicar una primera versión al instante</label>}
        <label className="toggle"><input type="checkbox" checked={build} onChange={e => setBuild(e.target.checked)}/><span/>{importsCode ? 'Que el agente lo adapte al servidor y lo publique' : 'Que el agente empiece a construirlo ya'}</label>
      </div>
    </section>

    {error && <div className="form-error block-error">{error}</div>}
    <div className="create-submit">
      <button className="btn primary big" disabled={blocked}>{busy ? <Spinner/> : <Rocket size={18}/>}{busy && importing ? 'Clonando repositorio…' : importing ? (willBuild ? 'Importar y adaptar' : 'Importar proyecto') : willBuild ? 'Crear y empezar a construir' : 'Crear proyecto'}</button>
      {importing && !repoReady && <small className="muted">Pega y valida la URL del repositorio para continuar.</small>}
      {!importing && build && !idea.trim() && <small className="muted">Sin descripción solo se crea el proyecto base; luego puedes hablar con el agente.</small>}
    </div>
  </form>;
}
