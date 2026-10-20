import React, {useState} from 'react';
import {Watch} from 'lucide-react';
import {post} from './lib.js';

export default function WatchPair() {
  const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [result, setResult] = useState(''), [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError(''); setResult('');
    try { const data = await post('/api/wear/pair/approve', {code}); setResult(data.message); setCode(''); }
    catch (err) {setError(err.message);} finally {setBusy(false);}
  };
  return <section className="block" aria-label="Vincular reloj">
    <div className="block-head"><h2><Watch size={18}/>Tu reloj</h2></div>
    <p className="muted">Abre Codex en tu Galaxy Watch y escribe aquí sus ocho caracteres. Vincula únicamente el reloj que tienes delante: podrá consultar y controlar proyectos, agentes, archivos, terminal y despliegues.</p>
    <form onSubmit={submit}>
      <label className="field"><span>Código del reloj</span><input className="input" value={code} onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 8))} maxLength={8} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="ABCD2345"/></label>
      <button className="btn primary" disabled={busy || code.length !== 8}>{busy ? 'Vinculando…' : 'Vincular este reloj'}</button>
    </form>
    {result && <p role="status">{result}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    <p className="muted">Puedes revocarlo desde Seguridad → Sesiones. Los avisos se limitan inicialmente a situaciones que necesitan tu atención.</p>
  </section>;
}
