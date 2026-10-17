import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {ArrowUp, Bot, Box, Check, FilePen, FlaskConical, FolderOpen, GitBranch, Globe2, Hammer, Keyboard, MessagesSquare, MoreHorizontal, Package,
  RotateCcw, Search, Server as ServerIcon, Square, SquareTerminal, Volume2, VolumeX, X} from 'lucide-react';
import {useApp} from '../App.jsx';
import {api, navigate, post, providerLabel, useNow, usePolling} from '../lib.js';
import {ProviderMark, Spinner, toast} from '../ui.jsx';
import {Approval, ChatConversation} from '../workspace/Agent.jsx';
import {GENERAL, activityRows, detectProject, duration, headline, speakable} from '../general.js';
import {voiceSettings} from '../voice.js';
import useOrbVoice from '../useOrbVoice.js';
import '../general.css';

const KIND_ICONS = {git: GitBranch, docker: Box, test: FlaskConical, web: Globe2, server: ServerIcon, package: Package, build: Hammer, edit: FilePen, read: Search, agent: Bot, terminal: SquareTerminal};
const SUGGESTIONS = ['¿Cómo está el servidor?', '¿Qué proyectos están caídos?', 'Revisa los logs de poleana-game'];
const PROVIDER_KEY = `cm-provider-${GENERAL}`, SPEAK_KEY = 'cm-general-speak', VOICE_TASKS = 'cm-general-voice-tasks';
const AUTO_SEND_SECONDS = 3;

const stored = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* sin almacenamiento */ } };
const voiceTasks = () => { try { return JSON.parse(sessionStorage.getItem(VOICE_TASKS) || '[]'); } catch { return []; } };

