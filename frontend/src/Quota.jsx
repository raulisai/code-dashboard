import React, {useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {api, providerLabel, useNow, usePolling} from './lib.js';
import {ProviderMark, Spinner} from './ui.jsx';
import {best, resetIn, stateMessage, tone, windowLabel} from './quota.js';
import './quota.css';

/** Cupo de Claude y Codex. Se lee del servidor (cacheado 2 min) y se refresca solo cada 2 min. */
export function useQuota() {
  const [quota, setQuota] = useState(null), [busy, setBusy] = useState(false);
  const load = async refresh => {
    setBusy(true);
    try { setQuota(await api(`/api/quota${refresh ? '?refresh=1' : ''}`, {timeout: 70000})); }
    catch { setQuota(current => current || {claude: {state: 'error', windows: []}, codex: {state: 'error', windows: []}, stale: true}); }
    finally { setBusy(false); }
  };
  usePolling(() => load(false), 120000, []);
  return {quota, busy, refresh: () => load(true)};
}

function Provider({name, data, now}) {
  const message = stateMessage(data);
  return <div className="quota-provider">
    <div className="quota-name"><ProviderMark provider={name} size={22}/><b>{providerLabel(name)}</b>{data.plan && <span className="tag">{data.plan}</span>}</div>
    {message ? <p className="muted quota-note">{message}</p> : data.windows.map(w => <div className={`quota-window ${tone(w.used)}`} key={w.minutes}>
      <div className="quota-top"><span>{windowLabel(w.minutes)}</span><b>{Math.round(100 - w.used)}% libre</b></div>
      <div className="quota-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w.used)} aria-label={`${providerLabel(name)} ${windowLabel(w.minutes)}: ${Math.round(w.used)}% usado`}><i style={{width: `${Math.max(2, w.used)}%`}}/></div>
      <small>{Math.round(w.used)}% usado{w.resets_at ? ` · ${resetIn(w.resets_at, now / 1000)}` : ''}</small>
    </div>)}
    {data.credits && !data.credits.unlimited && data.state === 'ok' && <small className="muted">Créditos extra: {data.credits.has ? data.credits.balance : 'ninguno'}</small>}
  </div>;
}

export default function Quota({detail = false}) {
  const {quota, busy, refresh} = useQuota(), now = useNow(30000);
  const suggestion = best(quota);
  return <div className="quota">
    <div className="quota-grid">{quota ? ['claude', 'codex'].map(name => <Provider key={name} name={name} data={quota[name]} now={now}/>) : <p className="muted"><Spinner size={14}/> Consultando cupo…</p>}</div>
    <div className="quota-foot">
      <small className="muted">{quota?.stale ? 'No se pudo actualizar; mostrando la última lectura. ' : ''}{suggestion && quota.claude.state === 'ok' && quota.codex.state === 'ok' ? `Ahora conviene ${providerLabel(suggestion)}. ` : ''}{detail ? 'Se lee en el servidor con la sesión de cada CLI.' : ''}</small>
      <button className="btn small" onClick={refresh} disabled={busy} aria-label="Actualizar cupo">{busy ? <Spinner size={13}/> : <RefreshCw size={14}/>}Actualizar</button>
    </div>
  </div>;
}
