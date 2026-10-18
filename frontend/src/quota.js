// Presentación del cupo de Claude/Codex: etiquetas, tono y tiempo hasta el reinicio. Sin React para probarla.
export const windowLabel = minutes => minutes === 300 ? 'Cada 5 horas' : minutes === 10080 ? 'Semanal' : minutes ? `${Math.round(minutes / 60)} h` : 'Ventana';
export const tone = used => used >= 90 ? 'bad' : used >= 70 ? 'warn' : 'ok';

export function resetIn(epoch, now = Date.now() / 1000) {
  if (!epoch) return '';
  const seconds = Math.round(epoch - now);
  if (seconds <= 0) return 'se reinicia ya';
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return `se reinicia en ${days ? `${days} d ${hours} h` : hours ? `${hours} h ${minutes} min` : `${Math.max(1, minutes)} min`}`;
}

const MESSAGES = {not_installed: 'No está instalado en el servidor', logged_out: 'Sin sesión en el servidor', api_key: 'Usa API key: su cupo se ve en la plataforma de API'};
export const stateMessage = provider => provider.state === 'ok' ? '' : MESSAGES[provider.state] || provider.error || 'No se pudo consultar';
/** Cuál conviene usar ahora: el que tenga más margen en su ventana más apretada. */
export function best(quota) {
  const room = provider => provider?.state === 'ok' && provider.windows.length ? 100 - Math.max(...provider.windows.map(w => w.used)) : -1;
  const claude = room(quota?.claude), codex = room(quota?.codex);
  return claude < 0 && codex < 0 ? '' : claude >= codex ? 'claude' : 'codex';
}