export default function General() {
  const {state} = useApp();
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [provider, setProvider] = useState(() => stored(PROVIDER_KEY, null));
  const [speak, setSpeak] = useState(() => stored(SPEAK_KEY, 'on') === 'on'), [speaking, setSpeaking] = useState(false);
  const [pending, setPending] = useState(null), [typing, setTyping] = useState(false), [text, setText] = useState(''), [sending, setSending] = useState(false);
  const [menu, setMenu] = useState(false), [sheet, setSheet] = useState(false), [arrival, setArrival] = useState('');
  const rev = useRef(''), previous = useRef({}), clock = useRef({}), orbRef = useRef(null), now = useNow(1000);
  const voice = useOrbVoice(value => setPending({text: value, until: Date.now() + AUTO_SEND_SECONDS * 1000}));

  const load = async () => {
    const result = await api(`/api/agent?project=${GENERAL}&chat_id=main&rev=${rev.current}`);
    setError('');
    if (result.same) return;
    rev.current = result.rev;
    for (const run of result.runs) {
      const before = previous.current[run.id];
      if (before === 'running' && run.status === 'done' && speak && voiceTasks().includes(run.task_id)) say(run.result?.text);
      previous.current[run.id] = run.status;
    }
    setData(result);
  };
  const busy = !!data && (data.working.length > 0 || data.queue.length > 0);
  usePolling(async () => { try { await load(); } catch (err) { setError(err.message); } }, () => (busy ? 1000 : 3500), [busy, speak]);

  const latest = data?.runs.at(-1);
  const running = latest && (latest.status === 'running' || latest.status === 'stopping');
  const nextProvider = provider || latest?.provider || data?.settings?.default_provider || state.settings?.default_provider || 'codex';
  const events = useMemo(() => latest?.events || [], [latest]);
  const rows = useMemo(() => running ? activityRows(events, window.innerHeight < 680 ? 2 : window.innerHeight < 760 ? 3 : 4) : [], [events, running]);
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
  const online = state.projects.filter(item => item.running_containers).length;
  const status = headline(running ? latest : (data?.queue.length ? null : latest?.status === 'done' ? null : latest), data?.queue.length || 0)
    || {title: '¿Qué hacemos hoy?', subtitle: `${state.projects.length} proyectos · ${online} en línea${state.cpu ? ` · CPU ${Math.round(state.cpu.percent || 0)}%` : ''}`};
  const typingLine = running ? ([...events].reverse().find(event => event.t === 'text' && !event.sub)?.text || '').split('\n').filter(Boolean).at(-1) : '';
  const reply = !running && latest?.status === 'done' ? latest.result?.text : '';
  const subtitle = rows.some(row => row.status === 'running' && (row.detail === status.subtitle || row.command === status.subtitle)) ? '' : status.subtitle;

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
    const timer = setTimeout(() => { send(pending.text, true); setPending(null); }, Math.max(0, pending.until - Date.now()));
    return () => clearTimeout(timer);
  }, [pending]);
  useEffect(() => () => { try { speechSynthesis.cancel(); } catch { /* sin voz */ } }, []);

  const say = value => {
    const content = speakable(value);
    if (!content || !('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(content);
    const language = voiceSettings().language;
    utterance.lang = !language || language === 'auto' || language === 'es' ? 'es-MX' : language;
    utterance.onend = utterance.onerror = () => setSpeaking(false);
    speechSynthesis.cancel(); speechSynthesis.speak(utterance); setSpeaking(true);
  };
  const unlockSpeech = () => {
    // iOS solo permite hablar si antes hubo un gesto: se «desbloquea» con un enunciado vacío.
    try { if (speak && 'speechSynthesis' in window && !speechSynthesis.speaking) speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch { /* sin voz */ }
  };

  const send = async (message, viaVoice = false) => {
    const value = String(message || '').trim();
    if (!value || sending) return false;
    setSending(true);
    try {
      const result = await post('/api/agent/send', {project: GENERAL, chat_id: 'main', provider: nextProvider, text: value});
      if (viaVoice && result.task?.id) sessionStorage.setItem(VOICE_TASKS, JSON.stringify([...voiceTasks().slice(-20), result.task.id]));
      rev.current = ''; await load();
      return true;
    } catch (err) { toast(err.message, 'error'); return false; }
    finally { setSending(false); }
  };
  const tapOrb = () => {
    if (speaking) { speechSynthesis.cancel(); setSpeaking(false); }
    if (voice.phase === 'listening') return voice.stop();
    if (voice.phase !== 'idle') return;
    setPending(null); voice.clearError(); unlockSpeech(); voice.start();
  };
  const chooseProvider = value => { setProvider(value); remember(PROVIDER_KEY, value); };
  const act = async (request, success) => {
    try { const result = await request(); if (success !== false) toast(success || result.message); rev.current = ''; await load(); }
    catch (err) { toast(err.message, 'error'); }
  };
  const stopRun = () => latest && act(() => post(`/api/runs/${latest.id}/stop`, {}));
  const reset = () => { setMenu(false); if (window.confirm('¿Empezar una conversación nueva con el agente general? El historial se conserva.')) act(() => post('/api/agent/reset', {project: GENERAL, chat_id: 'main', provider: nextProvider})); };
  const toggleSpeak = () => { const value = !speak; setSpeak(value); remember(SPEAK_KEY, value ? 'on' : 'off'); if (!value) { try { speechSynthesis.cancel(); } catch { /* sin voz */ } } };
  const answer = (approval, decision, rememberRule = false) => act(() => post('/api/approvals', {run_id: approval.run_id, request_id: approval.id, decision, remember: rememberRule}), false);
  const submitTyped = async event => { event?.preventDefault(); if (await send(text)) { setText(''); setTyping(false); } };

  const orbState = voice.phase === 'listening' ? 'listening' : voice.phase !== 'idle' || sending || pending ? 'thinking' : speaking ? 'speaking' : running ? 'working' : busy ? 'thinking' : 'idle';
  const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  const write = !typing && voice.phase === 'idle' && <button className="write-btn" onClick={() => setTyping(true)}><Keyboard size={15}/>Escribir</button>;
  return <div className={`general ${arrival ? `arrive-${arrival}` : ''} ${rows.length ? 'has-activity' : ''}`}>
    <header className="general-top">
      <div className="provider-pill" role="radiogroup" aria-label="Agente">
        {['codex', 'claude'].map(key => <button key={key} type="button" role="radio" aria-checked={nextProvider === key} className={nextProvider === key ? 'on' : ''} onClick={() => chooseProvider(key)}>
          <ProviderMark provider={key} size={20}/>{providerLabel(key)}</button>)}
      </div>
      <span className="grow"/>
      <div className="general-menu">
        <button className="round-btn" onClick={() => setMenu(!menu)} aria-label="Más opciones" aria-expanded={menu}><MoreHorizontal size={20}/></button>
        {menu && <div className="general-popover" role="menu">
          <button role="menuitem" onClick={() => { setMenu(false); setSheet(true); }}><MessagesSquare size={16}/>Ver conversación</button>
          {project && <button role="menuitem" onClick={() => navigate(`/p/${project}`)}><FolderOpen size={16}/>Abrir {project}</button>}
          <button role="menuitem" onClick={toggleSpeak}>{speak ? <Volume2 size={16}/> : <VolumeX size={16}/>}Leer respuestas en voz alta: {speak ? 'sí' : 'no'}</button>
          <button role="menuitem" onClick={reset} disabled={busy}><RotateCcw size={16}/>Conversación nueva</button>
        </div>}
      </div>
    </header>

    <section className="general-status" aria-live="polite">
      <h1>{status.title}</h1>
      {project && running && <button className="general-project" onClick={() => navigate(`/p/${project}`)}>{project}</button>}
      {subtitle && <p>{subtitle}</p>}
    </section>

    {rows.length > 0 && <section className="general-activity" aria-label="Actividad en tiempo real">
      <div className="activity-head"><span className="dot live"/>Actividad en tiempo real<span className="line"/>
        <button className="activity-stop" onClick={stopRun} disabled={latest.status === 'stopping'}><Square size={11} fill="currentColor"/>Detener</button></div>
      {rows.map((row, index) => { const Icon = KIND_ICONS[row.kind] || SquareTerminal; return <div className={`activity-row ${row.status}`} key={index}>
        <span className="activity-state">{row.status === 'running' ? <span className="ring"/> : row.status === 'error' ? <X size={13}/> : <Check size={13}/>}</span>
        <Icon size={20} strokeWidth={1.6} className="activity-icon"/>
        <div className="activity-text"><code>{row.command || row.title}</code><small>{row.detail}</small></div>
        <span className="activity-time">{duration(timed(row), now / 1000)}</span>
      </div>; })}
      <div className="activity-typing"><SquareTerminal size={15}/><span>{typingLine ? typingLine.slice(0, 90) : 'Trabajando…'}</span><i className="caret"/></div>
    </section>}

    {(latest?.approvals || []).map(approval => <div className="general-approval" key={approval.id}><Approval approval={approval} onAnswer={answer}/></div>)}

    <div className="general-stage">
      <button ref={orbRef} className={`live-orb ${arrival === 'launch' ? 'launch' : ''}`} data-state={orbState} style={{'--level': voice.level}} onClick={tapOrb}
        onAnimationEnd={event => { if (event.target === event.currentTarget) setArrival(''); }}
        aria-label={voice.phase === 'listening' ? 'Terminar de hablar' : 'Hablar con el agente general'}>
        <span className="orb-rings" aria-hidden="true"><i/><i/><i/></span>
        <span className="orb-core" aria-hidden="true"><span className="orb-wave a"/><span className="orb-wave b"/><span className="orb-swirl"/><span className="orb-shine"/></span>
      </button>
    </div>

    <div className="general-caption" aria-live="polite">
      {pending ? <div className="pending-message"><p>«{pending.text}»</p>
          <div className="pending-actions"><small>Enviando a {providerLabel(nextProvider)}{busy ? ' (en cola)' : ''}…</small><i className="countdown" style={{'--secs': `${AUTO_SEND_SECONDS}s`}}/>
            <button className="btn small" onClick={() => { setText(pending.text); setPending(null); setTyping(true); }}>Editar</button>
            <button className="btn small" onClick={() => setPending(null)}>Cancelar</button></div></div>
        : voice.phase === 'listening' ? <p className="hint">Te escucho… <b>{Math.floor(voice.elapsed)}s</b> · toca la esfera al terminar</p>
        : voice.phase === 'opening' ? <p className="hint">Abriendo el micrófono…</p>
        : voice.phase === 'transcribing' ? <p className="hint"><Spinner size={13}/> Transcribiendo…</p>
        : voice.error ? <div className="caption-line"><p className="hint error">{voice.error}</p>{write}</div>
        : speaking ? <p className="hint">Hablando… toca la esfera para interrumpir</p>
        : reply ? <div className="last-reply"><p>{reply.replace(/[*_`#>]/g, '').slice(0, 260)}</p><div className="caption-line"><button className="link-btn" onClick={() => setSheet(true)}>Ver conversación</button>{write}</div></div>
        : <div className="caption-line"><p className="hint">Toca la esfera para hablar</p>{write}</div>}
      {!data && !error && <p className="hint"><Spinner size={13}/> Conectando…</p>}
      {error && <p className="hint error">{error}</p>}
      {data && !data.runs.length && !data.queue.length && !pending && voice.phase === 'idle' && <div className="general-suggestions">
        {SUGGESTIONS.map(item => <button key={item} onClick={() => send(item)}>{item}</button>)}</div>}
    </div>

    {typing && <form className="general-compose" onSubmit={submitTyped}>
      <textarea autoFocus rows={1} value={text} onChange={event => setText(event.target.value)} placeholder={`Escribe a ${providerLabel(nextProvider)}…`}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !coarse) { event.preventDefault(); submitTyped(); } if (event.key === 'Escape') setTyping(false); }}/>
      <button type="button" className="round-btn" onClick={() => setTyping(false)} aria-label="Cerrar teclado"><X size={18}/></button>
      <button className="send-btn" disabled={sending || !text.trim()} aria-label="Enviar">{sending ? <Spinner/> : <ArrowUp size={19}/>}</button>
    </form>}

    {sheet && <div className="general-sheet" role="dialog" aria-modal="true" aria-label="Conversación con el agente general">
      <div className="sheet-head"><b>Agente general</b><span className="grow"/><button className="round-btn" onClick={() => setSheet(false)} aria-label="Cerrar"><X size={18}/></button></div>
      <ChatConversation project={{name: GENERAL}} active chatId="main" attachments={false}/>
    </div>}
  </div>;
}
