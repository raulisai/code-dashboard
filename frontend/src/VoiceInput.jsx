import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowUp, Check, Download, Loader2, Mic, Pause, Play, RotateCcw, Square, X} from 'lucide-react';
import {MAX_SECONDS, formatDictation, microphoneError, recordingType, transcribeAudio, voiceSettings} from './voice.js';

const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export default function VoiceButton({onText, onSend, sendLabel = 'Enviar petición', active = true, disabled = false, className = ''}) {
  const [open, setOpen] = useState(false), [phase, setPhase] = useState('idle'), [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0), [level, setLevel] = useState(0), [audio, setAudio] = useState(null), [text, setText] = useState('');
  const [settings, setSettings] = useState(voiceSettings), [formatted, setFormatted] = useState(false), [sending, setSending] = useState(false);
  const capture = useRef(null), request = useRef(null), audioURL = useRef(''), alive = useRef(true), ticket = useRef(0);
  const dialog = useRef(null);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const supported = !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

  const release = () => {
    const current = capture.current;
    if (!current) return;
    clearInterval(current.timer);
    current.stream.getTracks().forEach(track => track.stop());
    current.context?.close().catch(() => {});
    current.wake?.release().catch(() => {});
    capture.current = null;
  };
  const resetURL = () => { if (audioURL.current) URL.revokeObjectURL(audioURL.current); audioURL.current = ''; };
  const cancel = () => {
    ticket.current++;
    request.current?.abort(); request.current = null;
    if (capture.current) { capture.current.cancelled = true; if (capture.current.recorder.state !== 'inactive') capture.current.recorder.stop(); }
    release(); resetURL(); setAudio(null); setOpen(false); setPhase('idle'); setError(''); setText('');
  };

  const transcribe = async blob => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const identity = ticket.current;
    setPhase('transcribing'); setError('');
    const timeout = setTimeout(() => controller.abort(), 305000);
    try {
      const result = await transcribeAudio(blob, settingsRef.current, controller.signal);
      if (!alive.current || identity !== ticket.current) return;
      setText(result.text || ''); setPhase('review');
      if (!result.text?.trim()) setError('No se detectó voz clara. Puedes escuchar la grabación, reintentar o grabar de nuevo.');
    } catch (err) {
      if (!alive.current || identity !== ticket.current) return;
      setPhase('review'); setError(err.name === 'AbortError' ? 'Se agotó el tiempo de espera. Conservamos tu audio para reintentar.' : err.name === 'TypeError' ? 'No se pudo conectar al servidor. La grabación sigue disponible para reintentar.' : err.message || 'Sin conexión. Tu audio sigue disponible para reintentar.');
    } finally { clearTimeout(timeout); }
  };

  const finish = () => {
    const current = capture.current;
    if (current && current.recorder.state !== 'inactive') {
      setPhase('finishing'); current.recorder.stop();
    }
  };

  const start = async () => {
    if (disabled || sending || capture.current || phaseRef.current === 'opening') return;
    setOpen(true); setPhase('opening'); setError(''); setText(''); setElapsed(0); setLevel(0); setAudio(null); resetURL();
    const identity = ++ticket.current;
    if (!supported) { setError('Este navegador no permite grabar audio. Abre el panel en Safari, Chrome, Edge o Firefox actualizado.'); setPhase('review'); return; }
    let stream;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1}});
      } catch (err) {
        if (err.name !== 'OverconstrainedError' && !/invalid constraint/i.test(err.message || '')) throw err;
        stream = await navigator.mediaDevices.getUserMedia({audio: true});
      }
      if (!alive.current || identity !== ticket.current) { stream.getTracks().forEach(track => track.stop()); return; }
      const mimeType = recordingType();
      const recorder = new MediaRecorder(stream, {...(mimeType ? {mimeType} : {}), audioBitsPerSecond: 64000});
      const current = {stream, recorder, chunks: [], cancelled: false, total: 0, lastTick: performance.now(), silence: 0, heard: false};
      capture.current = current;
      try {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (Context) {
          current.context = new Context();
          current.context.resume().catch(() => {});
          const source = current.context.createMediaStreamSource(stream);
          current.analyser = current.context.createAnalyser(); current.analyser.fftSize = 1024;
          source.connect(current.analyser); current.samples = new Uint8Array(current.analyser.fftSize);
        }
      } catch { /* la grabación sigue aunque no haya medidor */ }
      if (identity !== ticket.current) { release(); return; }
      recorder.ondataavailable = event => { if (event.data.size) current.chunks.push(event.data); };
      recorder.onerror = () => { setError('La grabación se interrumpió. Intentaremos conservar el audio capturado.'); finish(); };
      recorder.onstop = () => {
        release();
        if (current.cancelled || !alive.current || identity !== ticket.current) return;
        const blob = new Blob(current.chunks, {type: recorder.mimeType || mimeType || 'audio/webm'});
        if (blob.size < 64 || current.total < .3) { setPhase('review'); setError('La grabación fue muy corta. Pulsa Grabar de nuevo y empieza a hablar.'); return; }
        audioURL.current = URL.createObjectURL(blob); setAudio({blob, url: audioURL.current});
        transcribe(blob);
      };
      recorder.start(500); setPhase('recording');
      if (navigator.wakeLock) navigator.wakeLock.request('screen').then(lock => { if (capture.current === current) current.wake = lock; else lock.release(); }).catch(() => {});
      current.timer = setInterval(() => {
        const now = performance.now(), delta = (now - current.lastTick) / 1000; current.lastTick = now;
        if (recorder.state !== 'recording') return;
        current.total += delta; setElapsed(current.total);
        if (current.analyser) {
          current.analyser.getByteTimeDomainData(current.samples);
          const rms = Math.sqrt(current.samples.reduce((sum, n) => sum + ((n - 128) / 128) ** 2, 0) / current.samples.length);
          setLevel(Math.min(1, rms * 8));
          if (rms > .018) { current.heard = true; current.silence = 0; } else current.silence += delta;
          if (settingsRef.current.silence && current.heard && current.silence >= 6) finish();
        }
        if (current.total >= MAX_SECONDS) finish();
      }, 100);
      stream.getAudioTracks()[0]?.addEventListener('ended', finish, {once: true});
    } catch (err) {
      stream?.getTracks().forEach(track => track.stop()); release();
      if (identity === ticket.current && alive.current) { setError(microphoneError(err)); setPhase('review'); }
    }
  };

  const pause = () => {
    const current = capture.current; if (!current) return;
    if (current.recorder.state === 'recording') { current.recorder.pause(); setPhase('paused'); }
    else if (current.recorder.state === 'paused') { current.lastTick = performance.now(); current.recorder.resume(); setPhase('recording'); }
  };
  const effective = formatted ? formatDictation(text) : text.trim();
  const accept = async send => {
    if (!effective || sending) return;
    if (!send) { onText(effective); cancel(); return; }
    setSending(true);
    try { if (await onSend(effective) !== false) cancel(); }
    catch (err) { setError(err.message || 'No se pudo enviar. Tu texto sigue aquí.'); }
    finally { setSending(false); }
  };
  useEffect(() => {
    try { localStorage.setItem('cm-voice-settings', JSON.stringify(settings)); } catch {}
  }, [settings]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; dialog.current?.focus({preventScroll: true});
    const trap = event => {
      if (event.key !== 'Tab' || !dialog.current) return;
      const targets = [...dialog.current.querySelectorAll('button:not(:disabled), textarea, select, input:not(:disabled), a[href], summary')].filter(node => node.getClientRects().length);
      if (!targets.length) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === targets[0] || document.activeElement === dialog.current)) { event.preventDefault(); targets.at(-1).focus(); }
      else if (!event.shiftKey && (document.activeElement === targets.at(-1) || !dialog.current.contains(document.activeElement))) { event.preventDefault(); targets[0].focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus({preventScroll: true}); };
  }, [open]);
  useEffect(() => {
    const hidden = () => { if (document.hidden && ['recording', 'paused'].includes(phaseRef.current)) finish(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { alive.current = false; ticket.current++; request.current?.abort(); if (capture.current) { capture.current.cancelled = true; if (capture.current.recorder.state !== 'inactive') capture.current.recorder.stop(); } release(); resetURL(); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  useEffect(() => { if (!active && open) cancel(); }, [active]);
  useEffect(() => {
    if (!active || disabled) return;
    const key = event => {
      if (event.altKey && event.code === 'Space') { event.preventDefault(); if (phaseRef.current === 'recording' || phaseRef.current === 'paused') finish(); else if (!open) start(); }
      if (event.key === 'Escape' && open && !sending) cancel();
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [active, disabled, open, sending]);

  return <>
    <button type="button" className={`voice-trigger ${className}`} onClick={start} disabled={disabled || open} aria-label="Dictar por voz" title="Dictar por voz · Alt+Espacio"><Mic size={18}/><span>Hablar</span></button>
    {open && createPortal(<div className="sheet-backdrop voice-backdrop" onClick={() => { if (!sending && !['recording', 'paused', 'transcribing'].includes(phase)) cancel(); }}>
      <section ref={dialog} tabIndex={-1} className="sheet voice-sheet" role="dialog" aria-modal="true" aria-label="Dictar una petición" onClick={event => event.stopPropagation()}>
        <div className="sheet-grip"/><header className="sheet-head"><div><h2>Dictar una petición</h2><small>Whisper local · sin coste por minuto</small></div><button className="ghost-icon" onClick={cancel} disabled={sending} aria-label="Cancelar dictado"><X size={20}/></button></header>
        <div className="sheet-body voice-body">
          {['opening', 'recording', 'paused', 'finishing'].includes(phase) && <div className={`voice-capture ${phase}`}>
            <div className="voice-orb"><Mic size={32}/></div>
            <div className="voice-wave" aria-hidden="true">{Array.from({length: 27}, (_, i) => <i key={i} style={{height: `${5 + level * (16 + 24 * Math.abs(Math.sin(i * 1.5)))}px`}}/>)}</div>
            <div className="voice-timer">{clock(elapsed)} <small>/ 3:00</small></div>
            <p aria-live="polite">{phase === 'opening' ? 'Permite el micrófono para empezar…' : phase === 'paused' ? 'En pausa. Continúa cuando quieras.' : phase === 'finishing' ? 'Preparando tu grabación…' : 'Te escucho. Habla con naturalidad.'}</p>
            {['recording', 'paused'].includes(phase) && <div className="voice-controls"><button className="btn" onClick={pause}>{phase === 'paused' ? <Play size={17}/> : <Pause size={17}/>} {phase === 'paused' ? 'Continuar' : 'Pausa'}</button><button className="btn primary" onClick={finish}><Square size={15} fill="currentColor"/> Terminar y transcribir</button></div>}
          </div>}
          {phase === 'transcribing' && <div className="voice-processing" role="status"><Loader2 size={30} className="spin"/><h3>Convirtiendo tu voz en texto…</h3><p>La grabación se procesa en tu servidor. Puedes cancelar sin enviar ninguna petición.</p></div>}
          {error && <div className="voice-error" role="alert">{error}</div>}
          {phase === 'review' && <div className="voice-review"><label className="field"><span>Revisa tu petición</span><textarea value={text} onChange={event => setText(event.target.value)} rows={7} placeholder="La transcripción aparecerá aquí. También puedes escribir o corregirla." aria-label="Transcripción"/></label>
            <label className="voice-option"><input type="checkbox" checked={formatted} onChange={event => setFormatted(event.target.checked)}/> Convertir «nueva línea» y «nuevo párrafo» en formato</label>
            {formatted && effective !== text.trim() && <pre className="voice-formatted">{effective}</pre>}
            <div className="voice-actions"><button className="btn" onClick={start} disabled={sending}><RotateCcw size={15}/>Grabar de nuevo</button>{audio && <button className="btn" onClick={() => transcribe(audio.blob)} disabled={sending}><RotateCcw size={15}/>Reintentar audio</button>}</div>
          </div>}
          {audio && <details className="voice-audio"><summary>Escuchar o guardar mi grabación</summary><audio controls src={audio.url}/><a href={audio.url} download={`dictado.${audio.blob.type.includes('mp4') ? 'm4a' : audio.blob.type.includes('ogg') ? 'ogg' : 'webm'}`} className="link-btn"><Download size={14}/>Guardar audio</a></details>}
          <details className="voice-preferences"><summary>Idioma y preferencias</summary><label className="field"><span>Idioma</span><select className="select" value={settings.language} onChange={event => setSettings({...settings, language: event.target.value})}>{[['es','Español'],['auto','Detectar idioma'],['en','English'],['pt','Português'],['fr','Français'],['de','Deutsch'],['it','Italiano']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="voice-option"><input type="checkbox" checked={settings.silence} onChange={event => setSettings({...settings, silence: event.target.checked})}/>Terminar tras 6 segundos de silencio</label><label className="field"><span>Palabras de tu proyecto</span><input className="input" value={settings.vocabulary} maxLength={600} onChange={event => setSettings({...settings, vocabulary: event.target.value})} placeholder="Nombres, tecnologías o palabras que sueles dictar"/></label></details>
          <p className="voice-privacy">El audio solo viaja a este VPS por HTTPS, se procesa en memoria y no se guarda. Tu petición se envía al agente cuando tú lo decides.</p>
        </div>
        {phase === 'review' && <footer className="voice-footer"><button className="btn" onClick={() => accept(false)} disabled={!effective || sending}><Check size={16}/>Insertar texto</button>{onSend && <button className="btn primary" onClick={() => accept(true)} disabled={!effective || sending}>{sending ? <Loader2 size={16} className="spin"/> : <ArrowUp size={17}/>} {sendLabel}</button>}</footer>}
      </section>
    </div>, document.body)}
  </>;
}
