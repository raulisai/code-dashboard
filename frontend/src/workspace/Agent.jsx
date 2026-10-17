import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {AlertTriangle, ArrowDown, ArrowUp, Bot, Brain, Check, CheckCircle2, ChevronDown, Circle, CircleDot, Clock3, FileCode2, FilePen, FilePlus2, FileText,
  GitCommitHorizontal, Globe2, ListChecks, Paperclip, RotateCcw, Search, ShieldCheck, ShieldQuestion, Square, SquareTerminal, Trash2, Wrench, X} from 'lucide-react';
import {api, duration, navigate, post, providerLabel, relPath, setQuery, useLocation, useNow, usePolling} from '../lib.js';
import ModelPicker from './ModelPicker.jsx';
import Markdown from '../Markdown.jsx';
import {insertDictation} from '../voice.js';
import {Confirm, ProviderMark, ProviderPicker, Spinner, toast, VoiceButton} from '../ui.jsx';

const EXPLORE = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'ToolSearch']);
const SUGGESTIONS = [
  'Explícame cómo está organizado este proyecto y cómo se despliega',
  'Revisa que la web funcione bien en celular y corrige lo que falle',
  'Mejora el diseño: más moderno, mejor tipografía y espaciado',
  'Revisa los logs del contenedor y arregla cualquier error',
];

function draftKey(project, chatId) { return chatId === 'main' ? `cm-draft-${project}` : `cm-draft-${project}-${chatId}`; }
function providerKey(project, chatId) { return chatId === 'main' ? `cm-provider-${project}` : `cm-provider-${project}-${chatId}`; }

