import React, {useEffect, useState} from 'react';
import {Check, Copy, Download, LogOut, ShieldCheck, Smartphone} from 'lucide-react';
import {api, post, timeAgo} from './lib.js';
import {Spinner, toast} from './ui.jsx';

export function RecoveryCodes({codes, onDone}) {
  const [saved, setSaved] = useState(false);
  const download = () => {
    const blob = new Blob(['Codex Manager — códigos de recuperación\nCada código se usa una sola vez, junto con tu contraseña.\nGuárdalos en un lugar privado fuera de este dispositivo.\n\n' + codes.join('\n') + '\n'], {type: 'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'codex-manager-recuperacion.txt'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="auth-recovery">
    <h3>Guarda tus códigos de recuperación</h3>
    <p className="muted">Si pierdes el autenticador, podrás entrar con tu contraseña y uno de estos códigos. Cada uno sirve una sola vez. Solo se muestran ahora.</p>
    <div className="recovery-codes">{codes.map(code => <code key={code}>{code}</code>)}</div>
    <button className="btn" onClick={download}><Download size={16}/>Descargar códigos</button>
    <label className="auth-check"><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)}/>He guardado los códigos en un lugar seguro.</label>
    <button className="btn primary" disabled={!saved} onClick={onDone}><Check size={16}/>Continuar</button>
  </div>;
}

export function AuthenticatorSetup({replacement = false, onComplete, onCancel}) {
  const [setup, setSetup] = useState(null), [codes, setCodes] = useState(null);
  const [password, setPassword] = useState(''), [proof, setProof] = useState(''), [code, setCode] = useState('');
  const [remember, setRemember] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const begin = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { setSetup(await post('/api/security/setup', {password, code: proof})); setPassword(''); setProof(''); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const confirm = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await post('/api/security/confirm', {code, remember});
      setCodes(result.recovery_codes); setSetup(null); setCode('');
    } catch (err) { setError(err.message); setCode(''); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(setup.secret); toast('Clave copiada'); }
    catch { toast('Selecciona la clave y cópiala manualmente.', 'error'); }
  };
  if (codes) return <RecoveryCodes codes={codes} onDone={onComplete}/>;
  return <div className="auth-setup">
    <h2>{replacement ? 'Cambiar autenticador' : 'Configura tu autenticador'}</h2>
    <p className="muted">Usa Google Authenticator, Microsoft Authenticator u otra app compatible. Necesitarás la contraseña y un código al iniciar sesión.</p>
    {!setup ? <form onSubmit={begin}>
      {replacement && <>
        <p className="muted">El autenticador actual seguirá funcionando hasta confirmar el nuevo. Al terminar se cerrarán las otras sesiones.</p>
        <label className="field"><span>Contraseña actual</span><input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required/></label>
        <label className="field"><span>Código actual o de recuperación</span><input autoComplete="one-time-code" value={proof} onChange={event => setProof(event.target.value)} required/></label>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="auth-actions"><button className="btn primary" disabled={busy}>{busy ? <Spinner/> : <Smartphone size={16}/>}Generar QR y clave</button>{onCancel && <button type="button" className="btn" onClick={onCancel}>Cancelar</button>}</div>
    </form> : <form onSubmit={confirm}>
      <p>1. Escanea este QR desde tu app autenticadora.</p>
      <img className="auth-qr" src={setup.qr} alt="QR para configurar tu autenticador"/>
      <p className="muted">¿Estás en el mismo celular? Copia la clave y añádela manualmente en tu autenticador como clave basada en tiempo.</p>
      <label className="field"><span>Clave de configuración</span><input className="auth-secret" readOnly value={setup.secret} onFocus={event => event.target.select()}/></label>
      <div className="auth-actions"><button type="button" className="btn small" onClick={copy}><Copy size={14}/>Copiar clave</button><a className="btn small" href={setup.uri}>Abrir en autenticador</a></div>
      <p>2. Introduce el código de seis dígitos que muestra la app.</p>
      <label className="field"><span>Código del autenticador</span><input className="auth-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required autoFocus/></label>
      <label className="auth-check"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)}/>Recordar este dispositivo durante 180 días</label>
      <small className="muted">Márcalo solo en tu celular o equipo personal. Sin marcar, la sesión dura hasta 12 horas.</small>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="auth-actions"><button className="btn primary" disabled={busy}>{busy ? <Spinner/> : <ShieldCheck size={16}/>}Activar autenticador</button><button type="button" className="btn" disabled={busy} onClick={() => {setSetup(null); setError(''); setCode('');}}>Volver</button></div>
    </form>}
  </div>;
}

