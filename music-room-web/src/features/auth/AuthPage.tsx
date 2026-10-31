import { SocialSignIn } from './SocialSignIn';
import { Icon } from '../../components/ui/Icon';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { useAuth } from './AuthProvider';

type Mode = 'login' | 'register' | 'verify-email' | 'forgot-password' | 'reset-password';
const titles: Record<Mode, string> = { login: 'Back for an encore.', register: 'Your next favorite starts here.', 'verify-email': 'Check your inbox.', 'forgot-password': 'Forgot your password?', 'reset-password': 'Choose a new password.' };
export function AuthPage({ mode }: { mode: Mode }) {
  const { client, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState<string>(location.state?.email ?? '');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [token, setToken] = useState(() => new URLSearchParams(location.search).get('token') ?? '');
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  const [notice, setNotice] = useState<string>(location.state?.notice ?? '');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // Keep emailed credentials out of browser history and referrers after loading.
  useEffect(() => { if (location.search.includes('token=')) window.history.replaceState(window.history.state, '', location.pathname); }, []);
  useEffect(() => { if (!notice && !error) return; const timer = setTimeout(() => { setNotice(''); setError(''); }, 10000); return () => clearTimeout(timer); }, [notice, error]);
  const newPassword = mode === 'register' || mode === 'reset-password';
  const invalidPassword = newPassword && (password.length < 8 || !/[0-9]/.test(password));
  const mismatch = newPassword && password !== confirm;
  async function run(action: () => Promise<unknown>, emailFlow = false) {
    if (flight.current) return;
    flight.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (e) {
      if (!alive.current) return;
      if (emailFlow && ((mode === 'login' && e instanceof ApiError && e.status === 403) || (mode === 'register' && e instanceof ApiError && e.status === 503))) {
        navigate('/auth/verify-email', { state: { email } });
      } else setError(e instanceof Error ? e.message : 'Unable to complete this request.');
    } finally { flight.current = false; if (alive.current) setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault(); setSubmitted(true);
    if (invalidPassword || mismatch) return;
    void run(async () => {
      if (mode === 'login') { await client.login(email, password); if (alive.current) navigate('/rooms', { replace: true }); }
      if (mode === 'register') { await client.register(name, email, password); if (alive.current) navigate('/auth/verify-email', { state: { email } }); }
      if (mode === 'forgot-password') { await client.forgot(email); if (alive.current) setNotice('If this account is eligible, a reset link will arrive by email.'); }
      if (mode === 'verify-email') { await client.resend(email); if (alive.current) setNotice('If this account is eligible, a verification email will arrive shortly.'); }
      if (mode === 'reset-password') { await client.reset(token, password); if (alive.current) { setPassword(''); setConfirm(''); setSubmitted(false); setToken(''); setNotice('Password updated. You can now log in.'); } }
    }, true);
  }
  if (user && (mode === 'login' || mode === 'register')) return <Navigate to="/rooms" replace />;
  return <section className="auth-panel"><div className="auth-intro"><span className="form-symbol"><Icon name={mode === 'login' || mode === 'register' ? 'music' : 'lock'} /></span><p className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : mode === 'register' ? 'JOIN THE ROOM' : 'LET’S GET YOU BACK IN'}</p><h1>{titles[mode]}</h1>{mode === 'login' && <p>Your people. Your playlists. Your room.</p>}{mode === 'register' && <p>A little about you. A lot of good music.</p>}</div>
    {mode === 'verify-email' && <p>Open the email to verify your account, then return here to log in. You can also paste the verification link below.</p>}
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        {mode === 'register' && <label>Your name<input autoComplete="name" required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>}
        {mode !== 'reset-password' && <label>Email address<span className="input-icon"><Icon name="mail" /><input placeholder="you@example.com" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></span></label>}
        {mode === 'reset-password' && <label>Reset link or token<input required autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label>}
        {(mode === 'login' || newPassword) && <label><span className="label-row">Password</span><span className="password-input"><input placeholder="Enter your password" type={showPassword ? 'text' : 'password'} autoComplete={newPassword ? 'new-password' : 'current-password'} required value={password} onChange={e => setPassword(e.target.value)} aria-invalid={submitted && invalidPassword} /><button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}><Icon name={showPassword ? 'eye-off' : 'eye'} /></button></span>{submitted && invalidPassword && <span className="field-error">Use at least 8 characters, including a number.</span>}</label>}
        {mode === 'login' && <Link className="forgot-password-link" to="/auth/forgot-password">Forgot password?</Link>}
        {newPassword && <label>Confirm password<input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} aria-invalid={submitted && mismatch} />{submitted && mismatch && <span className="field-error">Passwords do not match.</span>}</label>}
        {error && <p role="alert" className="auth-error">{error}</p>}
        {notice && <p role="status" className="auth-success">{notice}</p>}
        <button className="button auth-submit" type="submit">{busy ? 'Please wait…' : ({ login: 'Log in', register: 'Create account', 'verify-email': 'Resend verification email', 'forgot-password': 'Send reset link', 'reset-password': 'Save new password' })[mode]}<Icon name="arrow" /></button>
      </fieldset>
    </form>
    {mode === 'verify-email' && <form onSubmit={event => { event.preventDefault(); void run(async () => { await client.verify(token); if (alive.current) { setToken(''); setNotice('Email verified. You can now log in.'); } }); }}><fieldset disabled={busy}><label>Verification link or token<input autoComplete="off" required value={token} onChange={e => setToken(e.target.value)} /></label><button className="button secondary">Verify email</button></fieldset></form>}
    {(mode === 'login' || mode === 'register') && <><div className="auth-divider"><span>or continue with</span></div><SocialSignIn busy={busy} onGoogle={token => void run(async () => { const ok = await client.loginWithGoogle(async () => token); if (ok && alive.current) navigate('/rooms', { replace: true }); })} onFacebook={acquire => void run(async () => { const ok = await client.loginWithFacebook(acquire); if (ok && alive.current) navigate('/rooms', { replace: true }); })} /><p className="auth-switch">{mode === 'login' ? 'New to Sonora?' : 'Already part of the room?'} <Link to={mode === 'login' ? '/auth/register' : '/auth/login'}>{mode === 'login' ? 'Create an account' : 'Log in'} <span aria-hidden="true">↗</span></Link></p><div className="auth-note"><Icon name="lock" /><span>Your account. Your space.<br /><strong>Good music is better when it’s shared.</strong></span></div></>}
    {mode !== 'login' && mode !== 'register' && <nav className="auth-links" aria-label="Account navigation"><Link to="/auth/login">Log in</Link><Link to="/auth/register">Create account</Link><Link to="/auth/forgot-password">Forgot password?</Link><Link to="/auth/reset-password">Use a reset link</Link></nav>}
  </section>;
}
