import { UserMenu } from './UserMenu';
import { useAuth } from '../../features/auth/AuthProvider';
import { AuthStory } from '../../features/auth/AuthStory';
import '../../features/auth/auth.css';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
const links = [['/', 'Home'], ['/rooms', 'Rooms'], ['/playlists', 'Playlists'], ['/friends', 'Friends'], ['/devices', 'Devices'], ['/invitations', 'Invitations'], ];
export function AppLayout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const isHome = pathname === '/';
  const auth = (!user && isHome) || pathname.startsWith('/auth/');
  if (auth) return <div className="auth-shell"><a className="skip-link" href="#main">Skip to content</a><header className="auth-header"><NavLink to="/" className="brand"><span className="brand-wave" aria-hidden="true">∿</span> Sonora<span className="brand-dot">.</span></NavLink><span className="header-caption">ONE ROOM. EVERYONE’S SOUND.</span><NavLink to={isHome ? "/auth/register" : "/"}>{isHome ? "Create an account" : "Back to home"} <span aria-hidden="true">↗</span></NavLink></header><main id="main" className="auth-main" tabIndex={-1}><div className="auth-grid"><AuthStory /><Outlet /></div></main><footer className="auth-footer"><span>© {new Date().getFullYear()} Sonora</span><span>Made for the moments in between.</span></footer></div>;
  return <><a className="skip-link" href="#main">Skip to content</a><header className="site-header"><NavLink to="/" className="brand">Sonora</NavLink><nav aria-label="Main navigation">{links.filter(([to]) => !user || to !== '/').map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}</nav><UserMenu /></header><main id="main" tabIndex={-1}><Outlet /></main><footer>Sonora · Good music. Better together.</footer></>;
}