function deviceName(agent) {
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox|FxiOS/.test(agent) ? 'Firefox' : /Chrome|CriOS/.test(agent) ? 'Chrome' : /Safari/.test(agent) ? 'Safari' : 'Navegador';
  const system = /iPhone/.test(agent) ? 'iPhone' : /iPad/.test(agent) ? 'iPad' : /Android/.test(agent) ? 'Android' : /Windows/.test(agent) ? 'Windows' : /Mac/.test(agent) ? 'Mac' : /Linux/.test(agent) ? 'Linux' : '';
  return browser + (system ? ' en ' + system : '');
}

export function SecuritySettings() {
  const [status, setStatus] = useState(null), [error, setError] = useState(''), [action, setAction] = useState('');
  const [password, setPassword] = useState(''), [code, setCode] = useState(''), [codes, setCodes] = useState(null), [busy, setBusy] = useState(false);
  const load = () => api('/api/security').then(data => {setStatus(data); setError('');}).catch(err => setError(err.message));
  useEffect(() => { load(); }, []);
  const revoke = async id => {
    setBusy(true);
    try { await post('/api/security/revoke', {id}); await load(); toast('Sesiones cerradas', 'success'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const regenerate = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await post('/api/security/recovery', {password, code});
      setCodes(result.recovery_codes); setPassword(''); setCode(''); await load();
    } catch (err) { setError(err.message); setCode(''); }
    finally { setBusy(false); }
  };
  const finish = () => {setAction(''); setCodes(null); setPassword(''); setCode(''); setError(''); load();};
  return <section className="block security-settings">
    <div className="block-head"><h2><ShieldCheck size={18}/>Seguridad y sesiones</h2></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!status ? <button className="btn" onClick={load}>Volver a cargar</button> : <>
      {action === 'change' ? <AuthenticatorSetup replacement onComplete={finish} onCancel={finish}/> : codes ? <RecoveryCodes codes={codes} onDone={finish}/> : <>
        <p><span className="tag">Autenticador activo</span></p>
        <p className="muted">Quedan {status.recovery_remaining} códigos de recuperación. Se pide contraseña y código para cambiar el autenticador o generar otros códigos.</p>
        <div className="auth-actions"><button className="btn small" onClick={() => {setAction('change'); setError('');}}>Cambiar autenticador</button><button className="btn small" onClick={() => {setAction('recovery'); setError('');}}>Renovar códigos de recuperación</button></div>
        {action === 'recovery' && <form className="auth-sensitive" onSubmit={regenerate}>
          <p className="muted">Los códigos anteriores dejarán de funcionar y se cerrarán las otras sesiones.</p>
          <label className="field"><span>Contraseña actual</span><input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required/></label>
          <label className="field"><span>Código actual o de recuperación</span><input autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} required/></label>
          <div className="auth-actions"><button className="btn primary" disabled={busy}>{busy ? <Spinner/> : null}Generar nuevos códigos</button><button type="button" className="btn" onClick={finish}>Cancelar</button></div>
        </form>}
        <h3 className="auth-devices-title">Dispositivos conectados</h3>
        {status.sessions.map(session => <div className="auth-device" key={session.id}>
          <Smartphone size={18}/><div><b>{deviceName(session.user_agent)} {session.current && <span className="tag">Este dispositivo</span>}</b><small>Actividad {timeAgo(session.last_seen)} · vence {new Date(session.expires * 1000).toLocaleDateString()}</small></div>
          {!session.current && <button className="btn small" disabled={busy} onClick={() => revoke(session.id)}>Cerrar</button>}
        </div>)}
        <button className="btn danger-soft small" disabled={busy || !status.sessions.some(session => !session.current)} onClick={() => revoke('others')}><LogOut size={15}/>Cerrar las otras sesiones</button>
      </>}
    </>}
  </section>;
}
