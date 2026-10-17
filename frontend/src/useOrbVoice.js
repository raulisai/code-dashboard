import {useEffect, useRef, useState} from 'react';
import {formatDictation, microphoneError, recordingType, transcribeAudio, voiceSettings} from './voice.js';

const MAX_SECONDS = 120, SILENCE_SECONDS = 1.8;

/** Conversación con la esfera: tocar para hablar; termina al tocar de nuevo o tras una pausa
 * y entrega el texto transcrito por el Whisper local. El nivel del micrófono anima la esfera. */
export default function useOrbVoice(onText) {
  const [phase, setPhase] = useState('idle'), [level, setLevel] = useState(0), [error, setError] = useState(''), [elapsed, setElapsed] = useState(0);
  const capture = useRef(null), ticket = useRef(0), alive = useRef(true), deliver = useRef(onText);
  deliver.current = onText;
  useEffect(() => () => { alive.current = false; cancel(); }, []);

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
    const current = capture.current;
    if (current) { current.cancelled = true; if (current.recorder.state !== 'inactive') current.recorder.stop(); }
    release();
    if (alive.current) { setPhase('idle'); setElapsed(0); }
  };
  const stop = () => { const current = capture.current; if (current && current.recorder.state === 'recording') { setPhase('transcribing'); current.recorder.stop(); } };

  const start = async () => {
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
          const result = await transcribeAudio(blob, voiceSettings(), AbortSignal.timeout ? AbortSignal.timeout(305000) : undefined);
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

  return {phase, level, error, elapsed, start, stop, cancel, clearError: () => setError('')};
}