export default function Agent({project, active}) {
  const {query} = useLocation();
  const requestedChat = query.get('chat');
  const [chats, setChats] = useState([]), [error, setError] = useState('');
  const [selected, setSelected] = useState(() => { try { return requestedChat || localStorage.getItem(`cm-chat-${project.name}`) || 'main'; } catch { return requestedChat || 'main'; } });
  const selection = useRef(selected);
  selection.current = selected;
  useEffect(() => { if (requestedChat && requestedChat !== selection.current) setSelected(requestedChat); }, [requestedChat]);
  const [title, setTitle] = useState(''), [editing, setEditing] = useState(false), [saving, setSaving] = useState(false);
  const [generation, setGeneration] = useState(0);
  const load = async () => {
    const current = selected;
    const result = await api(`/api/agent/chats?project=${encodeURIComponent(project.name)}`);
    if (selection.current !== current) return;
    setChats(result.chats); setError('');
    if (!result.chats.some(chat => chat.id === current)) choose('main');
  };
  usePolling(async () => { try { await load(); } catch (err) { setError(err.message); } }, 3000, [project.name, selected, active]);
  const choose = id => { selection.current = id; setSelected(id); setEditing(false); setQuery('chat', id); try { localStorage.setItem(`cm-chat-${project.name}`, id); } catch { /* sin almacenamiento */ } };
  const save = async event => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const result = await post('/api/agent/chats', {project: project.name, title, ...(editing === 'rename' ? {action: 'rename', chat_id: selected} : {})});
      if (result.chat) { setChats(rows => [...rows, result.chat]); choose(result.chat.id); }
      else { setChats(rows => rows.map(chat => chat.id === selected ? {...chat, title: title.trim()} : chat)); setEditing(false); }
      setTitle('');
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    const chat = chats.find(row => row.id === selected), main = selected === 'main';
    if (!chat || saving) return;
    if (chat.working) { toast('Detén la petición en curso antes de eliminar este chat', 'error'); return; }
    const queued = chat.queued ? ` Se cancelarán ${chat.queued} mensaje(s) en cola.` : '';
    if (!window.confirm(main ? `¿Vaciar el Chat principal? Su historial se oculta y Claude y Codex empiezan de cero.${queued} Los archivos del proyecto no se tocan.`
      : `¿Eliminar el chat «${chat.title}»? Desaparece de la lista junto con su contexto.${queued} Los archivos del proyecto no se tocan.`)) return;
    setSaving(true);
    try {
      const result = await post('/api/agent/chats', {project: project.name, action: 'delete', chat_id: selected});
      try { for (const key of [draftKey(project.name, selected), `${draftKey(project.name, selected)}-files`, providerKey(project.name, selected)]) localStorage.removeItem(key); } catch { /* sin almacenamiento */ }
      toast(result.message);
      if (main) setGeneration(value => value + 1);
      else { setChats(rows => rows.filter(row => row.id !== selected)); choose('main'); }
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };
  const current = chats.find(chat => chat.id === selected);
  return <div className="agent-chats">
    <div className="chat-selector">
      <label htmlFor={`chat-${project.name}`}>Chat</label>
      <select className="select" id={`chat-${project.name}`} value={selected} onChange={event => choose(event.target.value)} aria-label="Sesión de chat">
        {!chats.length && <option value={selected}>Cargando chats…</option>}
        {chats.map(chat => <option key={chat.id} value={chat.id}>{chat.title}{chat.working ? ` · ${chat.working} en curso` : ''}{chat.queued ? ` · ${chat.queued} en cola` : ''}</option>)}
      </select>
      <button className="btn small" onClick={() => { setTitle(''); setEditing('create'); }}>+ Nuevo chat</button>
      {selected !== 'main' && <button className="btn small" onClick={() => { setTitle(current?.title || ''); setEditing('rename'); }} aria-label="Renombrar chat"><FilePen size={14}/></button>}
      {current && <button className="btn small danger-soft" onClick={remove} disabled={saving} aria-label={selected === 'main' ? 'Vaciar chat principal' : 'Eliminar chat'} title={selected === 'main' ? 'Vaciar chat principal' : 'Eliminar chat'}><Trash2 size={14}/></button>}
    </div>
    {editing && <form className="chat-name-form" onSubmit={save}>
      <input className="input" autoFocus value={title} maxLength={100} onChange={event => setTitle(event.target.value)} placeholder="Nombre del chat (ej. Diseño, errores, despliegue)" aria-label="Nombre del chat"/>
      <button className="btn small" disabled={saving || (editing === 'rename' && !title.trim())}>{saving ? 'Guardando…' : editing === 'rename' ? 'Guardar' : 'Crear'}</button>
      <button type="button" className="ghost-icon" onClick={() => setEditing(false)} aria-label="Cancelar"><X size={16}/></button>
    </form>}
    <small className="chat-shared-note">Claude y Codex comparten el contexto de cada chat · Archivos compartidos entre chats</small>
    {error && <div className="timeline-error">{error}</div>}
    <ChatConversation key={`${project.name}:${selected}:${generation}`} project={project} active={active} chatId={selected}/>
  </div>;
}

