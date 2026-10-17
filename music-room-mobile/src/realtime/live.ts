import { io, type Socket } from 'socket.io-client';
import type { PartySnapshot } from '../api/parties.ts';

// The live connection of the app. Screens say what they watch; this keeps the connection, the
// login and the subscriptions alive behind them. Protocol: music-room-api/README.md, "Temps réel".

export type Target = { type: 'party' | 'playlist'; id: string };

// Typed by the Playlists screens when they exist
export interface PlaylistSnapshot {
  playlist: { id: string };
  songs: unknown[];
  songsLength: number;
}
type Snapshot = PartySnapshot | PlaylistSnapshot;

// Why a watcher will receive nothing more: a refusal code of the server, or the end of the login
export type GoneReason =
  | 'FORBIDDEN' | 'NOT_FOUND' | 'BAD_REQUEST' | 'TOO_MANY'
  | 'UNAUTHORIZED' | 'TOO_MANY_CONNECTIONS' | 'SIGNED_OUT';

export interface Watcher<S> {
  onSnapshot(snapshot: S): void; // the full current state: replace what is shown
  onGone(reason: GoneReason): void; // nothing more will come: leave the screen
}

// What the connection needs from the API client (ApiClient has all of it)
export interface LiveSource {
  readonly baseUrl: string;
  readonly user: { id: string } | null;
  socketAuth(refusedToken?: string): Promise<{ token: string; deviceId: string | null }>;
  subscribe(listener: (user: { id: string } | null) => void): () => void;
}

type Open = (url: string, options: { transports: string[]; autoConnect: boolean }) => Socket;
type Ack = { ok?: boolean; error?: { code?: string } };
interface Entry {
  target: Target;
  watchers: Set<Watcher<Snapshot>>;
  asked: boolean; // `subscribe` was sent on the current connection
  last?: Snapshot;
}

const RETRY_MS = 5_000; // before trying again what failed for a passing reason
const ACK_TIMEOUT_MS = 10_000; // the server answers every message: silence means a dead connection
const FINAL = ['FORBIDDEN', 'NOT_FOUND', 'BAD_REQUEST', 'TOO_MANY'] as const; // refusals that asking again cannot change
const LISTS = { party: ['queue', 'queueLength'], playlist: ['songs', 'songsLength'] } as const;
const keyOf = (target: Target) => `${target.type}:${target.id}`;

// The id of the party or playlist a snapshot is about; null if it does not look like a snapshot
function subjectId(type: Target['type'], payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const data = payload as Record<string, unknown>;
  const subject = data[type];
  if (typeof subject !== 'object' || subject === null) return null;
  const id = (subject as Record<string, unknown>).id;
  const [list, length] = LISTS[type];
  return typeof id === 'string' && Array.isArray(data[list]) && typeof data[length] === 'number' ? id : null;
}

export class Live {
  private source: LiveSource;
  private open: Open;
  private entries = new Map<string, Entry>();
  private socket: Socket | null = null;
  private token: string | null = null; // the access token the connection was opened with
  private connecting = false;
  private retried = false; // the token was already renewed once after the server refused the login
  private expired = false; // the server announced session:expired
  private full = false; // the server announced connection:refused
  private epoch = 0; // +1 each time a connection ends: answers and retries from before are ignored
  private userId: string | null;
  private stopListening: () => void;

  constructor(source: LiveSource, open: Open = io) {
    this.source = source;
    this.open = open;
    this.userId = source.user?.id ?? null;
    // Another user, or nobody: whatever is watched belonged to the previous login
    const whenUserChanges = (user: { id: string } | null) => {
      const id = user?.id ?? null;
      if (id === this.userId) return;
      this.userId = id;
      this.end('SIGNED_OUT');
    };
    this.stopListening = source.subscribe(whenUserChanges);
  }

  // Both return the function that stops watching. Several screens may watch the same thing.
  watchParty(id: string, watcher: Watcher<PartySnapshot>) {
    return this.watch({ type: 'party', id }, watcher);
  }

  watchPlaylist(id: string, watcher: Watcher<PlaylistSnapshot>) {
    return this.watch({ type: 'playlist', id }, watcher);
  }

  // To call when the app comes back to the front: the connection may have died in the background
  resume() {
    if (this.entries.size === 0) return;
    if (!this.socket) {
      void this.connect();
      return;
    }
    for (const entry of this.entries.values()) {
      entry.asked = false;
      this.subscribe(entry); // a fresh snapshot comes back; silence restarts the connection
    }
  }

  // The API client is being replaced (another server): nothing of this one must survive
  destroy() {
    this.stopListening();
    this.end('SIGNED_OUT');
  }

