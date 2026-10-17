import React, {useMemo, useState} from 'react';
import {ArrowLeft, Check, Globe2, Rocket, Sparkles, Wand2} from 'lucide-react';
import {useApp} from '../App.jsx';
import {navigate, post, PROJECT_NAME, slugify} from '../lib.js';
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
  const existing = useMemo(() => new Set(state.projects.map(p => p.name)), [state.projects]);

  const suggested = useMemo(() => {
    let base = slugify(idea) || 'mi-proyecto';
    let candidate = base, n = 2;
    while (existing.has(candidate)) candidate = `${base}-${n++}`;
    return candidate;
  }, [idea, existing]);
  const finalName = nameTouched ? name : suggested;
  const nameError = !finalName ? 'Escribe un nombre' : !PROJECT_NAME.test(finalName) ? 'Solo minúsculas, números y guiones (sin guion al final)' : existing.has(finalName) ? 'Ya existe un proyecto con ese nombre' : '';
  const willBuild = build && idea.trim().length > 0;

  const submit = async event => {
    event.preventDefault();
    if (busy || nameError) return;
    setBusy(true); setError('');
    try {
      const result = await post('/api/projects', {action: 'create', name: finalName, description: idea.trim(), stack, provider, deploy, build: willBuild}, {timeout: 60000});
      toast(result.message, 'success');
      await refresh().catch(() => {});
      navigate(`/p/${finalName}?tab=${willBuild ? 'agent' : 'files'}`);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return <form className="create" onSubmit={submit}>
    <header className="create-head">
      <button type="button" className="icon-btn" onClick={() => history.length > 1 ? history.back() : navigate('/')} aria-label="Volver"><ArrowLeft size={20}/></button>
      <div><div className="eyebrow">NUEVO PROYECTO</div><h1>Crea algo nuevo</h1></div>
    </header>

    <section className="create-step">
      <div className="step-label"><span>1</span> Describe tu app</div>
      <div className="prompt-box tall">
        <textarea value={idea} onChange={e => setIdea(e.target.value)} rows={5} autoFocus={!idea}
          placeholder="Ej.: Una app para mi taquería donde los clientes vean el menú, armen su pedido y lo manden por WhatsApp. Colores cálidos, fotos grandes y botón flotante de pedido."/>
        <div className="prompt-tools"><small className="muted">{idea.trim() ? `${idea.trim().length} caracteres` : 'Mientras más detalle, mejor resultado'}</small><span className="grow"/>
          <VoiceButton onText={text => setIdea(current => current ? `${current} ${text}` : text)}/></div>
      </div>
    </section>

    <section className="create-step">
      <div className="step-label"><span>2</span> Tecnología</div>
      <div className="stack-grid">{Object.entries(state.stacks || {auto: 'La IA decide'}).map(([key, label]) => <button type="button" key={key} className={stack === key ? 'stack on' : 'stack'} onClick={() => setStack(key)}>
        {key === 'auto' ? <Wand2 size={18}/> : <Sparkles size={18}/>}<b>{label}</b><small>{STACK_HINTS[key]}</small>{stack === key && <Check size={16} className="stack-check"/>}
      </button>)}</div>
    </section>

    <section className="create-step">
      <div className="step-label"><span>3</span> Agente que lo construye</div>
      <div className="agent-grid">{Object.entries(AGENTS).map(([key, agent]) => <button type="button" key={key} className={provider === key ? 'agent-card on' : 'agent-card'} onClick={() => setProvider(key)}>
        <ProviderMark provider={key} size={34}/><div><b>{agent.name}</b><small className="by">{agent.by}</small><small>{agent.text}</small></div>{provider === key && <Check size={18} className="stack-check"/>}
      </button>)}</div>
    </section>

    <section className="create-step">
      <div className="step-label"><span>4</span> Nombre y dirección</div>
      <div className={nameError ? 'name-field invalid' : 'name-field'}>
        <input value={finalName} onChange={e => { setNameTouched(true); setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-')); }} aria-label="Nombre del proyecto" spellCheck={false} autoCapitalize="none"/>
        <span>.{state.domain || 'devdj.lat'}</span>
      </div>
      <small className={nameError ? 'form-error' : 'muted'}>{nameError || <><Globe2 size={13}/> Se publicará en https://{finalName}.{state.domain || 'devdj.lat'} con HTTPS</>}</small>
      <div className="toggles">
        <label className="toggle"><input type="checkbox" checked={deploy} onChange={e => setDeploy(e.target.checked)}/><span/>Publicar una primera versión al instante</label>
        <label className="toggle"><input type="checkbox" checked={build} onChange={e => setBuild(e.target.checked)}/><span/>Que el agente empiece a construirlo ya</label>
      </div>
    </section>

    {error && <div className="form-error block-error">{error}</div>}
    <div className="create-submit">
      <button className="btn primary big" disabled={busy || !!nameError}>{busy ? <Spinner/> : <Rocket size={18}/>}{willBuild ? 'Crear y empezar a construir' : 'Crear proyecto'}</button>
      {build && !idea.trim() && <small className="muted">Sin descripción solo se crea el proyecto base; luego puedes hablar con el agente.</small>}
    </div>
  </form>;
}