function ChatConversation({project, active, chatId, attachments = true}) {
  const name = project.name;
  const [data, setData] = useState(null), [error, setError] = useState('');
  const storedProvider = providerKey(name, chatId);
  const [provider, setProvider] = useState(() => { try { return localStorage.getItem(storedProvider) || null; } catch { return null; } });
  const [text, setText] = useState(() => { try { return localStorage.getItem(draftKey(name, chatId)) || ''; } catch { return ''; } });
  const modelKey = `${storedProvider}-models`;
  const [models, setModels] = useState(() => { try { return JSON.parse(localStorage.getItem(modelKey) || '{}') || {}; } catch { return {}; } });
  const attachmentKey = `${draftKey(name, chatId)}-files`;
  const [files, setFiles] = useState(() => { try { const stored = JSON.parse(localStorage.getItem(attachmentKey)); return Array.isArray(stored) ? stored.filter(path => typeof path === 'string') : []; } catch { return []; } }), [uploading, setUploading] = useState(false), [sending, setSending] = useState(false);
  useEffect(() => { try { files.length ? localStorage.setItem(attachmentKey, JSON.stringify(files)) : localStorage.removeItem(attachmentKey); } catch { /* sin almacenamiento */ } }, [files, attachmentKey]);
  const [expanded, setExpanded] = useState({});
  const rev = useRef(''), scroller = useRef(null), stick = useRef(true), previous = useRef({});
  const [unseen, setUnseen] = useState(false);
  const busy = data && (data.working.length > 0 || data.queue.length > 0);

  const load = async () => {
    const result = await api(`/api/agent?project=${encodeURIComponent(name)}&chat_id=${encodeURIComponent(chatId)}&rev=${rev.current}`);
    setError('');
    if (result.same) return;
    rev.current = result.rev;
    // Aviso cuando una ejecución termina (y recarga de la vista previa).
    for (const run of result.runs) {
      const before = previous.current[run.id];
      if (before === 'running' && run.status !== 'running' && run.status !== 'stopping') {
        window.dispatchEvent(new CustomEvent('cm:run-finished', {detail: {project: name, status: run.status}}));
        if (!active || document.hidden) toast(`${providerLabel(run.provider)} ${run.status === 'done' ? 'terminó' : run.status === 'stopped' ? 'se detuvo' : 'falló'} en ${name}`, run.status === 'done' ? 'success' : 'error');
      }
      previous.current[run.id] = run.status;
    }
    setData(result);
  };
  usePolling(async () => { try { await load(); } catch (err) { setError(err.message); } }, () => (busy ? 1200 : 4000), [name, busy, active]);

  const nextProvider = provider || data?.runs.at(-1)?.provider || data?.settings?.default_provider || 'claude';
  const selectedModel = models[nextProvider] || '';
  const selectedEffort = models[`${nextProvider}-effort`] || '';
  const chooseModel = (value, effort = '') => {
    const next = {...models, [nextProvider]: value, [`${nextProvider}-effort`]: effort}; setModels(next);
    try { localStorage.setItem(modelKey, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
  };
  const chooseProvider = value => { setProvider(value); try { localStorage.setItem(storedProvider, value); } catch { /* sin almacenamiento */ } };
  useEffect(() => { try { text ? localStorage.setItem(draftKey(name, chatId), text) : localStorage.removeItem(draftKey(name, chatId)); } catch { /* sin almacenamiento */ } }, [text, name, chatId]);

  // Mantener el scroll abajo mientras llega salida nueva, salvo que el usuario haya subido a leer.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (stick.current) el.scrollTop = el.scrollHeight; else setUnseen(true);
  }, [data]);
  useEffect(() => { if (active && scroller.current && stick.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [active]);
  const onScroll = event => {
    const el = event.currentTarget;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (stick.current) setUnseen(false);
  };
  const toBottom = () => { stick.current = true; setUnseen(false); scroller.current?.scrollTo({top: scroller.current.scrollHeight, behavior: 'smooth'}); };

  const send = async event => {
    event?.preventDefault();
    return sendMessage(text);
  };
  const sendMessage = async value => {
    let message = value.trim();
    if (sending || uploading || (!message && !files.length)) return false;
    if (files.length) message += `\n\nArchivos adjuntos (rutas dentro del proyecto):\n${files.map(path => `- ${path}`).join('\n')}`;
    setSending(true);
    try {
      await post('/api/agent/send', {project: name, chat_id: chatId, provider: nextProvider, model: selectedModel, effort: selectedEffort, text: message.trim()});
      try { localStorage.removeItem(draftKey(name, chatId)); localStorage.removeItem(attachmentKey); } catch { /* sin almacenamiento */ }
      setText(''); setFiles([]); stick.current = true;
      rev.current = '';
      await load();
      return true;
    } catch (err) { toast(err.message, 'error'); return false; }
    finally { setSending(false); }
  };

  const upload = async event => {
    const chosen = [...(event.target.files || [])];
    event.target.value = '';
    if (!chosen.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      chosen.forEach(file => form.append('file', file));
      const result = await api(`/api/files/upload?project=${encodeURIComponent(name)}`, {method: 'POST', body: form, timeout: 120000});
      setFiles(list => [...list, ...result.paths]);
    } catch (err) { toast(err.message, 'error'); }
    finally { setUploading(false); }
  };

  const act = async (request, success) => {
    try { const result = await request(); if (success !== false) toast(success || result.message); rev.current = ''; await load(); }
    catch (err) { toast(err.message, 'error'); }
  };
  const answer = (approval, decision, remember = false) => act(() => post('/api/approvals', {run_id: approval.run_id, request_id: approval.id, decision, remember}), false);
  const stopRun = run => act(() => post(`/api/runs/${run.id}/stop`, {}));
  const retry = run => act(() => post('/api/tasks', {action: 'retry', id: run.task_id}), 'Reintentando…');
  const cancel = task => act(() => post('/api/tasks', {action: 'delete', id: task.id}), 'Mensaje quitado de la cola');
  const reset = () => { if (window.confirm('¿Reiniciar el contexto de este chat? Claude y Codex empezarán de cero; el historial visible se conserva.')) act(() => post('/api/agent/reset', {project: name, chat_id: chatId, provider: nextProvider})); };
  const expand = async run => {
    try { const full = await api(`/api/runs/${run.id}`); setExpanded(map => ({...map, [run.id]: full})); }
    catch (err) { toast(err.message, 'error'); }
  };

  const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  const sessionId = data?.sessions?.[nextProvider];
  const hasContext = !!(data && (data.runs.length || Object.values(data.sessions || {}).some(Boolean)));
  const lastProvider = data?.runs.at(-1)?.provider;
  const switching = !!(lastProvider && lastProvider !== nextProvider);
  return <div className="agent">
    <div className="agent-bar">
      <ProviderPicker value={nextProvider} onChange={chooseProvider} compact/>
      <span className="grow"/>
      <span className="conv-state" title={sessionId ? `Sesión ${sessionId}` : ''}>{!hasContext ? 'Conversación nueva' : switching ? `${providerLabel(nextProvider)} retoma el chat` : 'Conversación continua'}</span>
      {hasContext && <button className="btn small" onClick={reset} disabled={!!busy} title="Reiniciar el contexto de este chat para Claude y Codex"><RotateCcw size={14}/>Reiniciar</button>}
    </div>

    <div className="timeline" ref={scroller} onScroll={onScroll}>
      {!data ? <div className="timeline-loading"><Spinner/> Cargando conversación…</div>
        : !data.runs.length && !data.queue.length ? <Intro project={name} provider={nextProvider} onPick={setText}/>
        : <>
          {data.runs.map(run => <Run key={run.id} run={expanded[run.id] || run} project={name} onExpand={() => expand(run)} onApprove={answer} onStop={() => stopRun(run)} onRetry={() => retry(run)}/>)}
          {data.queue.map(task => <div className="msg user queued" key={task.id}>
            <div className="bubble"><div className="queued-label"><Clock3 size={13}/> En cola para {providerLabel(task.provider)} · sale cuando termine la petición actual</div><Clamp text={task.details || task.title}/></div>
            <button className="ghost-icon" onClick={() => cancel(task)} aria-label="Quitar de la cola"><X size={15}/></button>
          </div>)}
        </>}
      {error && <div className="timeline-error"><AlertTriangle size={15}/>{error}</div>}
    </div>
    {unseen && <button className="new-pill" onClick={toBottom}><ArrowDown size={14}/> Nueva actividad</button>}

    <form className="composer" onSubmit={send}>
      {files.length > 0 && <div className="attachments">{files.map(path => <span key={path} className="chip">{isImage(path) ? <img className="attachment-thumb" src={rawFile(name, path)} alt=""/> : <Paperclip size={12}/>}<a href={rawFile(name, path)} target="_blank" rel="noreferrer">{path.split('/').pop()}</a><button type="button" onClick={() => setFiles(list => list.filter(x => x !== path))} aria-label="Quitar"><X size={12}/></button></span>)}</div>}
      <div className="composer-box">
        <textarea value={text} onChange={e => setText(e.target.value)} rows={1} placeholder={`Pide algo a ${providerLabel(nextProvider)}…`}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !coarse) { e.preventDefault(); send(); } }}
          onInput={e => { e.target.style.height = 'auto'; e.target.style.height = `${Math.min(220, e.target.scrollHeight)}px`; }}/>
        {name !== '_general' && <ModelPicker provider={nextProvider} model={selectedModel} effort={selectedEffort} onChange={chooseModel} configured={data?.settings?.[`${nextProvider}_model`]}/>}
        <div className="composer-tools">
          {attachments && <label className="icon-btn" title="Adjuntar archivo o imagen" aria-label="Adjuntar">{uploading ? <Spinner/> : <Paperclip size={18}/>}<input type="file" multiple hidden onChange={upload}/></label>}
          <VoiceButton active={active} disabled={sending || uploading} onText={value => setText(current => insertDictation(current, value))}
            onSend={value => sendMessage(insertDictation(text, value))} sendLabel={`Enviar a ${providerLabel(nextProvider)}`}/>
          <span className="grow"/>
          {data?.working.length > 0 && <small className="muted queue-hint">Se pondrá en cola</small>}
          <button className="send-btn" disabled={sending || uploading || (!text.trim() && !files.length)} aria-label="Enviar">{sending ? <Spinner/> : <ArrowUp size={19}/>}</button>
        </div>
      </div>
    </form>
  </div>;
}

