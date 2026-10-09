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
  try { url = new URL(value.trim()); } catch { throw new Error('Saisissez une adresse HTTP ou HTTPS valide.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Utilisez uniquement l’adresse du serveur, par exemple http://192.168.1.20:3000.');
  }
  return url.origin;
}

export function tokenFromInput(input: string): string {
  const value = input.trim();
  if (!value) throw new Error('Collez le lien reçu par email.');
  let token = value;
  if (value.includes('://')) {
    try { token = new URL(value).searchParams.get('token') ?? ''; } catch { token = ''; }
  }
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('Le lien ne contient pas de code de validation valide.');
  }
  return token;
}

function sessionFrom(value: unknown): Session {
  const s = value as Partial<Session> | null;
  if (!s || typeof s.accessToken !== 'string' || typeof s.refreshToken !== 'string' ||
      !s.accessToken || !s.refreshToken || typeof s.user?.id !== 'string' ||
      typeof s.user?.name !== 'string' || typeof s.user?.email !== 'string') {
    throw new ApiError(502, 'Réponse de connexion invalide. Veuillez vous reconnecter.');
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
  private storage: TokenStorage;
  private fetcher: typeof fetch;

  constructor(baseUrl: string, storage: TokenStorage, fetcher: typeof fetch = fetch) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.storage = storage;
    this.fetcher = fetcher;
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
        throw new ApiError(response.status, typeof message === 'string' ? message : `Le serveur a refusé la demande (${response.status}).`);
      }
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, 'Serveur inaccessible. Vérifiez l’adresse du serveur et votre connexion.');
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
    if (!token) return Promise.reject(new ApiError(401, 'Veuillez vous connecter.'));
    const generation = this.generation;
    const flight = (async () => {
      try {
        // Remove the consumed credential BEFORE sending: a crash or lost response must not
        // replay it on restart and revoke all other sessions on the backend.
        await this.persist(null, generation);
        if (generation !== this.generation) throw new ApiError(401, 'Session fermée.');
        const session = sessionFrom(await this.transport('/auth/refresh', 'POST', { refreshToken: token }));
        if (generation !== this.generation) throw new ApiError(401, 'Session fermée.');
        await this.persist(session.refreshToken, generation);
        if (generation !== this.generation) throw new ApiError(401, 'Session fermée.');
        this.session = session;
        this.notify();
      } catch (error) {
        if (generation === this.generation) await this.clearSession();
        if (error instanceof ApiError && error.status === 0) {
          throw new ApiError(0, 'Renouvellement interrompu. Reconnectez-vous pour éviter de réutiliser une ancienne session.');
        }
        throw error;
      }
    })();
    this.refreshFlight = flight;
    void flight.finally(() => { if (this.refreshFlight === flight) this.refreshFlight = null; }).catch(() => undefined);
    return flight;
  }

  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const token = this.session?.accessToken;
    const generation = this.generation;
    if (!token) throw new ApiError(401, 'Veuillez vous connecter.');
    try {
      const result = await this.transport(path, method, body, token) as T;
      if (generation !== this.generation) throw new ApiError(401, 'Session fermée.');
      return result;
    }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      if (generation !== this.generation) throw new ApiError(401, 'Session fermée.');
      // A late 401 for the old token must reuse the refresh already performed by another request.
      if (this.session?.accessToken === token) await this.refresh();
      const fresh = this.session?.accessToken;
      if (!fresh || generation !== this.generation) throw new ApiError(401, 'Veuillez vous reconnecter.');
      try {
        const result = await this.transport(path, method, body, fresh) as T;
        if (generation !== this.generation) throw new ApiError(401, 'Session fermée.');
        return result;
      }
      catch (retryError) {
        if (retryError instanceof ApiError && retryError.status === 401 && generation === this.generation) await this.clearSession();
        throw retryError;
      }
    }
  }

  async login(email: string, password: string) {
    const generation = ++this.generation;
    this.deviceId = null;
    const session = sessionFrom(await this.transport('/auth/login', 'POST', { email: email.trim(), password }));
    if (generation !== this.generation) return;
    try { await this.persist(session.refreshToken, generation); }
    catch { await this.clearSession(); throw new Error('Impossible de sauvegarder la session dans le stockage sécurisé.'); }
    if (generation !== this.generation) return;
    this.session = session;
    this.notify();
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
      throw new Error('Déconnexion locale effectuée. Le serveur n’a pas confirmé la révocation de la session.');
    }
  }

  async registerDevice(platform: 'IOS' | 'ANDROID', model: string) {
    const generation = this.generation;
    const userId = this.user?.id;
    if (!userId) return;
    const key = 'sonora.device.v1';
    const raw = await this.storage.getItem(key);
    let saved: { baseUrl?: string; userId?: string; id?: string } | null = null;
    try { saved = raw ? JSON.parse(raw) : null; } catch { /* Replace malformed local metadata. */ }
    if (generation !== this.generation) return;
    if (saved?.baseUrl === this.baseUrl && saved?.userId === userId && typeof saved?.id === 'string') {
      this.deviceId = saved.id;
      return;
    }
    const device = await this.request<{ id: string }>('/devices', 'POST', { platform, model, appVersion: '0.1.0' });
    if (generation !== this.generation) return;
    if (typeof device?.id !== 'string') throw new Error('Réponse d’enregistrement de l’appareil invalide.');
    this.deviceId = device.id;
    await this.storage.setItem(key, JSON.stringify({ baseUrl: this.baseUrl, userId, id: device.id }));
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
