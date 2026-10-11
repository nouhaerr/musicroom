import type { FacebookCredential } from '../auth/facebook-flow';
import type { OwnProfile, ProfileDraft } from './profiles.ts';
import { profileChanges } from './profiles.ts';

export interface User {
  id: string;
  name: string;
  email: string;
  musicPreferences: string[];
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface TokenStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export interface DeviceInfo {
  platform: 'IOS' | 'ANDROID';
  model: string;
  appVersion?: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const SESSION_KEY = 'sonora.session.v1';

export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a valid HTTP or HTTPS address.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use only the server address, for example http://192.168.1.20:3000.');
  }
  return url.origin;
}

export function tokenFromInput(input: string): string {
  const value = input.trim();
  if (!value) throw new Error('Paste the link received by email.');
  let token = value;
  if (value.includes('://')) {
    try { token = new URL(value).searchParams.get('token') ?? ''; } catch { token = ''; }
  }
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('The link does not contain a valid verification token.');
  }
  return token;
}

function sessionFrom(value: unknown): Session {
  const s = value as Partial<Session> | null;
  if (!s || typeof s.accessToken !== 'string' || typeof s.refreshToken !== 'string' ||
      !s.accessToken || !s.refreshToken || typeof s.user?.id !== 'string' ||
      typeof s.user?.name !== 'string' || typeof s.user?.email !== 'string') {
    throw new ApiError(502, 'Invalid login response. Please log in again.');
  }
  return s as Session;
}

/** One instance per backend. Never log credentials or automatically retry a refresh. */
export class ApiClient {
  readonly baseUrl: string;
  private session: Session | null = null;
  private refreshFlight: Promise<void> | null = null;
  private generation = 0;
  private writes: Promise<void> = Promise.resolve();
  private listeners = new Set<(user: User | null) => void>();
  private deviceId: string | null = null;
  private deviceFlight: Promise<void> | null = null;
  private storage: TokenStorage;
  private fetcher: typeof fetch;
  private deviceInfo?: DeviceInfo;