function Intro({project, provider, onPick}) {
  return <div className="intro">
    <div className="intro-icon"><Bot size={26}/></div>
    <h3>¿Qué hacemos en {project}?</h3>
    <p className="muted">Escribe o dicta lo que necesitas. {providerLabel(provider)} trabaja en el servidor y verás aquí cada paso en vivo.</p>
    <div className="intro-list">{SUGGESTIONS.map(text => <button key={text} onClick={() => onPick(text)}>{text}</button>)}</div>
  </div>;
}

function Clamp({text, lines = 8}) {
  const [open, setOpen] = useState(false);
  const long = String(text || '').split('\n').length > lines || String(text || '').length > 600;
  return <>
    <div className={long && !open ? 'clamp' : ''} style={{'--lines': lines}}><Markdown text={text}/></div>
    {long && <button className="link-btn" onClick={() => setOpen(!open)}>{open ? 'Ver menos' : 'Ver todo'}</button>}
  </>;
}

function Run({run, project, onExpand, onApprove, onStop, onRetry}) {
  const now = useNow(1000);
  const running = run.status === 'running' || run.status === 'stopping';
  const elapsed = (run.finished_at || now / 1000) - run.created_at;
  const items = useMemo(() => groupEvents(run.events || []), [run.events]);
  const todo = useMemo(() => latestTodo(run.events || []), [run.events]);
  return <div className="run">
    <div className="msg user"><div className="bubble">{run.origin === 'create' && <div className="queued-label"><Bot size={13}/> Construcción inicial del proyecto</div>}<Clamp text={run.prompt} lines={run.origin === 'create' ? 4 : 10}/><AttachmentPreviews prompt={run.prompt} project={project}/></div></div>
    <div className="msg agent">
      <ProviderMark provider={run.provider} size={26}/>
      <div className="agent-body">
        <div className="agent-meta"><b>{providerLabel(run.provider)}</b>{run.model && <span>{run.model}</span>}{run.handoff > 0 ? <span title={`Recibió el resumen de ${run.handoff} petición(es) anteriores de este chat`}>retoma el chat</span> : run.resumed && <span>continúa</span>}</div>
        {todo && <TodoCard todo={todo}/>}
        {run.events ? items.map((item, index) => <EventItem key={index} item={item} project={project} last={running && index === items.length - 1}/>)
          : <div className="collapsed-run"><span className="muted">{run.event_count} pasos</span>{run.result?.text && <Clamp text={run.result.text} lines={6}/>}<button className="link-btn" onClick={onExpand}>Ver todos los pasos</button></div>}
        {(run.approvals || []).map(approval => <Approval key={approval.id} approval={approval} project={project} onAnswer={onApprove}/>)}
        {running && <div className="working-row"><span className="working-bars"><i/><i/><i/></span>
          <span>{run.status === 'stopping' ? 'Deteniendo…' : (run.approvals || []).length ? 'Esperando tu aprobación' : `${providerLabel(run.provider)} está trabajando`} · {duration(elapsed)}</span>
          <button className="btn small danger-soft" onClick={onStop} disabled={run.status === 'stopping'}><Square size={12} fill="currentColor"/>Detener</button></div>}
        {!running && <RunFooter run={run} elapsed={elapsed} onRetry={onRetry}/>}
        {!running && run.version?.commit && <RunVersion run={run} project={project}/>}
      </div>
    </div>
  </div>;
}

