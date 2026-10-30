import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
export function AccountPage() {
  const { client, user } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { if (!notice && !error) return; const timer = setTimeout(() => { setNotice(''); setError(''); }, 10000); return () => clearTimeout(timer); }, [notice, error]);
  useEffect(() => { let active = true; void client.getMyProfile().catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [client]);
  if (loggingOut) return <section className="panel"><h1>You are logged out.</h1>{notice && <p role="status" className="auth-success">{notice}</p>}{error && <p role="alert" className="auth-error">{error}</p>}<Link to="/auth/login">Back to login</Link></section>;
  if (!user) return <Navigate to="/auth/login" replace />;
  return <section className="panel"><p className="eyebrow">YOUR ACCOUNT</p><h1>Hello, {user.name}.</h1><p>{user.email}</p><p>You are signed in. This session ends when you reload or close this tab.</p>{error && <p role="alert" className="auth-error">{error}</p>}<button className="button secondary" disabled={busy} onClick={() => { setBusy(true); setError(''); setLoggingOut(true); void client.logout().then(() => setNotice('Session revoked successfully.')).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>Log out</button></section>;
}
