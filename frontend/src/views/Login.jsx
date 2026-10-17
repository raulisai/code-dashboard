import React, {useState} from 'react';
import {ArrowRight, Eye, EyeOff, Lock} from 'lucide-react';
import {post} from '../lib.js';
import {Spinner} from '../ui.jsx';

export default function Login({onLogin}) {
  const [user, setUser] = useState('admin'), [password, setPassword] = useState(''), [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [challenge, setChallenge] = useState(''), [code, setCode] = useState(''), [recovery, setRecovery] = useState(false), [remember, setRemember] = useState(false);
  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = challenge ? await post('/api/login/mfa', {challenge, code}) : await post('/api/login', {user, password, remember});
      setPassword(''); setCode('');
      if (result.mfa_required) setChallenge(result.challenge); else onLogin(result);
    }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <main className="login">
    <form className="login-card" onSubmit={submit}>
      <img src="/icons/icon-192.png" alt="" className="login-logo"/>
      <h1>Codex Manager</h1>
      <p className="muted">Crea y desarrolla tus proyectos con Claude Code y Codex, desde cualquier lugar.</p>
      {!challenge ? <><label className="field"><span>Usuario</span><input value={user} onChange={e => setUser(e.target.value)} autoComplete="username" autoCapitalize="none" required/></label>
      <label className="field"><span>Contraseña</span><div className="input-with-btn">
        <input type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" autoFocus required/>
        <button type="button" className="ghost-icon" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{show ? <EyeOff size={18}/> : <Eye size={18}/>}</button>
      </div></label>
      <label className="auth-check"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)}/>Recordar este dispositivo durante 180 días</label>
      <small className="muted">Solo en tu celular o equipo personal. Sin marcar, hasta 12 horas.</small></> : <>
        <p className="muted">{recovery ? 'Introduce uno de los códigos que guardaste al activar el autenticador.' : 'Abre tu app autenticadora e introduce el código de seis dígitos.'}</p>
        <label className="field" key={recovery ? 'recovery' : 'otp'}><span>{recovery ? 'Código de recuperación' : 'Código del autenticador'}</span><input className={recovery ? '' : 'auth-code'} value={code} onChange={event => setCode(recovery ? event.target.value : event.target.value.replace(/\D/g, ''))} inputMode={recovery ? 'text' : 'numeric'} maxLength={recovery ? 32 : 6} pattern={recovery ? undefined : '[0-9]{6}'} autoComplete="one-time-code" autoFocus required/></label>
        <button type="button" className="link-btn" onClick={() => {setRecovery(!recovery); setCode(''); setError('');}}>{recovery ? 'Usar la app autenticadora' : 'He perdido el autenticador'}</button>
      </>}
      {error && <div className="form-error">{error}</div>}
      <button className="btn primary big" disabled={busy}>{busy ? <Spinner/> : <Lock size={17}/>}Entrar<ArrowRight size={17}/></button>
      {challenge && <button type="button" className="link-btn" onClick={() => {setChallenge(''); setCode(''); setError(''); setRecovery(false);}}>Volver a usuario y contraseña</button>}
    </form>
  </main>;
}
