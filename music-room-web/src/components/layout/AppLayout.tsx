import { NavLink, Outlet } from 'react-router-dom';
const links = [['/', 'Home'], ['/rooms', 'Rooms'], ['/playlists', 'Playlists'], ['/friends', 'Friends'], ['/devices', 'Devices'], ['/invitations', 'Invitations'], ['/profile', 'Profile'], ['/auth/login', 'Log in']];
export function AppLayout() {
  return <><a className="skip-link" href="#main">Skip to content</a><header className="site-header"><NavLink to="/" className="brand">Sonora</NavLink><nav aria-label="Main navigation">{links.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}</nav></header><main id="main" tabIndex={-1}><Outlet /></main><footer>Sonora · Good music. Better together.</footer></>;
}