const isImage = path => /\.(png|jpe?g|gif|webp|svg|ico|avif|bmp)$/i.test(path);
const rawFile = (project, path) => `/api/files/raw?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`;

function AttachmentPreviews({prompt, project}) {
  const paths = String(prompt || '').split('\n').filter(line => line.startsWith('- .codex-manager/uploads/')).map(line => line.slice(2)).filter(isImage);
  if (!paths.length) return null;
  return <div className="attachment-previews">{paths.map(path => <a key={path} href={rawFile(project, path)} target="_blank" rel="noreferrer"><img src={rawFile(project, path)} alt={path.split('/').pop()} loading="lazy"/></a>)}</div>;
}

// Cada respuesta que cambió archivos queda como versión: verla o deshacer solo esos cambios.
function RunVersion({run, project}) {
  const [asking, setAsking] = useState(false), [busy, setBusy] = useState(false);
  const sha = run.version.commit;
  const revert = async () => {
    setBusy(true);
    try { toast((await post('/api/git', {project, action: 'revert', rev: sha}, {timeout: 240000})).message, 'success'); setAsking(false); }
    catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  };
  return <div className="run-version"><GitCommitHorizontal size={14}/><span>Versión <code>{sha.slice(0, 7)}</code> guardada</span>
    <button className="link-btn" onClick={() => navigate(`/p/${project}?tab=git&version=${sha}`)}>Ver</button>
    <button className="link-btn" onClick={() => setAsking(true)}>Deshacer estos cambios</button>
    {asking && <Confirm title="Deshacer esta respuesta" confirmLabel={busy ? 'Deshaciendo…' : 'Deshacer'} onCancel={() => !busy && setAsking(false)} onConfirm={() => !busy && revert()}
      text={`Se quitan solo los cambios que hizo ${providerLabel(run.provider)} en esta respuesta; lo posterior se conserva. Queda como una versión nueva y puedes volver a rehacerlo desde Versiones.`}/>}
  </div>;
}

