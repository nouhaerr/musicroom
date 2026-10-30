import { Link } from 'react-router-dom';
export function HomePage() {
  return <section className="hero"><p className="eyebrow">WELCOME TO SONORA</p><h1>Good music.<br />Better together.</h1><p>Discover rooms, build playlists and find your people.</p><div className="actions"><Link className="button" to="/rooms">Explore rooms</Link><Link className="button secondary" to="/auth/login">Log in</Link></div><p className="status">Web preview — features are being built.</p></section>;
}
