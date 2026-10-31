import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthProvider';
export function UserMenu() {
  const { user, client } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const location = useLocation(); const navigate = useNavigate();
  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, []);
  if (!user) return <Link to="/auth/login">Log in</Link>;
  return <div ref={root} className="user-menu" onMouseEnter={() => setOpen(true)} onMouseLeave={() => { if (!root.current?.contains(document.activeElement)) setOpen(false); }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }} onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } }}>
    <button ref={trigger} className="user-menu-trigger" aria-label="Open user menu" aria-expanded={open} aria-controls="user-dropdown" onClick={() => setOpen(true)}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 22v-3a8 8 0 0 1 16 0v3" /></svg></button>
    {open && <div id="user-dropdown" className="user-dropdown"><div className="menu-identity"><strong>{user.name}</strong><span>{user.email}</span></div><Link to="/profile">View my profile</Link><Link to="/friends">Manage friends</Link><button disabled={busy} onClick={() => { setBusy(true); void client.logout().then(() => navigate('/auth/login', { replace: true, state: { notice: 'You are logged out.' } })).catch(e => navigate('/auth/login', { replace: true, state: { notice: e.message } })).finally(() => setBusy(false)); }}>Log out</button></div>}
  </div>;
}