  constructor(baseUrl: string, storage: TokenStorage, fetcher: typeof fetch = fetch, deviceInfo?: DeviceInfo) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.storage = storage;
    this.fetcher = fetcher;
    this.deviceInfo = deviceInfo;
  }

  get user() { return this.session?.user ?? null; }

  subscribe(listener: (user: User | null) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify() { this.listeners.forEach(listener => listener(this.user)); }

  // Serial writes prevent an in-flight refresh from restoring storage after logout.
  private persist(refreshToken: string | null, generation = this.generation) {
    const write = this.writes.catch(() => undefined).then(async () => {
      if (generation !== this.generation) return;
      if (refreshToken) await this.storage.setItem(SESSION_KEY, JSON.stringify({ baseUrl: this.baseUrl, refreshToken }));
      else await this.storage.deleteItem(SESSION_KEY);
    });
    this.writes = write;
    return write;
  }

  private async clearSession() {
    this.generation++;
    this.session = null;
    this.deviceId = null;
    this.deviceFlight = null;
    this.refreshFlight = null;
    this.notify();
    await this.persist(null);
  }

  private async transport(path: string, method: string, body?: unknown, token?: string, deviceId = this.deviceId): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.fetcher(this.baseUrl + path, {
        method,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}`, ...(deviceId ? { 'X-Device-Id': deviceId } : {}) } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const messages = data?.message;
        const message = Array.isArray(messages) ? messages.join('\n') : messages;
        throw new ApiError(response.status, typeof message === 'string' ? message : `The server rejected the request (${response.status}).`);
      }
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, 'Server unreachable. Check the server address and your connection.');
    } finally { clearTimeout(timeout); }
  }

  async restore() {
    const raw = await this.storage.getItem(SESSION_KEY);
    if (!raw) return;
    let saved: { baseUrl?: string; refreshToken?: string };
    try { saved = JSON.parse(raw); } catch { await this.clearSession(); return; }
    if (!saved || saved.baseUrl !== this.baseUrl || typeof saved.refreshToken !== 'string' || !saved.refreshToken) {
      await this.clearSession();
      return;
    }
    await this.refresh(saved.refreshToken);
  }

  private refresh(savedToken?: string): Promise<void> {
    if (this.refreshFlight) return this.refreshFlight;
    const token = savedToken ?? this.session?.refreshToken;
    if (!token) return Promise.reject(new ApiError(401, 'Please log in.'));
    const generation = this.generation;
    const flight = (async () => {
      try {
        // Remove the consumed credential BEFORE sending: a crash or lost response must not
        // replay it on restart and revoke all other sessions on the backend.
        await this.persist(null, generation);
        if (generation !== this.generation) throw new ApiError(401, 'Session closed.');
        const session = sessionFrom(await this.transport('/auth/refresh', 'POST', { refreshToken: token }));
        if (generation !== this.generation) throw new ApiError(401, 'Session closed.');
        await this.persist(session.refreshToken, generation);
        if (generation !== this.generation) throw new ApiError(401, 'Session closed.');
        this.session = session;
        this.notify();
      } catch (error) {
        if (generation === this.generation) await this.clearSession();
        if (error instanceof ApiError && error.status === 0) {
          throw new ApiError(0, 'Session refresh interrupted. Log in again to avoid reusing an old session.');
        }
        throw error;
      }
    })();
    this.refreshFlight = flight;
    void flight.finally(() => { if (this.refreshFlight === flight) this.refreshFlight = null; }).catch(() => undefined);
    return flight;
  }

  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const generation = this.generation;
    if (this.deviceInfo) {
      await this.registerDevice(this.deviceInfo.platform, this.deviceInfo.model, this.deviceInfo.appVersion);
      if (generation !== this.generation) throw new ApiError(401, 'Session closed.');
    }
    return this.authenticatedRequest<T>(path, method, body);
  }

  // Device discovery/registration must not wait on its own readiness gate.
  private async authenticatedRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const token = this.session?.accessToken;
    const generation = this.generation;
    if (!token) throw new ApiError(401, 'Please log in.');
    try {
      const result = await this.transport(path, method, body, token) as T;
      if (generation !== this.generation) throw new ApiError(401, 'Session closed.');
      return result;
    }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      if (generation !== this.generation) throw new ApiError(401, 'Session closed.');
      // A late 401 for the old token must reuse the refresh already performed by another request.
      if (this.session?.accessToken === token) await this.refresh();
      const fresh = this.session?.accessToken;
      if (!fresh || generation !== this.generation) throw new ApiError(401, 'Please log in again.');
      try {
        const result = await this.transport(path, method, body, fresh) as T;
        if (generation !== this.generation) throw new ApiError(401, 'Session closed.');
        return result;
      }
      catch (retryError) {
        if (retryError instanceof ApiError && retryError.status === 401 && generation === this.generation) await this.clearSession();
        throw retryError;
      }
    }
  }

  async login(email: string, password: string) {
    await this.authenticate('/auth/login', async () => ({ email: email.trim(), password }));
  }

  async loginWithGoogle(acquireToken: () => Promise<string | null>): Promise<boolean> {
    return this.authenticate('/auth/google', async () => {
      const idToken = await acquireToken();
      return idToken ? { idToken } : null;
    });
  }

  async loginWithFacebook(acquire: () => Promise<FacebookCredential | null>): Promise<boolean> {
    return this.authenticate('/auth/facebook', async () => {
      const credential = await acquire();
      return credential ? { ...credential } : null;
    });
  }

  async linkFacebook(acquire: () => Promise<FacebookCredential | null>): Promise<boolean> {
    const generation = this.generation;
    if (!this.session) throw new ApiError(401, 'Log in before linking Facebook.');
    const credential = await acquire();
    if (!credential) return false;
    if (generation !== this.generation) throw new ApiError(401, 'Session closed.');
    await this.syncProfile('/auth/link/facebook', 'POST', credential);
    return true;
  }

  async linkGoogle(acquireToken: () => Promise<string | null>): Promise<boolean> {
    const generation = this.generation;
    if (!this.session) throw new ApiError(401, 'Log in before linking Google.');
    const idToken = await acquireToken();
    if (!idToken) return false;
    if (generation !== this.generation) throw new ApiError(401, 'Session closed.');
    await this.syncProfile('/auth/link/google', 'POST', { idToken });
    return true;
  }

  private async authenticate(path: string, acquireBody: () => Promise<Record<string, string> | null>): Promise<boolean> {
    const generation = ++this.generation;
    this.deviceId = null;
    this.deviceFlight = null;
    const body = await acquireBody();
    if (!body || generation !== this.generation) return false;
    const session = sessionFrom(await this.transport(path, 'POST', body));
    if (generation !== this.generation) return false;
    try { await this.persist(session.refreshToken, generation); }
    catch { await this.clearSession(); throw new Error('Unable to save the session in secure storage.'); }
    if (generation !== this.generation) return false;
    this.session = session;
    this.notify();
    return true;
  }

  async logout() {
    // Clear local state immediately even offline. Use the captured access token only;
    // do not create another session or race with a refresh during logout.
    const token = this.session?.accessToken;
    const deviceId = this.deviceId;
    await this.clearSession();
    if (!token) return;
    try { await this.transport('/auth/logout', 'POST', {}, token, deviceId); }
    catch {
      throw new Error('Logged out locally. The server did not confirm session revocation.');
    }
  }

  async getMyProfile(): Promise<OwnProfile> {
    return this.syncProfile('/users/me', 'GET');
  }

  async updateMyProfile(original: OwnProfile, draft: ProfileDraft): Promise<OwnProfile> {
    return this.syncProfile('/users/me', 'PATCH', profileChanges(original, draft));
  }

  private async syncProfile(path: string, method: string, body?: unknown): Promise<OwnProfile> {
    const generation = this.generation;
    const profile = await this.request<OwnProfile>(path, method, body);
    if (!this.session || generation !== this.generation) throw new ApiError(401, 'Session closed.');
    if (profile?.id !== this.session.user.id || typeof profile.name !== 'string' ||
        typeof profile.email !== 'string' || !Array.isArray(profile.musicPreferences) ||
        !profile.musicPreferences.every(g => typeof g === 'string')) {
      throw new ApiError(502, 'Invalid profile response. Please try again.');
    }
    this.session = { ...this.session, user: profile };
    this.notify();
    return profile;
  }

  registerDevice(platform: 'IOS' | 'ANDROID', model: string, appVersion = '0.1.0'): Promise<void> {
    if (!this.user) return Promise.reject(new ApiError(401, 'Please log in.'));
    if (this.deviceId) return Promise.resolve();
    if (this.deviceFlight) return this.deviceFlight;
    const flight = this.prepareDevice({ platform, model, appVersion });
    this.deviceFlight = flight;
    void flight.finally(() => { if (this.deviceFlight === flight) this.deviceFlight = null; }).catch(() => undefined);
    return flight;
  }

  private async prepareDevice(info: DeviceInfo) {
    const generation = this.generation;
    const userId = this.user?.id;
    const assertActive = () => {
      if (generation !== this.generation || !userId || this.user?.id !== userId) throw new ApiError(401, 'Session closed.');
    };
    const key = 'sonora.device.v1';
    const raw = await this.storage.getItem(key);
    let saved: { baseUrl?: string; userId?: string; id?: string } | null = null;
    try { saved = raw ? JSON.parse(raw) : null; } catch { /* Replace malformed local metadata. */ }
    assertActive();
    if (saved?.baseUrl === this.baseUrl && saved?.userId === userId && typeof saved?.id === 'string' && saved.id) {
      // Only reuse an ID still present in this user's server-side device list.
      // Traverse pages: another device may have been registered more recently.
      for (let page = 1; ; page++) {
        const devices = await this.authenticatedRequest<{ id: string }[]>(`/devices?page=${page}&limit=100`);
        assertActive();
        if (!Array.isArray(devices) || !devices.every(device => typeof device?.id === 'string')) {
          throw new Error('Invalid device list response.');
        }
        if (devices.some(device => device.id === saved.id)) {
          this.deviceId = saved.id;
          return;
        }
        if (devices.length < 100) break;
      }
    }
    const device = await this.authenticatedRequest<{ id: string }>('/devices', 'POST', info);
    assertActive();
    if (typeof device?.id !== 'string' || !device.id) throw new Error('Invalid device registration response.');
    await this.storage.setItem(key, JSON.stringify({ baseUrl: this.baseUrl, userId, id: device.id }));
    assertActive();
    this.deviceId = device.id;
  }

  register(name: string, email: string, password: string) {
    return this.transport('/auth/register', 'POST', { name: name.trim(), email: email.trim(), password });
  }
  resend(email: string) { return this.transport('/auth/resend-verification', 'POST', { email: email.trim() }); }
  forgot(email: string) { return this.transport('/auth/forgot-password', 'POST', { email: email.trim() }); }
  verify(link: string) { return this.transport(`/auth/verify-email?token=${encodeURIComponent(tokenFromInput(link))}`, 'GET'); }
  async reset(link: string, newPassword: string) {
    await this.transport('/auth/reset-password', 'POST', { token: tokenFromInput(link), newPassword });
    await this.clearSession();
  }
}