function RunFooter({run, elapsed, onRetry}) {
  const result = run.result || {};
  const parts = [duration(result.duration_ms ? result.duration_ms / 1000 : elapsed)];
  if (result.cost) parts.push(`$${Number(result.cost).toFixed(2)}`);
  if (result.turns) parts.push(`${result.turns} turnos`);
  if (result.usage?.output_tokens) parts.push(`${Math.round((result.usage.input_tokens + result.usage.output_tokens) / 1000)}k tokens`);
  if (run.status === 'error') return <div className="run-error"><AlertTriangle size={16}/><div><b>No se completó</b><small>{run.error || result.text || 'El agente terminó con un error.'}</small>{run.limits?.resetsAt && <small>Cupo disponible: {new Date(run.limits.resetsAt * 1000).toLocaleString([], {dateStyle: 'short', timeStyle: 'short'})}</small>}</div>
    {run.task_id && <button className="btn small" onClick={onRetry}><RotateCcw size={13}/>Reintentar</button>}</div>;
  return <div className={`run-foot ${run.status}`}>{run.status === 'stopped' ? <><Square size={12}/>Detenido</> : <><CheckCircle2 size={14}/>Terminado</>} · {parts.filter(Boolean).join(' · ')}
    {result.denials ? <span className="warn-text"> · {result.denials} acción(es) denegadas</span> : null}</div>;
}

function groupEvents(events) {
  const items = [];
  for (const event of events) {
    if (event.t === 'tool' && (event.name === 'TodoWrite')) continue;
    if (event.t === 'todo') continue;
    const last = items[items.length - 1];
    if (event.t === 'tool' && EXPLORE.has(event.name) && !event.sub) {
      if (last?.t === 'group') { last.items.push(event); continue; }
      items.push({t: 'group', items: [event]});
      continue;
    }
    items.push(event);
  }
  return items.map(item => item.t === 'group' && item.items.length === 1 ? item.items[0] : item);
}

function latestTodo(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.t === 'todo') return event.items;
    if (event.t === 'tool' && event.name === 'TodoWrite' && Array.isArray(event.input?.todos)) return event.input.todos;
  }
  return null;
}

