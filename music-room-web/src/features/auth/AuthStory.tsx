import headphones from '../../assets/headphones.png';

// Independent rows: form height never changes the artwork or the copy below it.
export function AuthStory() {
  return <aside className="auth-story">
    <div className="story-top"><span className="story-tag"><span /> YOUR NEXT FAVORITE STARTS HERE</span><span className="story-number">VOL. 01 / SONORA</span></div>
    <figure className="story-figure">
      <div className="story-art"><img src={headphones} alt="Headphones surrounded by flowing violet light" /></div>
    </figure>
    <div className="story-copy"><h2>Your sound.<br /><em>Your people.</em></h2><p>Find your rhythm. Share the feeling.</p><div className="story-bottom"><span>DISCOVER · CONNECT · LISTEN</span><span className="sound-bars" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ height: 6 + ((i * 7) % 23) }} />)}</span></div></div>
  </aside>;
}
