import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Activity, ArrowUp, AudioLines, Bot, Box, Brain, Check, CircleAlert, CircleCheck, Clock3, FilePen, FlaskConical, FolderOpen, GitBranch, Globe2, Hammer, Keyboard, MessagesSquare, Mic, MoreHorizontal, Package,
  RotateCcw, Search, Server as ServerIcon, ShieldCheck, Sparkles, Square, SquareTerminal, Volume2, VolumeX, X} from 'lucide-react';
import {useApp} from '../App.jsx';
import {api, navigate, post, useNow, usePolling} from '../lib.js';
import {Spinner, toast} from '../ui.jsx';
import {Approval} from '../workspace/Agent.jsx';
import {GENERAL, activityRows, detectProject, duration, presence, speakable} from '../general.js';
import {voiceSettings} from '../voice.js';
import Presentations from '../Presentations.jsx';
import Orb from '../Orb.jsx';
import useOrbVoice from '../useOrbVoice.js';
import '../general.css';

const KIND_ICONS = {git: GitBranch, docker: Box, test: FlaskConical, web: Globe2, server: ServerIcon, package: Package, build: Hammer, edit: FilePen, read: Search, agent: Bot, terminal: SquareTerminal};
const STATE_ICONS = {...KIND_ICONS, idle: Sparkles, thinking: Brain, listening: Mic, speaking: AudioLines, transcribing: AudioLines, queue: Clock3, error: CircleAlert, approval: ShieldCheck, done: CircleCheck, stopping: Square};
const SPEAK_KEY = 'cm-general-speak', VOICE_TASKS = 'cm-general-voice-tasks';
const AUTO_SEND_SECONDS = .15;

const stored = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* sin almacenamiento */ } };
const voiceTasks = () => { try { return JSON.parse(sessionStorage.getItem(VOICE_TASKS) || '[]'); } catch { return []; } };