function TodoCard({todo}) {
  const done = todo.filter(item => item.status === 'completed').length;
  const [open, setOpen] = useState(true);
  return <div className="todo-card">
    <button className="todo-head" onClick={() => setOpen(!open)}><ListChecks size={15}/><b>Plan</b><span>{done}/{todo.length}</span><div className="todo-bar"><i style={{width: `${todo.length ? done / todo.length * 100 : 0}%`}}/></div><ChevronDown size={15} className={open ? 'rot' : ''}/></button>
    {open && <ul>{todo.map((item, index) => <li key={index} className={item.status}>{item.status === 'completed' ? <CheckCircle2 size={14}/> : item.status === 'in_progress' ? <CircleDot size={14}/> : <Circle size={14}/>}<span>{item.status === 'in_progress' && item.activeForm ? item.activeForm : item.content}</span></li>)}</ul>}
  </div>;
}

function EventItem({item, project, last}) {
  if (item.t === 'text') return <div className={item.sub ? 'agent-text sub' : 'agent-text'}><Markdown text={item.text}/></div>;
  if (item.t === 'thinking') return <details className="thinking"><summary><Brain size={13}/> Razonamiento</summary><div className="thinking-text">{item.text}</div></details>;
  if (item.t === 'notice') return <div className="notice-line">{item.text}</div>;
  if (item.t === 'error') return <div className="notice-line error"><AlertTriangle size={13}/>{item.text}</div>;
  if (item.t === 'group') return <details className="tool group"><summary><Search size={14}/><span className="verb">Exploró {item.items.length} {item.items.length === 1 ? 'elemento' : 'elementos'}</span>
    <span className="tool-detail-inline">{item.items.slice(0, 3).map(e => toolInfo(e, project).detail).filter(Boolean).join(', ')}</span>{last && item.items.some(e => e.status === 'running') ? <Spinner size={13}/> : <Check size={13} className="ok-icon"/>}</summary>
    <div className="tool-body">{item.items.map((event, i) => <ToolRow key={i} event={event} project={project}/>)}</div></details>;
  if (item.t === 'tool') return <ToolRow event={item} project={project}/>;
  return null;
}

function toolInfo(event, project) {
  const input = event.input || {};
  const path = value => relPath(value, project);
  const running = event.status === 'running';
  switch (event.name) {
    case 'Bash': return {icon: SquareTerminal, verb: running ? 'Ejecutando' : 'Ejecutó', detail: input.description && input.command?.length > 80 ? input.description : input.command, code: true};
    case 'Read': return {icon: FileText, verb: 'Leyó', detail: path(input.file_path)};
    case 'Write': return {icon: FilePlus2, verb: running ? 'Creando' : 'Escribió', detail: path(input.file_path)};
    case 'Edit': case 'MultiEdit': return {icon: FilePen, verb: running ? 'Editando' : 'Editó', detail: path(input.file_path)};
    case 'NotebookEdit': return {icon: FilePen, verb: 'Editó', detail: path(input.notebook_path)};
    case 'Glob': return {icon: Search, verb: 'Buscó archivos', detail: input.pattern};
    case 'Grep': return {icon: Search, verb: 'Buscó', detail: input.pattern};
    case 'LS': return {icon: Search, verb: 'Listó', detail: path(input.path)};
    case 'WebFetch': return {icon: Globe2, verb: 'Consultó', detail: input.url};
    case 'WebSearch': return {icon: Globe2, verb: 'Buscó en la web', detail: input.query};
    case 'Task': case 'Agent': return {icon: Bot, verb: 'Subagente', detail: input.description};
    case 'FileChange': return {icon: FileCode2, verb: running ? 'Modificando' : 'Modificó', detail: (input.changes || []).map(change => path(change.path)).join(', ')};
    default: return {icon: Wrench, verb: String(event.name || 'Herramienta').replace(/^mcp__/, '').replace(/__/g, ' · '), detail: ''};
  }
}

