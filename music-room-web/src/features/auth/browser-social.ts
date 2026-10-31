export type FacebookResult = { authResponse?: { accessToken?: string }; status?: string };
export type FacebookSdk = {
  init(options: { appId: string; version: string; cookie: boolean; xfbml: boolean; status: boolean }): void;
  login(callback: (result: FacebookResult) => void, options: { scope: string; return_scopes: boolean }): void;
};
type GoogleSdk = { accounts: { id: {
  initialize(options: { client_id: string; callback: (result: { credential?: string }) => void; auto_select: boolean; ux_mode: string }): void;
  renderButton(element: HTMLElement, options: Record<string, string | number>): void;
} } };
declare global { interface Window { google?: GoogleSdk; FB?: FacebookSdk } }
const scripts = new Map<string, Promise<void>>();
export function loadScript(src: string): Promise<void> {
  const existing = scripts.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const timer = window.setTimeout(() => fail(), 15000);
    const fail = () => { clearTimeout(timer); script.remove(); reject(new Error('Unable to load social sign-in. Check your connection or browser content blocker, then retry.')); };
    script.src = src; script.async = true;
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = fail;
    document.head.append(script);
  });
  scripts.set(src, promise);
  void promise.catch(() => scripts.delete(src));
  return promise;
}
let googleCallback: ((token: string) => void) | null = null;
let googleInitialized = false;
export async function prepareGoogle(clientId: string) {
  if (!clientId) throw new Error('Google sign-in is not configured for this website.');
  await loadScript('https://accounts.google.com/gsi/client');
  if (!window.google) throw new Error('Google sign-in is unavailable. Please retry.');
  if (!googleInitialized) {
    window.google.accounts.id.initialize({ client_id: clientId, auto_select: false, ux_mode: 'popup', callback: result => { if (result.credential) googleCallback?.(result.credential); } });
    googleInitialized = true;
  }
  return window.google;
}
export function receiveGoogle(callback: (token: string) => void) {
  googleCallback = callback;
  return () => { if (googleCallback === callback) googleCallback = null; };
}
let facebookInitialized = false;
export async function prepareFacebook(appId: string, version: string) {
  if (!appId) throw new Error('Facebook sign-in is not configured for this website.');
  if (!/^v\d+\.\d+$/.test(version)) throw new Error('Facebook API version is invalid.');
  await loadScript('https://connect.facebook.net/en_US/sdk.js');
  if (!window.FB) throw new Error('Facebook sign-in is unavailable. Please retry.');
  if (!facebookInitialized) {
    window.FB.init({ appId, version, cookie: false, xfbml: false, status: false });
    facebookInitialized = true;
  }
  return window.FB;
}
// Called directly inside the click event, with the SDK already loaded, to allow its popup.
export function facebookCredential(sdk: FacebookSdk): Promise<{ accessToken: string } | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(new Error('Facebook sign-in timed out. Close the popup and try again.')); }, 120000);
    try {
      sdk.login(result => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        const token = result.authResponse?.accessToken;
        resolve(token ? { accessToken: token } : null);
      }, { scope: 'public_profile,email', return_scopes: true });
    } catch {
      clearTimeout(timer); settled = true;
      reject(new Error('Unable to open Facebook sign-in. Allow popups and check the website settings in Meta.'));
    }
  });
}