export default function General() {
  const {state} = useApp();
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [speak, setSpeak] = useState(() => stored(SPEAK_KEY, 'on') === 'on'), [speaking, setSpeaking] = useState(false);
  const [pending, setPending] = useState(null), [typing, setTyping] = useState(false), [text, setText] = useState(() => stored('cm-draft-general', '')), [sending, setSending] = useState(false);
  const [conversation, setConversation] = useState(false), [voiceEngine, setVoiceEngine] = useState(() => stored('cm-general-voice-engine', 'auto'));
  const [menu, setMenu] = useState(false), [sheet, setSheet] = useState(false), [details, setDetails] = useState(false), [responseOpen, setResponseOpen] = useState(false), [arrival, setArrival] = useState('');
  const requestedTask = useRef(null), menuRef = useRef(null), inputRef = useRef(null), sheetInputRef = useRef(null);
  const [viewport, setViewport] = useState(() => ({height: window.visualViewport?.height || window.innerHeight, keyboard: false}));
  const inFlight = useRef(false), transcript = useRef(null), continuous = useRef(false), waiting = useRef(false), voiceRef = useRef(null), resumeTimer = useRef(null), editing = useRef(false);
  continuous.current = conversation; editing.current = typing;
  const rev = useRef(''), previous = useRef({}), clock = useRef({}), orbRef = useRef(null), now = useNow(1000);
  const voice = useOrbVoice(value => setPending({text: value, until: Date.now() + AUTO_SEND_SECONDS * 1000}), {engine: voiceEngine});
  voiceRef.current = voice;
  const resumeListening = () => { clearTimeout(resumeTimer.current); resumeTimer.current = setTimeout(() => { if (continuous.current && !waiting.current && !editing.current && !document.hidden && voiceRef.current.phase === 'idle') voiceRef.current.start(); }, 250); };
  const endConversation = () => { continuous.current = false; waiting.current = false; setConversation(false); clearTimeout(resumeTimer.current); voiceRef.current.cancel(); try { speechSynthesis.cancel(); } catch {} setSpeaking(false); };
  useEffect(() => { const hidden = () => { if (document.hidden) endConversation(); }; document.addEventListener('visibilitychange', hidden); return () => { clearTimeout(resumeTimer.current); document.removeEventListener('visibilitychange', hidden); }; }, []);
  useEffect(() => { if (voice.error) { continuous.current = false; setConversation(false); } }, [voice.error]);

  useEffect(() => { try { text ? localStorage.setItem('cm-draft-general', text) : localStorage.removeItem('cm-draft-general'); } catch { /* sin almacenamiento */ } }, [text]);
  useEffect(() => {
    const update = () => setViewport({height: window.visualViewport?.height || window.innerHeight, keyboard: (window.visualViewport?.height || window.innerHeight) < window.innerHeight - 150});
    window.visualViewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => { window.visualViewport?.removeEventListener('resize', update); window.removeEventListener('resize', update); };
  }, []);
  useEffect(() => {
    if (!menu) return;
    const outside = event => { if (!menuRef.current?.contains(event.target)) setMenu(false); };
    const escape = event => { if (event.key === 'Escape') { setMenu(false); menuRef.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menu]);
  useLayoutEffect(() => {
    for (const input of [inputRef.current, sheetInputRef.current]) {
      if (!input) continue;
      input.style.height = 'auto';
      input.style.height = `${Math.min(120, input.scrollHeight)}px`;
    }
  }, [text, typing, sheet, viewport.height]);
  useEffect(() => { if (sheet && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [sheet]);

  const load = async () => {
    const result = await api(`/api/agent?project=${GENERAL}&chat_id=main&rev=${rev.current}`);
    setError('');
    if (result.same) return;
    rev.current = result.rev;
    for (const run of result.runs) {
      const before = previous.current[run.id];
      if (run.status === 'done' && run.task_id === requestedTask.current) { setResponseOpen(true); requestedTask.current = null; }
      if (before !== 'done' && run.status === 'done' && waiting.current === run.task_id && voiceTasks().includes(run.task_id)) { waiting.current = false; if (!speak || voiceRef.current.phase !== 'idle' || !say(run.result?.text)) resumeListening(); }
      previous.current[run.id] = run.status;
    }
    if (!result.working.length && !result.queue.length && result.runs.at(-1)?.status === 'error' && waiting.current) { waiting.current = false; continuous.current = false; setConversation(false); }
    setData(result);
  };
  const busy = !!data && (data.working.length > 0 || data.queue.length > 0);
  usePolling(async () => { try { await load(); } catch (err) { setError(err.message); } }, () => (busy ? 500 : 1500), [busy, speak]);

  const latest = data?.runs.at(-1);
  const running = latest && (latest.status === 'running' || latest.status === 'stopping');
  const nextProvider = data?.settings?.default_provider || state.settings?.default_provider || 'claude';
  const events = useMemo(() => latest?.events || [], [latest]);
  const rows = useMemo(() => activityRows(events, 12), [events]);
  // Codex no manda horas por evento: se cronometra desde que el panel ve empezar cada comando.
  events.forEach((event, index) => {
    if (event.t !== 'tool' || event.t0) return;
    const key = `${latest.id}:${index}`, seen = clock.current[key];
    if (!seen) clock.current[key] = event.status === 'running' ? {t0: Date.now() / 1000, t1: null} : {};
    else if (seen.t0 && !seen.t1 && event.status !== 'running') seen.t1 = Date.now() / 1000;
  });
  const timed = row => row.t0 ? row : {...row, t0: clock.current[`${latest.id}:${row.first}`]?.t0 || null, t1: clock.current[`${latest.id}:${row.last}`]?.t1 || null};
  const names = useMemo(() => state.projects.map(project => project.name), [state.projects]);
  const project = useMemo(() => detectProject(events, names), [events, names]);
  const reply = !running && latest?.status === 'done' ? latest.result?.text : '';
  const showResponse = responseOpen && !!reply;
  const status = presence({run: latest, queued: data?.queue.length || 0, phase: voice.phase, speaking, sending: sending || !!pending,
    connected: !!data, error: error || voice.error});
  const StatusIcon = STATE_ICONS[status.kind] || Sparkles;
  const typingLine = running ? ([...events].reverse().find(event => event.t === 'text' && !event.sub)?.text || '').split('\n').filter(Boolean).at(-1) : '';

  // La esfera de la barra viaja al centro y crece hasta su sitio (la posición sale de App.jsx).
  useLayoutEffect(() => {
    const from = window.cmOrbLaunch, element = orbRef.current;
    window.cmOrbLaunch = null;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!from) { setArrival('fade'); return; }
    const to = element.getBoundingClientRect();
    element.style.setProperty('--from-x', `${from.left + from.width / 2 - (to.left + to.width / 2)}px`);
    element.style.setProperty('--from-y', `${from.top + from.height / 2 - (to.top + to.height / 2)}px`);
    element.style.setProperty('--from-s', String(Math.max(.12, from.width / to.width)));
    setArrival('launch');
  }, []);

  // Mensaje dictado: se envía solo tras unos segundos salvo que lo edites o lo canceles.
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(async () => { const ok = await send(pending.text, true); setPending(null); if (!ok) { setText(pending.text); setTyping(true); } }, Math.max(0, pending.until - Date.now()));
    return () => clearTimeout(timer);
  }, [pending]);
  useEffect(() => () => { try { speechSynthesis.cancel(); } catch { /* sin voz */ } }, []);

  const say = value => {
    const content = speakable(value);
    if (!content || !('speechSynthesis' in window)) return false;
    const utterance = new SpeechSynthesisUtterance(content);
    const language = voiceSettings().language;
    utterance.lang = !language || language === 'auto' || language === 'es' ? 'es-MX' : language;
    utterance.onend = utterance.onerror = () => { setSpeaking(false); resumeListening(); };
    try { speechSynthesis.cancel(); speechSynthesis.speak(utterance); setSpeaking(true); return true; } catch { return false; }
  };
  const unlockSpeech = () => {
    // iOS solo permite hablar si antes hubo un gesto: se «desbloquea» con un enunciado vacío.
    try { if (speak && 'speechSynthesis' in window && !speechSynthesis.speaking) speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch { /* sin voz */ }
  };

  const send = async (message, viaVoice = false) => {
    const value = String(message || '').trim();
    if (!value || inFlight.current) return false;
    inFlight.current = true; setSending(true);
    try {
      const result = await post('/api/agent/send', {project: GENERAL, chat_id: 'main', provider: nextProvider, text: value});
      requestedTask.current = result.task?.id || null; setResponseOpen(false);
      if (viaVoice) waiting.current = result.task?.id || true;
      try { if (viaVoice && result.task?.id) sessionStorage.setItem(VOICE_TASKS, JSON.stringify([...voiceTasks().slice(-20), result.task.id])); } catch { /* el envío ya está confirmado */ }
      rev.current = ''; try { await load(); } catch (err) { setError(err.message); }
      return true;
    } catch (err) { toast(err.message, 'error'); return false; }
    finally { inFlight.current = false; setSending(false); }
  };
  const tapOrb = () => {
    if (speaking) { speechSynthesis.cancel(); setSpeaking(false); }
    if (voice.phase === 'listening') return voice.stop();
    if (voice.phase !== 'idle') return;
    setPending(null); setConversation(true); continuous.current = true; voice.clearError(); unlockSpeech(); voice.start();
  };
  const act = async (request, success) => {
    try { const result = await request(); if (success !== false) toast(success || result.message); rev.current = ''; await load(); }
    catch (err) { toast(err.message, 'error'); }
  };
  const stopRun = () => latest && act(() => post(`/api/runs/${latest.id}/stop`, {}));
  const reset = () => { setMenu(false); if (window.confirm('¿Empezar una conversación nueva con el agente general? El historial se conserva.')) act(() => post('/api/agent/reset', {project: GENERAL, chat_id: 'main', provider: nextProvider})); };
  const toggleSpeak = () => { const value = !speak; setSpeak(value); remember(SPEAK_KEY, value ? 'on' : 'off'); if (!value) { setSpeaking(false); try { speechSynthesis.cancel(); } catch { /* sin voz */ } } };
  const answer = (approval, decision, rememberRule = false) => act(() => post('/api/approvals', {run_id: approval.run_id, request_id: approval.id, decision, remember: rememberRule}), false);
  const submitTyped = async event => { event?.preventDefault(); if (await send(text)) { setText(''); setTyping(false); } };

  const orbState = voice.phase === 'listening' ? 'listening' : voice.phase !== 'idle' || sending || pending ? 'thinking' : speaking ? 'speaking' : running ? 'working' : busy || waiting.current ? 'thinking' : 'idle';
  const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  const openTyping = () => { endConversation(); setTyping(true); };
  const openSheet = () => { setMenu(false); endConversation(); setSheet(true); };
  return <div className={`general ${arrival ? `arrive-${arrival}` : ''} ${showResponse ? 'has-response' : ''} ${typing ? 'is-typing' : ''} ${viewport.keyboard ? 'keyboard-open' : ''}`}
    style={{'--view-height': `${viewport.height}px`}}>
    <header className="general-top">
      <h1 className="general-identity"><span className="dot live"/>Agente general</h1>
      <span className="grow"/>
      <button className="round-btn" onClick={openSheet} aria-label="Ver conversación" title="Ver conversación"><MessagesSquare size={19}/></button>
      <div className="general-menu" ref={menuRef}>
        <button className="round-btn" onClick={() => setMenu(!menu)} aria-label="Más opciones" aria-expanded={menu} aria-controls="general-options"><MoreHorizontal size={20}/></button>
        {menu && <div className="general-popover" id="general-options">
          <button onClick={() => { setMenu(false); setDetails(true); }}><Activity size={16}/>Ver actividad</button>
          <button onClick={() => navigate('/projects')}><FolderOpen size={16}/>Ver proyectos</button>
          <button onClick={toggleSpeak}>{speak ? <Volume2 size={16}/> : <VolumeX size={16}/>}Leer respuestas en voz alta: {speak ? 'sí' : 'no'}</button>
          <button onClick={() => { endConversation(); const value = voiceEngine === 'auto' ? 'local' : voiceEngine === 'local' ? 'local-precise' : 'auto'; setVoiceEngine(value); remember('cm-general-voice-engine', value); }}>Voz: {voiceEngine === 'local' ? 'local rápida' : voiceEngine === 'local-precise' ? 'local precisa' : 'rápida del navegador + respaldo local'}</button>
          <small className="voice-privacy">La voz rápida puede usar el servicio del navegador. Las opciones locales procesan el audio en este servidor.</small>
          <button onClick={reset} disabled={busy}><RotateCcw size={16}/>Conversación nueva</button>
        </div>}
      </div>
    </header>

    {(latest?.approvals || []).map(approval => <div className="general-approval" key={approval.id}><Approval approval={approval} onAnswer={answer}/></div>)}

    <div className="general-stage">
      <div className="general-orbit" data-mode={orbState}>
        <button ref={orbRef} className={`live-orb ${arrival === 'launch' ? 'launch' : ''}`} data-state={orbState} onClick={tapOrb}
          onAnimationEnd={event => { if (event.target === event.currentTarget) setArrival(''); }}
          aria-label={voice.phase === 'listening' ? 'Terminar de hablar' : 'Hablar con el agente general'}>
          <Orb state={orbState} level={voice.level}/>
        </button>
        <span className="orb-state-icon" key={status.kind} aria-hidden="true"><StatusIcon size={21} strokeWidth={1.6}/></span>
      </div>
      <div className="general-status" data-kind={status.kind} role="status" aria-live="polite" aria-atomic="true">
        <span className="presence-dot" aria-hidden="true"/><span className="general-state-label">{status.title}</span>
      </div>
      {(voice.phase === 'listening' || voice.phase === 'transcribing') && <div className="live-transcript">
        <p>{voice.interim || (voice.phase === 'listening' ? (voice.engine === 'browser' ? 'Transcripción en vivo' : 'Voz local · termina al hacer una pausa') : '')}</p>
      </div>}
    </div>

    {pending && <div className="pending-message"><p>«{pending.text}»</p>
      <div className="pending-actions"><button className="btn small" onClick={() => { setText(pending.text); setPending(null); openTyping(); }}>Editar</button>
        <button className="btn small" onClick={() => setPending(null)}>Cancelar</button></div></div>}

    {showResponse && <section className="general-response" aria-label="Respuesta del agente general">
      <header><span><CircleCheck size={16}/>Tu respuesta</span><button className="round-btn" onClick={() => setResponseOpen(false)} aria-label="Ocultar respuesta" title="Ocultar respuesta"><X size={17}/></button></header>
      <div className="response-content"><Presentations text={reply}/></div>
    </section>}

    {(error || voice.error || latest?.status === 'error' && !busy) && <div className="general-error" role="alert">
      <p>{error || voice.error || status.subtitle}</p>
      {latest?.status === 'error' && !busy && <button className="btn small" onClick={() => send(latest.prompt)}>Reintentar con una conexión disponible</button>}
    </div>}

    <div className="general-actions" aria-label="Controles del agente general">
      <button className={`general-action ${conversation ? 'selected' : ''}`} onClick={conversation ? endConversation : tapOrb}
        aria-label={conversation ? 'Terminar conversación' : 'Hablar'} title={conversation ? 'Terminar conversación' : 'Hablar'} disabled={!conversation && voice.phase !== 'idle'}>
        {conversation ? <Square size={19}/> : <Mic size={20}/>}<span>{conversation ? 'Terminar' : 'Hablar'}</span>
      </button>
      <button className={`general-action ${typing ? 'selected' : ''}`} onClick={typing ? () => setTyping(false) : openTyping} aria-label="Escribir" aria-expanded={typing} aria-controls="general-compose" title="Escribir"><Keyboard size={20}/><span>Escribir</span></button>
      <button className="general-action" onClick={() => setDetails(true)} aria-label="Ver actividad" title="Ver actividad"><Activity size={20}/><span>Actividad</span>{running && <i className="action-live"/>}</button>
      {reply && <button className={`general-action ${showResponse ? 'selected' : ''}`} onClick={() => setResponseOpen(!responseOpen)} aria-label="Ver respuesta" aria-expanded={showResponse} title="Ver respuesta"><MessagesSquare size={20}/><span>Respuesta</span></button>}
      {running && <button className="general-action stop-action" onClick={stopRun} disabled={latest.status === 'stopping'} aria-label="Detener tarea" title="Detener tarea"><Square size={18}/><span>Detener</span></button>}
    </div>

    {typing && <form className="general-compose" id="general-compose" onSubmit={submitTyped}>
      <textarea ref={inputRef} aria-label="Mensaje al agente general" autoFocus rows={1} value={text} onChange={event => setText(event.target.value)} placeholder="Escribe tu mensaje…"
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !coarse) { event.preventDefault(); submitTyped(); } if (event.key === 'Escape') setTyping(false); }}/>
      <button type="button" className="round-btn" onClick={() => setTyping(false)} aria-label="Cerrar teclado"><X size={18}/></button>
      <button className="send-btn" disabled={sending || !text.trim()} aria-label="Enviar">{sending ? <Spinner/> : <ArrowUp size={19}/>}</button>
    </form>}

    {details && <AgentDialog className="general-details" label="Actividad del agente general" onClose={() => setDetails(false)}>
      <div className="sheet-head"><b>Actividad del agente general</b><span className="grow"/><button className="round-btn" onClick={() => setDetails(false)} aria-label="Cerrar actividad"><X size={18}/></button></div>
      <div className="general-detail-content">
        <p className="detail-status"><StatusIcon size={18}/>{status.title}</p>
        {project && <button className="general-project" onClick={() => navigate(`/p/${project}`)}><FolderOpen size={16}/>{project}</button>}
        {latest?.prompt && <p className="detail-question">{latest.prompt}</p>}
        {!!rows.length && <section className="general-activity" aria-label="Actividad en tiempo real">
          {rows.map((row, index) => { const Icon = KIND_ICONS[row.kind] || SquareTerminal; return <div className={`activity-row ${row.status}`} key={index}>
            <span className="activity-state">{row.status === 'running' ? <span className="ring"/> : row.status === 'error' ? <X size={13}/> : <Check size={13}/>}</span>
            <Icon size={20} strokeWidth={1.6} className="activity-icon"/>
            <div className="activity-text"><code>{row.command || row.title}</code><small>{row.detail}</small></div>
            <span className="activity-time">{duration(timed(row), now / 1000)}</span>
          </div>; })}
          {typingLine && <p className="detail-text">{typingLine}</p>}
        </section>}
        {!rows.length && <p className="detail-empty">{running ? 'Preparando la tarea…' : 'Sin herramientas ejecutadas en esta conversación.'}</p>}
        <dl className="detail-server"><div><dt>Proyectos</dt><dd>{state.projects.length}</dd></div><div><dt>En línea</dt><dd>{state.projects.filter(item => item.running_containers).length}</dd></div>
          {state.cpu && <div><dt>CPU</dt><dd>{Math.round(state.cpu.percent || 0)}%</dd></div>}</dl>
        {running && <button className="btn danger-soft" onClick={stopRun} disabled={latest.status === 'stopping'}><Square size={14}/>Detener tarea</button>}
      </div>
    </AgentDialog>}

    {sheet && <AgentDialog className="general-sheet" label="Conversación con el agente general" onClose={() => setSheet(false)}>
      <div className="sheet-head"><b>Agente general</b><span className="grow"/><button className="round-btn" onClick={() => setSheet(false)} aria-label="Cerrar"><X size={18}/></button></div>
      <div className="general-transcript" ref={transcript}>{!(data?.runs || []).length && <p className="detail-empty">Tu conversación aparecerá aquí.</p>}{(data?.runs || []).map(run => <React.Fragment key={run.id}>
        <div className="conversation-message from-you"><small>Tú</small><p>{run.prompt}</p></div>
        <div className="conversation-message"><small>Agente general</small><Presentations text={run.result?.text || (run.status === 'running' ? 'Estoy en ello…' : run.error || 'Conversación finalizada.')}/></div>
      </React.Fragment>)}</div>
      <form className="general-compose sheet-compose" onSubmit={submitTyped}>
        <textarea ref={sheetInputRef} aria-label="Mensaje al agente general" value={text} onChange={event => setText(event.target.value)} placeholder="Seguimos conversando…" rows={1}/>
        <button className="send-btn" disabled={sending || !text.trim()} aria-label="Enviar mensaje">{sending ? <Spinner/> : <ArrowUp size={19}/>}</button>
      </form>
    </AgentDialog>}
  </div>;
}

function AgentDialog({className, label, onClose, children}) {
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current, overflow = document.body.style.overflow;
    element.showModal(); document.body.style.overflow = 'hidden';
    return () => { if (element.open) element.close(); document.body.style.overflow = overflow; };
  }, []);
  return <dialog ref={dialog} className={className} aria-label={label} onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>{children}</dialog>;
}