function ToolRow({event, project}) {
  const info = toolInfo(event, project);
  const Icon = info.icon;
  const input = event.input || {};
  return <details className={`tool ${event.status}${event.sub ? ' sub' : ''}`}>
    <summary><Icon size={14}/><span className="verb">{info.verb}</span>{info.detail && (info.code ? <code className="tool-detail-inline">{info.detail}</code> : <span className="tool-detail-inline">{info.detail}</span>)}
      {event.status === 'running' ? <Spinner size={13}/> : event.status === 'error' ? <X size={14} className="err-icon"/> : <Check size={13} className="ok-icon"/>}</summary>
    <div className="tool-body">
      {event.name === 'Bash' && <pre className="tool-cmd">$ {input.command}</pre>}
      {(event.name === 'Edit') && <Diff before={input.old_string} after={input.new_string}/>}
      {event.name === 'MultiEdit' && (input.edits || []).map((edit, i) => <Diff key={i} before={edit.old_string} after={edit.new_string}/>)}
      {event.name === 'Write' && <pre className="tool-out">{String(input.content || '').split('\n').slice(0, 80).join('\n')}</pre>}
      {event.name === 'FileChange' && <ul className="change-list">{(input.changes || []).map((change, i) => <li key={i}><span className={`kind ${change.kind}`}>{change.kind}</span>{relPath(change.path, project)}</li>)}</ul>}
      {!['Bash', 'Edit', 'MultiEdit', 'Write', 'FileChange'].includes(event.name) && Object.keys(input).length > 0 && <pre className="tool-out">{JSON.stringify(input, null, 2)}</pre>}
      {event.output && <pre className={event.status === 'error' ? 'tool-out error' : 'tool-out'}>{event.output}</pre>}
      {event.exit_code != null && event.exit_code !== 0 && <small className="err-text">Código de salida {event.exit_code}</small>}
    </div>
  </details>;
}

function Diff({before, after}) {
  return <div className="diff">
    {String(before || '').split('\n').slice(0, 60).map((line, i) => <div key={`a${i}`} className="del">- {line}</div>)}
    {String(after || '').split('\n').slice(0, 60).map((line, i) => <div key={`b${i}`} className="add">+ {line}</div>)}
  </div>;
}

function approvalSummary(approval) {
  const input = approval.input || {};
  if (approval.tool_name === 'Bash') return {verb: 'ejecutar un comando', body: input.command, note: input.description};
  if (approval.tool_name === 'WebFetch') return {verb: 'consultar una página', body: input.url, note: input.prompt};
  if (approval.tool_name === 'WebSearch') return {verb: 'buscar en la web', body: input.query};
  if (['Write', 'Edit', 'MultiEdit'].includes(approval.tool_name)) return {verb: 'modificar un archivo fuera del proyecto', body: input.file_path};
  return {verb: `usar ${approval.tool_name}`, body: JSON.stringify(input, null, 2)};
}

function ruleLabel(rule) {
  if (!rule) return '';
  return rule.startsWith('Bash:') ? `«${rule.slice(5)}»` : rule;
}

function Approval({approval, onAnswer}) {
  const [busy, setBusy] = useState('');
  const summary = approvalSummary(approval);
  const answer = async (decision, remember) => { setBusy(decision + remember); await onAnswer(approval, decision, remember); setBusy(''); };
  return <div className="approval">
    <div className="approval-head"><ShieldQuestion size={18}/><b>{providerLabel(approval.provider || 'claude')} quiere {summary.verb}</b></div>
    {summary.note && <small className="muted">{summary.note}</small>}
    <pre>{summary.body}</pre>
    <div className="approval-actions">
      <button className="btn" disabled={!!busy} onClick={() => answer('deny', false)}>{busy === 'denyfalse' ? <Spinner/> : <X size={15}/>}Denegar</button>
      {approval.rule && <button className="btn" disabled={!!busy} onClick={() => answer('allow', true)} title="No volver a preguntar en este proyecto">{busy === 'allowtrue' ? <Spinner/> : <ShieldCheck size={15}/>}Siempre {ruleLabel(approval.rule)}</button>}
      <button className="btn primary" disabled={!!busy} onClick={() => answer('allow', false)}>{busy === 'allowfalse' ? <Spinner/> : <Check size={15}/>}Permitir</button>
    </div>
  </div>;
}

export {Approval, ChatConversation};
