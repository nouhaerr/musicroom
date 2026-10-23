import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Socket } from 'socket.io-client';
import { Live, type GoneReason, type LiveSource } from '../src/realtime/live.ts';

const origin = 'https://api.example.test';
type Listener = (...args: unknown[]) => void;
type Answer = (silence: Error | null, ack?: unknown) => void;

// Stands for the socket.io connection: records what the app sends, and lets a test play the server
class FakeSocket {
  connected = false;
  active = false;
  auth: unknown = undefined;
  connects = 0;
  closes = 0;
  sent: { event: string; payload: unknown; answer?: Answer }[] = [];
  private listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  off() { this.listeners.clear(); return this; }
  emit(event: string, payload: unknown) { this.sent.push({ event, payload }); return this; }
  timeout() {
    return { emit: (event: string, payload: unknown, answer: Answer) => { this.sent.push({ event, payload, answer }); } };
  }
  connect() { this.connects++; this.active = true; return this; }
  disconnect() {
    this.closes++;
    const open = this.connected;
    this.connected = false;
    this.active = false;
    if (open) this.fire('disconnect', 'io client disconnect');
    return this;
  }

  // What the server or the network does
  fire(event: string, ...args: unknown[]) { for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args); }
  accept() { this.connected = true; this.active = true; this.fire('connect'); }
  refuse() { this.connected = false; this.active = false; this.fire('connect_error', new Error('Unauthorized')); }
  serverClose() { this.connected = false; this.active = false; this.fire('disconnect', 'io server disconnect'); }
  networkCut() { this.connected = false; this.active = true; this.fire('disconnect', 'transport close'); }
  listening() { return this.listeners.size > 0; }
  messages(event: string) { return this.sent.filter((message) => message.event === event).map((message) => message.payload); }
  // Answers the oldest message of this kind still waiting for its answer
  answer(event: string, ack: unknown, silence: Error | null = null) {
    const message = this.sent.find((candidate) => candidate.event === event && candidate.answer);
    assert.ok(message?.answer, `no ${event} is waiting for an answer`);
    const { answer } = message;
    message.answer = undefined;
    answer(silence, ack);
  }
}

