export const MAX_SECONDS = 180;
export const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];

export function recordingType(Recorder = globalThis.MediaRecorder) {
  return AUDIO_TYPES.find(type => Recorder?.isTypeSupported?.(type)) || '';
}

export function microphoneError(error) {
  return ({NotAllowedError: 'El micrófono está bloqueado. Permítelo en los ajustes de este sitio y vuelve a intentarlo.',
    NotFoundError: 'No se encontró un micrófono. Conecta uno o usa el micrófono del celular.',
    NotReadableError: 'Otra aplicación está usando el micrófono. Ciérrala y reintenta.',
    OverconstrainedError: 'El navegador no pudo configurar el micrófono. Prueba otro dispositivo de entrada.',
    SecurityError: 'El navegador bloqueó el micrófono. Abre esta página con HTTPS.',
    AbortError: 'La grabación se interrumpió. Puedes volver a intentarlo.'})[error?.name] || error?.message || 'No se pudo abrir el micrófono.';
}

export function voiceSettings() {
  try { return {language: 'es', silence: false, vocabulary: '', ...JSON.parse(localStorage.getItem('cm-voice-settings') || '{}')}; }
  catch { return {language: 'es', silence: false, vocabulary: ''}; }
}

export function formatDictation(value) {
  // Solo órdenes inequívocas de formato: no se reescribe la intención del usuario.
  return String(value || '').replace(/\s*\b(?:nuevo p[aá]rrafo|punto y aparte)\b[.,]?\s*/gi, '\n\n')
    .replace(/\s*\bnueva l[ií]nea\b[.,]?\s*/gi, '\n').trim();
}

export function insertDictation(current, dictated) {
  return [String(current || '').trimEnd(), String(dictated || '').trim()].filter(Boolean).join('\n\n');
}

export async function transcribeAudio(blob, settings, signal) {
  const query = new URLSearchParams({language: settings.language, vocabulary: settings.vocabulary || '', fast: settings.fast ? '1' : '0'});
  const response = await fetch(`/api/voice/transcribe?${query}`, {method: 'POST', credentials: 'same-origin',
    headers: {'Content-Type': blob.type || 'audio/webm'}, body: blob, signal});
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) window.dispatchEvent(new Event('cm:unauthorized'));
  if (!response.ok) throw new Error(result.message || `Error al transcribir (${response.status})`);
  return result;
}
