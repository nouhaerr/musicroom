import { useEffect, useRef, useState } from 'react';
import { facebookCredential, prepareFacebook, prepareGoogle, receiveGoogle, type FacebookSdk } from './browser-social';

export function SocialSignIn({ busy, onGoogle, onFacebook }: {
  busy: boolean;
  onGoogle: (token: string) => void;
  onFacebook: (acquire: () => Promise<{ accessToken: string } | null>) => void;
}) {
  const googleHost = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ busy, onGoogle, onFacebook }); callbacks.current = { busy, onGoogle, onFacebook };
  const [fb, setFb] = useState<FacebookSdk | null>(null);
  const [googleError, setGoogleError] = useState('');
  const [facebookError, setFacebookError] = useState('');
  const [googleReady, setGoogleReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setGoogleError(''); setFacebookError('');
    const release = receiveGoogle(token => { if (active && !callbacks.current.busy) callbacks.current.onGoogle(token); });
    void prepareGoogle(import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '').then(sdk => {
      if (!active || !googleHost.current) return;
      googleHost.current.replaceChildren();
      sdk.accounts.id.renderButton(googleHost.current, { type: 'icon', theme: 'filled_black', size: 'large', shape: 'circle', locale: 'en' });
      setGoogleReady(true);
    }).catch(e => { if (active) setGoogleError(e.message); });
    void prepareFacebook(import.meta.env.VITE_FACEBOOK_APP_ID?.trim() ?? '', import.meta.env.VITE_FACEBOOK_API_VERSION || 'v26.0').then(sdk => { if (active) setFb(sdk); }).catch(e => { if (active) setFacebookError(e.message); });
    return () => { active = false; release(); };
  }, [attempt]);
  return <div className="social-section">
    <div className="social-buttons">
      <div className="google-button-host" ref={googleHost} inert={busy} aria-label="Google sign-in" />
      <button type="button" className="social-button" aria-label="Continue with Facebook" title="Continue with Facebook" disabled={busy || !fb} onClick={() => { if (fb) onFacebook(() => facebookCredential(fb)); }}><span className="facebook-mark" aria-hidden="true">f</span></button>
    </div>
    {!googleReady && !googleError && <p role="status" className="social-status">Loading Google…</p>}
    {(googleError || facebookError) && <div className="social-status" role="status">{googleError && <p>{googleError}</p>}{facebookError && <p>{facebookError}</p>}<button type="button" className="social-retry" disabled={busy} onClick={() => setAttempt(n => n + 1)}>Retry social sign-in</button></div>}
  </div>;
}