function fixture() {
  let user: { id: string } | null = { id: 'user-a' };
  let version = 1;
  const listeners = new Set<(user: { id: string } | null) => void>();
  const state = {
    asked: [] as (string | undefined)[], // each call of socketAuth, with the refused token it was given
    failure: null as Error | null,
    deviceId: 'device-1' as string | null,
    hold: null as Promise<void> | null,
    sockets: [] as FakeSocket[],
    opened: [] as { url: string; options: unknown }[],
  };
  const source: LiveSource = {
    baseUrl: origin,
    get user() { return user; },
    async socketAuth(refused) {
      state.asked.push(refused);
      if (state.hold) await state.hold;
      if (state.failure) throw state.failure;
      if (refused === `token-${version}`) version++;
      return { token: `token-${version}`, deviceId: state.deviceId };
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const live = new Live(source, (url, options) => {
    const socket = new FakeSocket();
    state.sockets.push(socket);
    state.opened.push({ url, options });
    return socket as unknown as Socket;
  });
  const setUser = (next: { id: string } | null) => { user = next; listeners.forEach((listener) => listener(user)); };
  return { live, state, setUser, listeners, socket: () => state.sockets[state.sockets.length - 1] };
}

function watcher() {
  const snapshots: unknown[] = [];
  const gone: GoneReason[] = [];
  return { snapshots, gone, onSnapshot: (snapshot: unknown) => { snapshots.push(snapshot); }, onGone: (reason: GoneReason) => { gone.push(reason); } };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const party = (id: string, name = 'Party') => ({ party: { id, name }, queue: [], queueLength: 0 });
const playlist = (id: string) => ({ playlist: { id }, songs: [], songsLength: 0 });
const target = (type: 'party' | 'playlist', id: string) => ({ type, id });
const ok = { ok: true };
const no = (code: string) => ({ ok: false, error: { code, message: code } });
const timers = (t: TestContext) => { t.mock.timers.enable({ apis: ['setTimeout'] }); return t.mock.timers; };

// A party watched over an accepted connection, its subscription already answered
async function watching(id = 'p1') {
  const f = fixture();
  const w = watcher();
  const stop = f.live.watchParty(id, w);
  await settle();
  f.socket().accept();
  f.socket().answer('subscribe', ok);
  return { ...f, w, stop };
}

test('the first thing watched opens the connection with the token and the device, then subscribes', async () => {
  const f = fixture();
  const w = watcher();
  f.live.watchParty('p1', w);
  await settle();
  assert.deepEqual(f.state.opened, [{ url: origin, options: { transports: ['websocket'], autoConnect: false } }]);
  assert.deepEqual(f.socket().auth, { token: 'token-1', deviceId: 'device-1' });
  assert.equal(f.socket().connects, 1);
  assert.deepEqual(f.socket().sent, []); // nothing is sent before the server accepts the connection

  f.socket().accept();
  assert.deepEqual(f.socket().messages('subscribe'), [target('party', 'p1')]);
  f.socket().answer('subscribe', ok);
  f.socket().fire('party:snapshot', party('p1'));
  assert.deepEqual(w.snapshots, [party('p1')]);
  assert.deepEqual(w.gone, []);
});

test('without a device id, the connection is opened with the token alone', async () => {
  const f = fixture();
  f.state.deviceId = null;
  f.live.watchParty('p1', watcher());
  await settle();
  assert.deepEqual(f.socket().auth, { token: 'token-1' });
  assert.equal(f.socket().connects, 1);
});

test('a second thing watched uses the same connection, and each snapshot goes to its own watcher', async () => {
  const f = await watching('p1');
  const second = watcher();
  const list = watcher();
  f.live.watchParty('p2', second);
  f.live.watchPlaylist('p1', list); // the same id as a party: still another thing
  assert.equal(f.state.sockets.length, 1);
  assert.deepEqual(f.socket().messages('subscribe'), [target('party', 'p1'), target('party', 'p2'), target('playlist', 'p1')]);

  f.socket().fire('party:snapshot', party('p2'));
  f.socket().fire('playlist:snapshot', playlist('p1'));
  assert.deepEqual(f.w.snapshots, []);
  assert.deepEqual(second.snapshots, [party('p2')]);
  assert.deepEqual(list.snapshots, [playlist('p1')]);
});

test('two screens watching the same thing share one subscription and the last snapshot', async () => {
  const f = await watching('p1');
  f.socket().fire('party:snapshot', party('p1', 'first'));
  const other = watcher();
  const stopOther = f.live.watchParty('p1', other);
  assert.deepEqual(other.snapshots, [party('p1', 'first')]); // shown at once, without asking the server
  assert.equal(f.socket().messages('subscribe').length, 1);

  f.stop();
  assert.deepEqual(f.socket().messages('unsubscribe'), []); // the other screen still watches
  f.socket().fire('party:snapshot', party('p1', 'second'));
  assert.deepEqual(other.snapshots.length, 2);
  assert.deepEqual(f.w.snapshots, [party('p1', 'first')]);

  stopOther(); // the last screen: the connection closes, which ends the subscription with it
  assert.deepEqual(f.socket().messages('unsubscribe'), []);
  assert.equal(f.socket().closes, 1);
});

test('stopping unsubscribes, and the connection closes with the last thing watched', async () => {
  const f = await watching('p1');
  const second = watcher();
  const stopSecond = f.live.watchParty('p2', second);
  const socket = f.socket();

  f.stop();
  f.stop(); // twice is harmless
  assert.deepEqual(socket.messages('unsubscribe'), [target('party', 'p1')]);
  assert.equal(socket.closes, 0);

  stopSecond(); // the last thing watched: closing the connection is enough
  assert.deepEqual(socket.messages('unsubscribe'), [target('party', 'p1')]);
  assert.equal(socket.closes, 1);
  assert.equal(socket.listening(), false);

  // Watching again later opens a new connection
  f.live.watchParty('p3', watcher());
  await settle();
  assert.equal(f.state.sockets.length, 2);
  assert.deepEqual(f.state.asked, [undefined, undefined]);
});

test('a snapshot of something no longer watched, or anything that is not a snapshot, is ignored', async () => {
  const f = await watching('p1');
  const second = watcher();
  const stopSecond = f.live.watchParty('p2', second);
  stopSecond();
  f.socket().fire('party:snapshot', party('p2')); // it was on its way when the screen closed
  assert.deepEqual(second.snapshots, []);

  for (const payload of [null, undefined, 'text', 7, {}, { party: null }, { party: { id: 3 }, queue: [], queueLength: 0 },
    { party: { id: 'p1' }, queueLength: 0 }, { party: { id: 'p1' }, queue: [] }, { party: { id: 'p1' }, queue: {}, queueLength: 0 },
    { playlist: { id: 'p1' }, songs: [], songsLength: 0 }]) {
    f.socket().fire('party:snapshot', payload);
  }
  assert.deepEqual(f.w.snapshots, []);
  assert.deepEqual(f.w.gone, []);

  const numbered = watcher();
  f.live.watchParty('3', numbered);
  f.socket().fire('party:snapshot', { party: { id: 3 }, queue: [], queueLength: 0 }); // an id is a string
  assert.deepEqual(numbered.snapshots, []);
});

test('after a network cut, the new connection subscribes again to everything still watched', async () => {
  const f = await watching('p1');
  const second = watcher();
  const stopSecond = f.live.watchParty('p2', second);
  f.socket().answer('subscribe', ok);
  const socket = f.socket();

  socket.networkCut();
  stopSecond(); // closed while offline: nothing can be sent, and nothing needs to be
  f.live.watchPlaylist('l1', watcher()); // opened while offline
  await settle();
  assert.deepEqual(f.state.asked, [undefined]); // socket.io reconnects by itself: no new token is asked
  assert.equal(socket.connects, 1);
  assert.equal(socket.messages('subscribe').length, 2);
  assert.deepEqual(socket.messages('unsubscribe'), []);

  socket.accept();
  assert.deepEqual(socket.messages('subscribe').slice(2), [target('party', 'p1'), target('playlist', 'l1')]);
  assert.deepEqual(f.w.gone, []);
});

test('after session:expired the token is renewed, the connection reopened and everything subscribed again', async () => {
  const f = await watching('p1');
  const socket = f.socket();
  socket.fire('session:expired');
  socket.serverClose();
  await settle();
  assert.deepEqual(f.state.asked, [undefined, 'token-1']); // the token the server no longer accepts
  assert.deepEqual(socket.auth, { token: 'token-2', deviceId: 'device-1' });
  assert.equal(socket.connects, 2);
  assert.equal(f.state.sockets.length, 1);

  socket.accept();
  assert.deepEqual(socket.messages('subscribe'), [target('party', 'p1'), target('party', 'p1')]);
  assert.deepEqual(f.w.gone, []);

  // The next expiry renews again: the first one left nothing behind
  socket.answer('subscribe', ok);
  socket.fire('session:expired');
  socket.serverClose();
  await settle();
  assert.deepEqual(f.state.asked, [undefined, 'token-1', 'token-2']);

  // An expiry that was handled is forgotten: a plain close afterwards renews nothing
  socket.accept();
  socket.serverClose();
  await settle();
  assert.deepEqual(f.state.asked, [undefined, 'token-1', 'token-2', undefined]);
});

test('an expiry announced just before the last screen closes is forgotten with that connection', async () => {
  const f = await watching('p1');
  f.socket().fire('session:expired');
  f.stop(); // the connection is closed by the app before the server does it
  f.live.watchParty('p1', watcher());
  await settle();
  f.socket().accept();
  f.socket().serverClose();
  await settle();
  assert.deepEqual(f.state.asked, [undefined, undefined, undefined]);
});

test('a connection the server closes without announcing an expiry is reopened with the same token', async () => {
  const f = await watching('p1');
  f.socket().serverClose();
  await settle();
  assert.deepEqual(f.state.asked, [undefined, undefined]);
  assert.deepEqual(f.socket().auth, { token: 'token-1', deviceId: 'device-1' });
  assert.equal(f.socket().connects, 2);
});

test('a login the server refuses is renewed once; a second refusal in a row ends everything', async () => {
  const f = fixture();
  const w = watcher();
  const second = watcher();
  f.live.watchParty('p1', w);
  f.live.watchPlaylist('l1', second);
  await settle();
  const socket = f.socket();

  socket.refuse(); // the token had expired before the app connected
  await settle();
  assert.deepEqual(f.state.asked, [undefined, 'token-1']);
  assert.deepEqual(socket.auth, { token: 'token-2', deviceId: 'device-1' });
  assert.equal(socket.connects, 2);
  assert.deepEqual(w.gone, []);

  socket.refuse(); // the new token is refused too
  await settle();
  assert.deepEqual(f.state.asked, [undefined, 'token-1']);
  assert.deepEqual(w.gone, ['UNAUTHORIZED']);
  assert.deepEqual(second.gone, ['UNAUTHORIZED']);
  assert.equal(socket.closes, 1);
  assert.equal(socket.listening(), false);

  // A later try starts clean: it gets its one renewal again
  const again = watcher();
  f.live.watchParty('p1', again);
  await settle();
  f.socket().refuse();
  await settle();
  assert.deepEqual(f.state.asked, [undefined, 'token-1', undefined, 'token-2']);
  assert.deepEqual(again.gone, []);
});

test('an accepted connection forgets earlier refusals', async () => {
  const f = fixture();
  const w = watcher();
  f.live.watchParty('p1', w);
  await settle();
  const socket = f.socket();
  socket.refuse();
  await settle();
  socket.accept();
  socket.answer('subscribe', ok);

  socket.networkCut();
  socket.refuse(); // offline for long enough that the token expired
  await settle();
  assert.deepEqual(f.state.asked, [undefined, 'token-1', 'token-2']);
  assert.deepEqual(w.gone, []);
  assert.equal(socket.connects, 3);
});

test('a handshake that fails because of the network is left to socket.io', async () => {
  const f = fixture();
  const w = watcher();
  f.live.watchParty('p1', w);
  await settle();
  const socket = f.socket();
  socket.fire('connect_error', new Error('websocket error')); // `active` stays true: it keeps trying
  socket.fire('connect_error', new Error('websocket error'));
  await settle();
  assert.deepEqual(f.state.asked, [undefined]);
  assert.equal(socket.connects, 1);
  assert.deepEqual(w.gone, []);
});

test('unsubscribed ends that one thing and keeps the rest', async () => {
  const f = await watching('p1');
  const second = watcher();
  f.live.watchParty('p2', second);
  f.socket().answer('subscribe', ok);
  const socket = f.socket();

  socket.fire('unsubscribed', { type: 'party', id: 'p1', code: 'FORBIDDEN' });
  assert.deepEqual(f.w.gone, ['FORBIDDEN']);
  assert.deepEqual(second.gone, []);
  assert.equal(socket.closes, 0);
  socket.fire('party:snapshot', party('p1')); // nothing more reaches the watcher that is gone
  socket.fire('party:snapshot', party('p2'));
  assert.deepEqual(f.w.snapshots, []);
  assert.deepEqual(second.snapshots, [party('p2')]);
  f.stop(); // the screen closes after being told: nothing to unsubscribe
  assert.deepEqual(socket.messages('unsubscribe'), []);

  for (const payload of [null, {}, { type: 'party' }, { type: 'playlist', id: 'p2' }]) socket.fire('unsubscribed', payload);
  assert.deepEqual(second.gone, []);

  socket.fire('unsubscribed', { type: 'party', id: 'p2', code: 'FORBIDDEN' });
  assert.deepEqual(second.gone, ['FORBIDDEN']);
  assert.equal(socket.closes, 1); // nothing is watched any more
});

test('a subscription the server refuses for good ends that thing with the reason', async () => {
  for (const code of ['FORBIDDEN', 'NOT_FOUND', 'BAD_REQUEST', 'TOO_MANY'] as const) {
    const f = await watching('p1');
    const refused = watcher();
    f.live.watchParty('p2', refused);
    f.socket().answer('subscribe', no(code));
    assert.deepEqual(refused.gone, [code]);
    assert.deepEqual(f.w.gone, []);
    assert.equal(f.socket().closes, 0);

    // Watching it again asks the server again
    f.live.watchParty('p2', watcher());
    assert.equal(f.socket().messages('subscribe').length, 3);
  }
});

test('a subscription refused for a passing reason is asked again after a delay', async (t) => {
  for (const ack of [no('RATE_LIMITED'), no('INTERNAL'), no('SOMETHING_NEW'), undefined, {}]) {
    const clock = timers(t);
    const f = await watching('p1');
    const second = watcher();
    f.live.watchParty('p2', second);
    f.socket().answer('subscribe', ack);
    assert.deepEqual(second.gone, []);
    clock.tick(4_999);
    assert.equal(f.socket().messages('subscribe').length, 2);
    clock.tick(1);
    assert.equal(f.socket().messages('subscribe').length, 3);
    f.socket().answer('subscribe', ok);
    clock.tick(60_000);
    assert.equal(f.socket().messages('subscribe').length, 3); // answered: nothing more is asked
    clock.reset();
  }
});

test('a pending retry is dropped when the screen closes or the connection ends first', async (t) => {
  const clock = timers(t);
  const f = await watching('p1');
  const stopSecond = f.live.watchParty('p2', watcher());
  f.socket().answer('subscribe', no('RATE_LIMITED'));
  stopSecond();
  clock.tick(5_000);
  assert.equal(f.socket().messages('subscribe').length, 2);

  f.live.watchParty('p3', watcher());
  f.socket().answer('subscribe', no('INTERNAL'));
  f.socket().networkCut();
  clock.tick(5_000);
  assert.equal(f.socket().messages('subscribe').length, 3); // nothing is sent on a dead connection
  f.socket().accept();
  assert.equal(f.socket().messages('subscribe').length, 5); // p1 and p3, once each
  clock.tick(5_000);
  assert.equal(f.socket().messages('subscribe').length, 5);
});

test('UNAUTHORIZED on a subscription waits for the server to close, then renews and asks again', async (t) => {
  const clock = timers(t);
  const f = await watching('p1');
  const second = watcher();
  f.live.watchParty('p2', second);
  const socket = f.socket();
  socket.fire('session:expired'); // the server announces it, answers the message, then closes
  socket.answer('subscribe', no('UNAUTHORIZED'));
  assert.deepEqual(second.gone, []);
  assert.deepEqual(f.state.asked, [undefined]);

  socket.serverClose();
  await settle();
  assert.deepEqual(f.state.asked, [undefined, 'token-1']);
  socket.accept();
  assert.deepEqual(socket.messages('subscribe').slice(2), [target('party', 'p1'), target('party', 'p2')]);
  clock.tick(60_000); // the retry planned on the closed connection never runs
  assert.equal(socket.messages('subscribe').length, 4);
  assert.deepEqual(second.gone, []);
});

test('connection:refused ends everything and does not reconnect', async () => {
  const f = fixture();
  const w = watcher();
  const second = watcher();
  f.live.watchParty('p1', w);
  f.live.watchPlaylist('l1', second);
  await settle();
  const socket = f.socket();
  socket.accept();
  socket.fire('connection:refused', { code: 'TOO_MANY_CONNECTIONS' });
  socket.serverClose();
  await settle();
  assert.deepEqual(w.gone, ['TOO_MANY_CONNECTIONS']);
  assert.deepEqual(second.gone, ['TOO_MANY_CONNECTIONS']);
  assert.equal(socket.connects, 1);
  assert.deepEqual(f.state.asked, [undefined]);
  assert.equal(socket.listening(), false);

  // A later try starts clean: one of the other devices may have closed the app
  const again = watcher();
  f.live.watchParty('p1', again);
  await settle();
  f.socket().accept();
  f.socket().serverClose();
  await settle();
  assert.deepEqual(again.gone, []);
  assert.equal(f.socket().connects, 2);
});

test('the end of the login ends everything; the same user updating their profile changes nothing', async () => {
  const f = await watching('p1');
  const socket = f.socket();
  f.setUser({ id: 'user-a' }); // a profile update notifies with the same user
  assert.deepEqual(f.w.gone, []);
  assert.equal(socket.closes, 0);

  f.setUser(null);
  assert.deepEqual(f.w.gone, ['SIGNED_OUT']);
  assert.equal(socket.closes, 1);
  assert.equal(socket.listening(), false);
  f.stop();
  assert.deepEqual(socket.messages('unsubscribe'), []);

  // Another account on the same phone is another login too
  f.setUser({ id: 'user-a' });
  const w = watcher();
  f.live.watchParty('p1', w);
  await settle();
  f.setUser({ id: 'user-b' });
  assert.deepEqual(w.gone, ['SIGNED_OUT']);

  // Nothing the previous login received is shown to the next one
  const first = await watching('p1');
  first.socket().fire('party:snapshot', party('p1', 'seen by user-a'));
  first.setUser(null);
  first.setUser({ id: 'user-b' });
  const fresh = watcher();
  first.live.watchParty('p1', fresh);
  await settle();
  assert.deepEqual(fresh.snapshots, []);
  first.socket().accept();
  first.socket().fire('party:snapshot', party('p1', 'seen by user-b'));
  assert.deepEqual(fresh.snapshots, [party('p1', 'seen by user-b')]);
  assert.equal(first.w.snapshots.length, 1); // the watcher of the previous login gets nothing more

  // ...and from then on, that account is the one whose profile updates change nothing
  const b = watcher();
  f.live.watchParty('p1', b);
  await settle();
  f.setUser({ id: 'user-b' });
  assert.deepEqual(b.gone, []);
});

test('watching without a login ends at once', async (t) => {
  const clock = timers(t);
  const f = fixture();
  f.setUser(null);
  f.state.failure = new Error('not logged in');
  const w = watcher();
  f.live.watchParty('p1', w);
  await settle();
  assert.deepEqual(w.gone, ['SIGNED_OUT']);
  clock.tick(60_000);
  await settle();
  assert.deepEqual(f.state.asked, [undefined]); // and it is not tried again
  assert.equal(f.state.sockets.length, 0);
});

test('no token because the login is over ends everything', async () => {
  const f = await watching('p1');
  const socket = f.socket();
  f.state.failure = new Error('refresh refused');
  socket.fire('session:expired');
  socket.serverClose();
  // What the API client does when a renewal fails: it closes the session, then rejects
  f.state.hold = Promise.resolve().then(() => { f.setUser(null); });
  await settle();
  assert.deepEqual(f.w.gone, ['SIGNED_OUT']);
  assert.equal(socket.closes, 1);
});

test('no token for a passing reason, while still logged in, is tried again after a delay', async (t) => {
  const clock = timers(t);
  const f = fixture();
  const w = watcher();
  f.state.failure = new Error('device registration failed');
  f.live.watchParty('p1', w);
  await settle();
  assert.equal(f.state.sockets.length, 0);
  assert.deepEqual(w.gone, []);

  clock.tick(4_999);
  await settle();
  assert.deepEqual(f.state.asked, [undefined]);
  f.state.failure = null;
  clock.tick(1);
  await settle();
  assert.deepEqual(f.state.asked, [undefined, undefined]);
  assert.equal(f.socket().connects, 1);
  assert.deepEqual(w.gone, []);
});

test('closing every screen while the token is being prepared opens no connection', async (t) => {
  const clock = timers(t);
  let release!: () => void;
  const f = fixture();
  f.state.hold = new Promise<void>((resolve) => { release = resolve; });
  const stop = f.live.watchParty('p1', watcher());
  const stopSecond = f.live.watchParty('p2', watcher()); // no second preparation is started meanwhile
  await settle();
  stop();
  stopSecond();
  release();
  await settle();
  assert.deepEqual(f.state.asked, [undefined]);
  assert.equal(f.state.sockets.length, 0);

  // The same when the preparation fails: nothing to retry for nobody
  f.state.failure = new Error('network');
  f.live.watchParty('p3', watcher())();
  await settle();
  clock.tick(60_000);
  await settle();
  assert.equal(f.state.asked.length, 2);
  assert.equal(f.state.sockets.length, 0);

  // A retry already planned is dropped when the last screen closes before it runs
  const stopFourth = f.live.watchParty('p4', watcher());
  await settle();
  assert.equal(f.state.asked.length, 3);
  stopFourth();
  clock.tick(60_000);
  await settle();
  assert.equal(f.state.asked.length, 3);
});

test('resume asks again for everything, and restarts a connection that stays silent', async () => {
  const f = await watching('p1');
  f.live.watchPlaylist('l1', watcher());
  const socket = f.socket();
  assert.equal(socket.messages('subscribe').length, 2);

  f.live.resume();
  assert.deepEqual(socket.messages('subscribe').slice(2), [target('party', 'p1'), target('playlist', 'l1')]);
  socket.answer('subscribe', ok);
  socket.answer('subscribe', ok);
  socket.answer('subscribe', ok);
  assert.equal(socket.closes, 0);

  // Dead in the background: the server never answers
  f.live.resume();
  assert.equal(socket.messages('subscribe').length, 6);
  socket.answer('subscribe', undefined, new Error('operation has timed out'));
  assert.equal(socket.closes, 1);
  assert.equal(socket.connects, 2);
  socket.answer('subscribe', undefined, new Error('operation has timed out')); // the other one times out too: one restart is enough
  assert.equal(socket.closes, 1);
  assert.equal(socket.connects, 2);
  assert.deepEqual(f.w.gone, []);

  socket.accept();
  assert.deepEqual(socket.messages('subscribe').slice(6), [target('party', 'p1'), target('playlist', 'l1')]);
});

test('resume does nothing when nothing is watched or the connection is already coming back', async () => {
  const f = fixture();
  f.live.resume();
  await settle();
  assert.deepEqual(f.state.asked, []);

  f.live.watchParty('p1', watcher());
  await settle();
  const socket = f.socket();
  f.live.resume(); // still connecting
  socket.accept();
  socket.networkCut();
  f.live.resume(); // socket.io is reconnecting
  await settle();
  assert.equal(socket.messages('subscribe').length, 1);
  assert.equal(socket.connects, 1);
  assert.equal(f.state.sockets.length, 1);
});

test('resume opens the connection again when a preparation had failed', async (t) => {
  const clock = timers(t);
  const f = fixture();
  f.state.failure = new Error('network');
  f.live.watchParty('p1', watcher());
  await settle();
  f.state.failure = null;
  f.live.resume(); // back to the front before the retry delay is over
  await settle();
  assert.equal(f.socket().connects, 1);
  clock.tick(5_000);
  await settle();
  assert.equal(f.state.sockets.length, 1);
});

test('an answer that arrives after its connection ended, or after its screen closed, changes nothing', async () => {
  const f = fixture();
  const w = watcher();
  const stop = f.live.watchParty('p1', w);
  await settle();
  const socket = f.socket();
  socket.accept();
  const [first] = socket.sent;
  socket.networkCut();
  socket.accept();
  first.answer?.(null, no('FORBIDDEN')); // the answer of the connection that was cut
  assert.deepEqual(w.gone, []);
  first.answer?.(new Error('operation has timed out'));
  assert.equal(socket.closes, 0);

  const second = watcher();
  const stopSecond = f.live.watchParty('p2', second);
  const pending = socket.sent[socket.sent.length - 1];
  stopSecond();
  const again = watcher();
  f.live.watchParty('p2', again); // the same party, opened again before the first answer came back
  pending.answer?.(null, no('NOT_FOUND'));
  assert.deepEqual(second.gone, []);
  assert.deepEqual(again.gone, []);
  socket.fire('party:snapshot', party('p2'));
  assert.deepEqual(again.snapshots, [party('p2')]);
  stop();
});

test('destroy ends everything and stops following the login', async () => {
  const f = await watching('p1');
  assert.equal(f.listeners.size, 1);
  f.live.destroy();
  assert.deepEqual(f.w.gone, ['SIGNED_OUT']);
  assert.equal(f.socket().closes, 1);
  assert.equal(f.listeners.size, 0);
});

test('a watcher that stops or watches again while being called does not disturb the others', async () => {
  const f = await watching('p1');
  const order: string[] = [];
  let stopInner = () => {};
  const inner = { onSnapshot: () => { order.push('inner'); stopInner(); }, onGone: () => { order.push('inner gone'); } };
  stopInner = f.live.watchParty('p1', inner);
  const last = watcher();
  f.live.watchParty('p1', last);
  f.socket().fire('party:snapshot', party('p1'));
  assert.deepEqual(order, ['inner']);
  assert.equal(last.snapshots.length, 1);
  assert.equal(f.w.snapshots.length, 1);

  // Told it is gone, a screen may watch something else right away
  const next = watcher();
  const replacing = { onSnapshot: () => {}, onGone: () => { f.live.watchParty('p9', next); } };
  f.live.watchParty('p5', replacing);
  f.socket().answer('subscribe', no('NOT_FOUND'));
  assert.deepEqual(f.socket().messages('subscribe').slice(-1), [target('party', 'p9')]);
  assert.equal(f.socket().closes, 0);
});