  private watch(target: Target, watcher: Watcher<Snapshot>): () => void {
    const key = keyOf(target);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { target, watchers: new Set(), asked: false };
      this.entries.set(key, entry);
    }
    const watched = entry;
    watched.watchers.add(watcher);
    if (watched.last) watcher.onSnapshot(watched.last); // already known: show it without waiting
    if (!this.socket) void this.connect();
    else this.subscribe(watched);
    return () => this.unwatch(watched, watcher);
  }

  private unwatch(entry: Entry, watcher: Watcher<Snapshot>) {
    entry.watchers.delete(watcher);
    // Still watched by another screen, or already dropped (and maybe watched again since)
    if (entry.watchers.size > 0 || !this.watched(entry)) return;
    this.entries.delete(keyOf(entry.target));
    if (this.entries.size === 0) this.close(); // closing the connection ends its subscriptions too
    else if (this.socket?.connected) this.socket.emit('unsubscribe', entry.target);
  }

  // Opens the connection with a login the server accepts. `refused`: the token it just turned down.
  private async connect(refused?: string) {
    if (this.connecting) return;
    this.connecting = true;
    try {
      const auth = await this.source.socketAuth(refused);
      if (this.entries.size === 0) return; // nothing to watch any more
      this.token = auth.token;
      if (!this.socket) this.socket = this.create();
      const info: { token: string; deviceId?: string } = { token: auth.token };
      if (auth.deviceId) info.deviceId = auth.deviceId;
      this.socket.auth = info;
      this.socket.connect();
    } catch {
      if (this.entries.size === 0) return;
      // No login any more: the end. Otherwise the preparation failed (network): try again later.
      if (!this.source.user) this.end('SIGNED_OUT');
      else this.later(() => void this.connect(refused));
    } finally {
      this.connecting = false;
    }
  }

  private create(): Socket {
    const socket = this.open(this.source.baseUrl, { transports: ['websocket'], autoConnect: false });
    socket.on('connect', () => {
      this.retried = false;
      // A new connection knows nothing: ask again for everything watched
      for (const entry of this.entries.values()) this.subscribe(entry);
    });
    socket.on('connect_error', () => this.refused());
    socket.on('disconnect', (reason: string) => this.disconnected(reason));
    socket.on('party:snapshot', (payload: unknown) => this.receive('party', payload));
    socket.on('playlist:snapshot', (payload: unknown) => this.receive('playlist', payload));
    socket.on('unsubscribed', (payload: unknown) => {
      const { type, id } = (payload ?? {}) as Partial<Target>;
      const entry = this.entries.get(`${type}:${id}`);
      if (entry) this.drop(entry, 'FORBIDDEN');
    });
    socket.on('session:expired', () => { this.expired = true; });
    socket.on('connection:refused', () => { this.full = true; });
    return socket;
  }

  // Asks the server for one thing we watch, once per connection
  private subscribe(entry: Entry) {
    const socket = this.socket;
    if (!socket?.connected || entry.asked || !this.watched(entry)) return;
    entry.asked = true;
    const epoch = this.epoch;
    socket.timeout(ACK_TIMEOUT_MS).emit('subscribe', entry.target, (silence: Error | null, ack?: Ack) => {
      // Too late: the connection changed since, or this is no longer watched
      if (epoch !== this.epoch || !this.watched(entry)) return;
      if (silence) {
        this.restart();
        return;
      }
      if (ack?.ok) return;
      entry.asked = false;
      const final = FINAL.find((code) => code === ack?.error?.code);
      if (final) this.drop(entry, final);
      else this.later(() => this.subscribe(entry)); // RATE_LIMITED, INTERNAL...: ask again in a moment
    });
  }

  private receive(type: Target['type'], payload: unknown) {
    const id = subjectId(type, payload);
    const entry = id ? this.entries.get(keyOf({ type, id })) : undefined;
    if (!entry) return; // not a snapshot, or of something no longer watched (it was on its way)
    const snapshot = payload as Snapshot;
    entry.last = snapshot;
    for (const watcher of [...entry.watchers]) watcher.onSnapshot(snapshot);
  }

  // The handshake failed. A network problem is retried by socket.io itself. A refusal by the
  // server is about the token: renew it once, and give up if the server refuses the new one too.
  private refused() {
    if (this.socket?.active) return;
    if (this.retried) {
      this.end('UNAUTHORIZED');
      return;
    }
    this.retried = true;
    void this.connect(this.token ?? undefined);
  }

  private disconnected(reason: string) {
    this.epoch += 1;
    for (const entry of this.entries.values()) entry.asked = false;
    // A network cut (or our own restart): socket.io reconnects and 'connect' asks for everything again
    if (reason !== 'io server disconnect') return;
    if (this.full) {
      this.end('TOO_MANY_CONNECTIONS');
      return;
    }
    // The server closed the connection. After session:expired, the token is renewed first.
    const refused = this.expired && this.token ? this.token : undefined;
    this.expired = false;
    void this.connect(refused);
  }

  // The connection looks open but the server does not answer: drop it and open it again
  private restart() {
    const socket = this.socket;
    if (!socket) return;
    socket.disconnect();
    socket.connect();
  }

  // Still what we watch under this name? Not after it was dropped, even if watched again since.
  private watched(entry: Entry) {
    return this.entries.get(keyOf(entry.target)) === entry;
  }

  // Watching this one is over: tell its watchers and forget it
  private drop(entry: Entry, reason: GoneReason) {
    this.entries.delete(keyOf(entry.target));
    if (this.entries.size === 0) this.close();
    for (const watcher of [...entry.watchers]) watcher.onGone(reason);
  }

  // Watching anything is over (logged out, refused by the server): tell everyone and close
  private end(reason: GoneReason) {
    const entries = [...this.entries.values()];
    this.entries.clear();
    this.close();
    for (const entry of entries) {
      for (const watcher of [...entry.watchers]) watcher.onGone(reason);
    }
  }

  private close() {
    this.epoch += 1;
    this.retried = false;
    this.expired = false;
    this.full = false;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.off(); // nothing it still says matters
    socket.disconnect();
  }

  // Runs `action` after the retry delay, unless a connection ended in between
  private later(action: () => void) {
    const epoch = this.epoch;
    setTimeout(() => {
      if (epoch === this.epoch) action();
    }, RETRY_MS);
  }
}
