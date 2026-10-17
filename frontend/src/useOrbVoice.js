import {useEffect, useRef, useState} from 'react';
import {formatDictation, microphoneError, recordingType, transcribeAudio, voiceSettings} from './voice.js';

const MAX_SECONDS = 120, SILENCE_SECONDS = .7;

/** Conversación con la esfera: tocar para hablar; termina al tocar de nuevo o tras una pausa
 * y entrega el texto transcrito por el Whisper local. El nivel del micrófono anima la esfera. */
export default function useOrbVoice(onText, {engine: preferred = 'auto'} = {}) {
  const [phase, setPhase] = useState('idle'), [level, setLevel] = useState(0), [error, setError] = useState(''), [elapsed, setElapsed] = useState(0);
  const native = useRef(null);
  const [interim, setInterim] = useState(''), [engine, setEngine] = useState('local');
  const capture = useRef(null), ticket = useRef(0), alive = useRef(true), controller = useRef(null), deliver = useRef(onText);
  deliver.current = onText;
  useEffect(() => { alive.current = true; return () => { alive.current = false; cancel(); }; }, []);

  const release = () => {
    const current = capture.current;
    if (!current) return;
    clearInterval(current.timer);
    current.stream.getTracks().forEach(track => track.stop());
    current.context?.close().catch(() => {});
    current.wake?.release().catch(() => {});
    capture.current = null;
    setLevel(0);
  };
  const cancel = () => {
    ticket.current++;
    if (native.current) { const current = native.current; native.current = null; clearInterval(current.timer); clearTimeout(current.timeout); current.recognition.abort(); }
    controller.current?.abort(); controller.current = null;
    const current = capture.current;
    if (current) { current.cancelled = true; if (current.recorder.state !== 'inactive') current.recorder.stop(); }
    release();
    if (alive.current) { setPhase('idle'); setElapsed(0); }
  };
  const stop = () => { if (native.current) { setPhase('transcribing'); native.current.recognition.stop(); return; } const current = capture.current; if (current && current.recorder.state === 'recording') { setPhase('transcribing'); current.recorder.stop(); } };

  const startLocal = async () => {
    setEngine('local'); setInterim('');
    if (capture.current || phase === 'opening' || phase === 'transcribing') return;
    const identity = ++ticket.current;
    setError(''); setElapsed(0); setPhase('opening');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setPhase('idle'); setError('Este navegador no permite grabar audio. Escribe tu mensaje.'); return; }
    let stream;
    try {
      try { stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1}}); }
      catch (err) { if (err.name !== 'OverconstrainedError') throw err; stream = await navigator.mediaDevices.getUserMedia({audio: true}); }
      if (!alive.current || identity !== ticket.current) { stream.getTracks().forEach(track => track.stop()); return; }
      const mimeType = recordingType();
      const recorder = new MediaRecorder(stream, {...(mimeType ? {mimeType} : {}), audioBitsPerSecond: 64000});
      const current = {stream, recorder, chunks: [], total: 0, silence: 0, heard: false, last: performance.now(), cancelled: false};
      capture.current = current;
      try {
        const Context = window.AudioContext || window.webkitAudioContext;
        current.context = new Context(); current.context.resume().catch(() => {});
        current.analyser = current.context.createAnalyser(); current.analyser.fftSize = 1024;
        current.context.createMediaStreamSource(stream).connect(current.analyser);
        current.samples = new Uint8Array(current.analyser.fftSize);
      } catch { /* sin medidor: se termina tocando la esfera */ }
      recorder.ondataavailable = event => { if (event.data.size) current.chunks.push(event.data); };
      recorder.onstop = async () => {
        release();
        if (current.cancelled || !alive.current || identity !== ticket.current) return;
        const blob = new Blob(current.chunks, {type: recorder.mimeType || mimeType || 'audio/webm'});
        if (blob.size < 64 || current.total < .4 || !current.heard) { setPhase('idle'); setError(current.heard ? 'Fue muy corto. Toca la esfera y habla.' : 'No te escuché. Toca la esfera y habla más cerca.'); return; }
        setPhase('transcribing');
        try {
          const abort = new AbortController(); controller.current = abort;
          const timeout = setTimeout(() => abort.abort(), 305000);
          let result;
          try { result = await transcribeAudio(blob, {...voiceSettings(), fast: preferred !== 'local-precise'}, abort.signal); }
          finally { clearTimeout(timeout); if (controller.current === abort) controller.current = null; }
          if (!alive.current || identity !== ticket.current) return;
          const text = formatDictation(result.text || '');
          setPhase('idle');
          if (text) deliver.current(text); else setError('No se entendió el audio. Inténtalo otra vez.');
        } catch (err) {
          if (alive.current && identity === ticket.current) { setPhase('idle'); setError(err.message || 'No se pudo transcribir. Reintenta.'); }
        }
      };
      recorder.start(400); setPhase('listening');
      navigator.wakeLock?.request('screen').then(lock => { if (capture.current === current) current.wake = lock; else lock.release(); }).catch(() => {});
      current.timer = setInterval(() => {
        const now = performance.now(), delta = (now - current.last) / 1000; current.last = now;
        if (recorder.state !== 'recording') return;
        current.total += delta; setElapsed(current.total);
        if (current.analyser) {
          current.analyser.getByteTimeDomainData(current.samples);
          const rms = Math.sqrt(current.samples.reduce((sum, n) => sum + ((n - 128) / 128) ** 2, 0) / current.samples.length);
          setLevel(Math.min(1, rms * 9));
          if (rms > .02) { current.heard = true; current.silence = 0; } else current.silence += delta;
          if (current.heard && current.silence >= SILENCE_SECONDS) stop();
        } else current.heard = true;
        if (current.total >= MAX_SECONDS) stop();
      }, 100);
    } catch (err) {
      stream?.getTracks().forEach(track => track.stop()); release();
      if (alive.current && identity === ticket.current) { setPhase('idle'); setError(microphoneError(err)); }
    }
  };

  const start = () => {
    if (capture.current || native.current || phase === 'opening' || phase === 'transcribing') return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (preferred !== 'auto' || !Recognition) return startLocal();
    const identity = ++ticket.current, recognition = new Recognition();
    const current = {recognition, text: '', failed: false, since: Date.now()}; native.current = current;
    setEngine('browser'); setInterim(''); setError(''); setElapsed(0); setPhase('opening');
    recognition.lang = ({en:'en-US',es:'es-MX',pt:'pt-BR',fr:'fr-FR',de:'de-DE',it:'it-IT'})[voiceSettings().language] || navigator.language || 'es-MX';
    recognition.interimResults = true; recognition.continuous = false; recognition.maxAlternatives = 1;
    const active = () => alive.current && ticket.current === identity && native.current === current;
    const fallbackLocal = () => { if (!active()) return; native.current = null; clearInterval(current.timer); clearTimeout(current.timeout); recognition.onend = null; try { recognition.abort(); } catch {} startLocal(); };
    recognition.onstart = () => {
      if (!active()) return;
      clearTimeout(current.timeout); setPhase('listening');
      current.timer = setInterval(() => { if (active()) { setElapsed((Date.now() - current.since) / 1000); if (Date.now() - current.since > MAX_SECONDS * 1000) stop(); } }, 150);
      current.timeout = setTimeout(() => { if (active()) recognition.stop(); }, 15000);
    };
    recognition.onspeechstart = () => { if (active()) { clearTimeout(current.timeout); setLevel(.45); } };
    recognition.onspeechend = () => { if (active()) setLevel(0); };
    recognition.onresult = event => {
      if (!active()) return;
      current.text = Array.from(event.results).map(result => result[0]?.transcript || '').join(' ').trim();
      setInterim(current.text);
    };
    recognition.onerror = event => {
      if (!active()) return;
      if (['network', 'service-not-allowed', 'language-not-supported', 'audio-capture', 'not-allowed'].includes(event.error)) { fallbackLocal(); return; }
      if (!current.failed && event.error !== 'aborted') setError(event.error === 'no-speech' ? 'No te escuché. Toca la esfera para volver a hablar.' : microphoneError({name:'NotAllowedError'}));
    };
    recognition.onend = () => {
      if (!active()) return;
      native.current = null; clearInterval(current.timer); clearTimeout(current.timeout); setLevel(0); setPhase('idle');
      if (current.failed) { startLocal(); return; }
      const text = formatDictation(current.text);
      if (text) deliver.current(text);
    };
    current.timeout = setTimeout(fallbackLocal, 4000);
    try { recognition.start(); } catch { current.failed = true; native.current = null; clearTimeout(current.timeout); startLocal(); }
  };

  return {phase, level, error, elapsed, interim, engine, start, stop, cancel, clearError: () => setError('')};
}
