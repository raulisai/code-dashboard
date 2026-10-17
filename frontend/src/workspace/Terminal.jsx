import React, {useEffect, useRef, useState} from 'react';
import {Terminal as XTerm} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {ChevronsDown, ChevronsUp, CornerDownLeft, Plug, Power, SendHorizontal} from 'lucide-react';
import {api, post} from '../lib.js';
import {useApp} from '../App.jsx';
import {Confirm, toast} from '../ui.jsx';

const KEYS = [
  ['Esc', '\x1b'], ['Tab', '\t'], ['ctrl', null], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C'],
  ['^C', '\x03'], ['^D', '\x04'], ['^L', '\x0c'], ['/', '/'], ['|', '|'], ['-', '-'], ['~', '~'], ['⏎', '\r'],
];
const KINDS = [
  {key: 'shell', label: 'Shell', hint: 'bash en la carpeta del proyecto'},
  {key: 'claude', label: 'Claude interactivo', hint: 'Claude Code en modo terminal; aquí respondes sus permisos tú mismo'},
  {key: 'codex', label: 'Codex interactivo', hint: 'Codex en modo terminal'},
];

export default function Terminal({project, active}) {
  const {state} = useApp();
  const [kind, setKind] = useState('shell'), [attach, setAttach] = useState('');
  const [status, setStatus] = useState('connecting'), [session, setSession] = useState(''), [line, setLine] = useState('');
  const [error, setError] = useState(''), [copyMode, setCopyMode] = useState(false);
  const activeRef = useRef(active), retries = useRef(0);
  activeRef.current = active;
  const [ctrl, setCtrl] = useState(false), [confirmKill, setConfirmKill] = useState(false), [attempt, setAttempt] = useState(0);
  const host = useRef(null), term = useRef(null), fit = useRef(null), socket = useRef(null), ctrlRef = useRef(false);
  ctrlRef.current = ctrl;

  const send = data => { if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({t: 'i', d: data})); };
  const resize = () => {
    if (!term.current || !fit.current || !host.current?.offsetWidth) return;
    try { fit.current.fit(); } catch { return; }
    const {cols, rows} = term.current;
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({t: 'r', c: cols, r: rows}));
  };

  useEffect(() => {
    let disposed = false, ws = null, retryTimer, connectTimer, healthyTimer, sizeTimer;
    const xterm = new XTerm({cursorBlink: true, fontSize: window.innerWidth < 600 ? 12 : 13.5, fontFamily: 'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
      theme: {background: '#0b1120', foreground: '#e6edf3', cursor: '#f5a35c', selectionBackground: '#2b3245'}, scrollback: 5000, allowProposedApi: false});
    const addon = new FitAddon();
    xterm.loadAddon(addon); xterm.open(host.current);
    term.current = xterm; fit.current = addon;
    try { addon.fit(); } catch { /* panel oculto */ }
    const query = new URLSearchParams({project: project.name, kind: attach ? 'attach' : kind, cols: xterm.cols, rows: xterm.rows});
    if (attach) query.set('session', attach);
    setStatus('connecting'); setError(''); setSession(''); setCopyMode(false);
    const reconnect = () => {
      if (disposed || !activeRef.current || document.hidden || !navigator.onLine || retries.current >= 5) return;
      const delay = Math.min(15000, 1000 * 2 ** retries.current++);
      setError(`Se perdió la conexión. Reintentando (${retries.current}/5)…`);
      retryTimer = setTimeout(() => { if (!disposed) setAttempt(value => value + 1); }, delay);
    };
    const start = async () => {
      const info = await api(`/api/term/status?${query}`);
      if (disposed) return;
      setCopyMode(!!info.copy_mode);
      if (info.dead) setError('La sesión anterior terminó. Puedes cerrarla con el botón de encendido y abrir una nueva.');
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/term?${query}`);
      ws.binaryType = 'arraybuffer'; socket.current = ws;
      connectTimer = setTimeout(() => { if (!disposed && ws.readyState !== WebSocket.CLOSED) { setError('La terminal tardó demasiado en conectar. Pulsa Reconectar.'); ws.close(); } }, 12000);
      ws.onmessage = event => {
        if (disposed) return;
        if (typeof event.data === 'string') {
          let message;
          try { message = JSON.parse(event.data); } catch { return; }
          if (message.t === 'ready') {
            clearTimeout(connectTimer); setSession(message.session); setStatus('open');
            healthyTimer = setTimeout(() => { retries.current = 0; }, 30000);
            sizeTimer = setTimeout(() => { if (!disposed) resize(); }, 50);
          }
          if (message.t === 'mode') setCopyMode(!!message.copy);
          if (message.t === 'error') { setError(message.d); setStatus('closed'); }
        } else xterm.write(new Uint8Array(event.data));
      };
      ws.onerror = () => {
        if (disposed) return;
        setError('No se pudo conectar con la terminal. Comprobando tu sesión…');
        api('/api/me').then(() => { if (!disposed) setError('Falló la conexión WebSocket. Pulsa Reconectar o comprueba tu red.'); }).catch(err => { if (!disposed) setError(err.message); });
      };
      ws.onclose = event => {
        clearTimeout(connectTimer); clearTimeout(healthyTimer);
        if (disposed) return;
        setStatus('closed');
        xterm.writeln('\r\n\x1b[90m[desconectado]\x1b[0m');
        if (event.code === 1008) {
          setError('La sesión se cerró o la conexión fue rechazada. Comprueba tu acceso y reconecta.');
          api('/api/me').catch(() => {});
        } else reconnect();
      };
    };
    start().catch(err => { if (!disposed) {setError(err.message); setStatus('closed');} });
    const wake = () => {
      if (!disposed && activeRef.current && !document.hidden && navigator.onLine && ws?.readyState === WebSocket.CLOSED) {
        clearTimeout(retryTimer); retries.current = 0; setAttempt(value => value + 1);
      }
    };
    document.addEventListener('visibilitychange', wake); window.addEventListener('online', wake);
    const input = xterm.onData(data => {
      if (ctrlRef.current && data.length === 1 && /[a-z@[\\\]^_]/i.test(data)) { data = String.fromCharCode(data.toUpperCase().charCodeAt(0) & 31); setCtrl(false); }
      send(data);
    });
    const observer = new ResizeObserver(() => { if (!disposed) resize(); }); observer.observe(host.current);
    return () => {
      disposed = true;
      for (const timer of [retryTimer, connectTimer, healthyTimer, sizeTimer]) clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake);
      observer.disconnect(); input.dispose();
      if (ws) {ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.close();}
      if (socket.current === ws) socket.current = null;
      if (term.current === xterm) {term.current = null; fit.current = null;}
      xterm.dispose();
    };
  }, [project.name, kind, attach, attempt]);

  useEffect(() => {
    if (!active) return;
    if (socket.current?.readyState === WebSocket.CLOSED) {retries.current = 0; setAttempt(value => value + 1);}
    const timer = setTimeout(() => {resize(); term.current?.focus();}, 60);
    return () => clearTimeout(timer);
  }, [active]);

  const pressKey = value => { if (value === null) { setCtrl(!ctrl); return; } send(value); term.current?.focus(); };
  const scroll = async direction => { const info = await post('/api/term/scroll', {session, direction}); setCopyMode(!!info.copy_mode); };
  const sendLine = async event => {
    event.preventDefault();
    if (socket.current?.readyState !== WebSocket.OPEN) {toast('Reconecta la terminal antes de enviar.', 'error'); return;}
    try {if (copyMode) await scroll('exit'); send(line + '\r'); setLine('');} catch (err) {toast(err.message, 'error');}
  };
  const scrollClick = direction => scroll(direction).catch(err => toast(err.message, 'error'));
  const retry = () => {retries.current = 0; setAttempt(value => value + 1);};
  const kill = async () => {
    setConfirmKill(false);
    try { await post('/api/term/kill', {session}); toast('Sesión cerrada'); setAttach(''); setAttempt(a => a + 1); } catch (err) { toast(err.message, 'error'); }
  };
  const others = (state.sessions || []).filter(s => ![project.name, `${project.name}-claude`, `${project.name}-shell`].includes(s.name));
  const current = KINDS.find(k => k.key === kind);

  return <div className="terminal">
    <div className="term-bar">
      <select className="select" value={attach ? `attach:${attach}` : kind} onChange={e => { const value = e.target.value; if (value.startsWith('attach:')) { setAttach(value.slice(7)); } else { setAttach(''); setKind(value); } }} aria-label="Sesión">
        {KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
        {others.length > 0 && <optgroup label="Otras sesiones">{others.map(s => <option key={s.name} value={`attach:${s.name}`}>{s.name}</option>)}</optgroup>}
      </select>
      <span className={`term-status ${status}`}><i/>{status === 'open' ? session : status === 'connecting' ? 'Conectando…' : 'Desconectado'}</span>
      <span className="grow"/>
      {status === 'closed' && <button className="btn small" onClick={retry}><Plug size={14}/>Reconectar</button>}
      {status === 'open' && <button className="icon-btn" onClick={() => setConfirmKill(true)} aria-label="Cerrar sesión" title="Cerrar la sesión tmux"><Power size={16}/></button>}
    </div>
    {!attach && current && <div className="term-hint">{current.hint}. La sesión sigue viva aunque cierres la app.</div>}
    {error && <div className="term-error" role="status">{error}</div>}
    {copyMode && <div className="term-copy"><span>Historial en pausa</span><button className="btn small" onClick={() => scrollClick('exit')}>Volver al directo</button></div>}
    <div className="term-host" ref={host} onClick={() => term.current?.focus()}/>
    <div className="term-keys">
      <button onClick={() => scrollClick('up')} aria-label="Subir en el historial"><ChevronsUp size={15}/></button>
      <button onClick={() => scrollClick('down')} aria-label="Bajar en el historial"><ChevronsDown size={15}/></button>
      {KEYS.map(([label, value]) => <button key={label} className={value === null && ctrl ? 'on' : ''} onClick={() => pressKey(value)}>{label === 'ctrl' ? 'Ctrl' : label}</button>)}
    </div>
    <form className="term-line" onSubmit={sendLine}>
      <CornerDownLeft size={15} className="muted"/>
      <input value={line} onChange={e => setLine(e.target.value)} placeholder="Escribe un comando y pulsa enviar" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="send"/>
      <button className="icon-btn" aria-label="Enviar" disabled={status !== 'open'}><SendHorizontal size={17}/></button>
    </form>
    {confirmKill && <Confirm title={`¿Cerrar la sesión ${session}?`} danger confirmLabel="Cerrar sesión" text="Se terminará el proceso que corre en ella (por ejemplo, un Claude o Codex interactivo)."
      onCancel={() => setConfirmKill(false)} onConfirm={kill}/>}
  </div>;
}
