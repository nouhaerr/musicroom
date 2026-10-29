import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { validateEnvironment } from '../src/config/environment';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SessionsService } from '../src/auth/sessions.service';
import { io, Socket } from 'socket.io-client';

// The script runs in the backend container, next to the server
const PORT = process.env.PORT ?? 3000;
const SERVER = `http://localhost:${PORT}`;
// Every test user has an email at this domain, and the room's song this id: what the cleanup finds them by
const DOMAIN = 'ramp-up.test';
const SONG_ID = 'ramp-up-song';
const VOTES = 10; // one per second, each by another watcher: the song's count goes 1, 2... 10
const LATE_MS = 5000; // an update still missing this long after the last vote counts as missed
const ANSWER_MS = 10_000; // how long the app waits for the server to accept a subscription (ACK_TIMEOUT_MS in its live.ts)
const PAGE = 20; // rooms or playlists on one page of the app's lists: each list is measured full
// ab (Apache Bench) in its own container, on the network of the compose services: 2000 requests, 10 at a time.
// -l: a list that changes during the run (someone makes a room) is not an error
const AB = 'docker run --rm --network music-room-api_default httpd:2.4.69-alpine ab -n 2000 -c 10 -l';

// Only what the test users need: the settings, the database and the session code that login uses
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: process.env.CONFIG_IGNORE_ENV_FILE === 'true', validate: validateEnvironment }),
    PrismaModule,
    JwtModule.register({}),
  ],
  providers: [SessionsService],
})
class RampUpModule {}

type TestUser = { id: string; token: string };

// Deletes what a run leaves: the room's queue first (the room, its songs and votes go with it), then the users'
// action logs, then the users (their sessions and playlists go with them), then the song
async function cleanUp(prisma: PrismaService) {
  const ids = (await prisma.user.findMany({ where: { email: { endsWith: `@${DOMAIN}` } }, select: { id: true } })).map(user => user.id);
  await prisma.partyPlaylist.deleteMany({ where: { party: { ownerId: { in: ids } } } });
  await prisma.actionLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.song.deleteMany({ where: { externalId: SONG_ID } });
}

// `count` verified users without a password (nobody can log into them), each with a token from the login code
async function createUsers(prisma: PrismaService, sessions: SessionsService, count: number): Promise<TestUser[]> {
  const users = await prisma.user.createManyAndReturn({
    data: Array.from({ length: count }, (_, n) => ({ email: `ramp-up-${n + 1}@${DOMAIN}`, name: `Ramp-up ${n + 1}`, emailVerifiedAt: new Date() })),
    select: { id: true },
  });
  const testUsers: TestUser[] = [];
  for (const user of users) testUsers.push({ id: user.id, token: (await sessions.create(user.id)).accessToken });
  return testUsers;
}

// A room or a playlist made through the real route, as the app makes it: both are public unless asked otherwise
async function createPublic<T>(owner: TestUser, path: '/parties' | '/playlists', name: string): Promise<T> {
  const response = await fetch(`${SERVER}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` },
    body: JSON.stringify({ name }),
  });
  if (response.status !== 201) throw new Error(`Creating ${name} failed: ${response.status}`);
  return await response.json() as T;
}

// A public room with one song written straight into its queue (no Deezer call)
async function createRoom(prisma: PrismaService, owner: TestUser) {
  const { id, partyPlaylistId } = await createPublic<{ id: string; partyPlaylistId: string }>(owner, '/parties', 'Ramp-up');
  const song = await prisma.song.create({ data: { externalId: SONG_ID, title: 'Ramp-up', artist: 'Test', durationSec: 200, sourceUri: 'https://www.deezer.com' } });
  const entry = await prisma.partySong.create({ data: { partyPlaylistId, songId: song.id } });
  return { id, entryId: entry.id };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// One watcher: its own live connection, watching the room, and when it first saw the song reach each vote count
type Watcher = { socket: Socket; seen: Map<number, number> };

// Connects like the app's room page and watches the room; done once the server accepted the subscription
async function watch(user: TestUser, roomId: string, entryId: string): Promise<Watcher> {
  const socket = io(SERVER, { transports: ['websocket'], reconnection: false, forceNew: true, auth: { token: user.token } });
  const seen = new Map<number, number>();
  // A count of 5 also means 1 to 4 were reached: when two votes arrive in one update, both are seen at once
  socket.on('party:snapshot', (snapshot: { queue: { id: string; _count: { votes: number } }[] }) => {
    const votes = snapshot.queue.find(entry => entry.id === entryId)?._count.votes ?? 0;
    for (let count = 0; count <= votes; count++) if (!seen.has(count)) seen.set(count, Date.now());
  });
  try {
    await new Promise<void>((resolve, reject) => { socket.once('connect', () => resolve()); socket.once('connect_error', reject); });
    const ack = await socket.timeout(ANSWER_MS).emitWithAck('subscribe', { type: 'party', id: roomId });
    if (!ack.ok) throw new Error(ack.error.code);
    return { socket, seen };
  } catch (error) {
    socket.close();
    throw error;
  }
}

// One vote for the room's song, as the app sends it
async function vote(user: TestUser, roomId: string, entryId: string) {
  const response = await fetch(`${SERVER}/parties/${roomId}/songs/${entryId}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
    body: '{}',
  });
  if (response.status !== 201) throw new Error(`Voting failed: ${response.status}`);
}

// The time below which `share` of the sorted times are (0.5: the median, 0.95: the p95)
const percentile = (sorted: number[], share: number) => sorted[Math.ceil(share * sorted.length) - 1];

// The `http` run: full lists and a viewer's token for ab, which measures the requests the app sends when a page opens.
// It waits until Ctrl+C, then deletes everything.
async function pageLoads() {
  // Ctrl+C reaches the script twice through npx (from the terminal, then passed on). In a terminal without a real
  // console (some Git Bash windows), it closes only the docker command: the script then sees its input end.
  const done = new Promise<void>(resolve => {
    process.on('SIGINT', () => resolve());
    process.stdin.on('end', () => resolve()).resume();
  });
  const app = await NestFactory.createApplicationContext(RampUpModule, { logger: false });
  const prisma = app.get(PrismaService);
  const config = app.get(ConfigService);
  try {
    // ab sends thousands of requests a minute to one route from one IP: under a lower limit, most would get 429
    if (config.getOrThrow<number>('THROTTLE_LIMIT') < 1_000_000) {
      throw new Error('Set THROTTLE_LIMIT=1000000 in .env, then run: docker compose up -d backend (a restart does not read .env again)');
    }
    await cleanUp(prisma);
    const [owner, viewer] = await createUsers(prisma, app.get(SessionsService), 2);
    // The newest come first in the lists: their first page is exactly these, whatever else is in the database
    const rooms: string[] = [];
    const playlists: string[] = [];
    for (let n = 1; n <= PAGE; n++) {
      rooms.push((await createPublic<{ id: string }>(owner, '/parties', `Ramp-up ${n}`)).id);
      playlists.push((await createPublic<{ id: string }>(owner, '/playlists', `Ramp-up ${n}`)).id);
    }
    // What the app asks when Discover, a room, the Playlists tab and a playlist open (the rest comes live)
    const paths = [
      `/parties?page=1&limit=${PAGE}&visibility=PUBLIC`,
      `/parties/${rooms[0]}/votes/mine?page=1&limit=100`,
      `/playlists?page=1&limit=${PAGE}&visibility=PUBLIC`,
      `/playlists/${playlists[0]}`,
    ];
    console.log(`Ready: ${PAGE} public rooms and ${PAGE} public playlists. In another terminal, paste one of these (then try -c 50, 100, 200...):`);
    for (const path of paths) console.log(`\n${AB} -H "Authorization: Bearer ${viewer.token}" "http://backend:${PORT}${path}"`);
    console.log(`\nThe token works for ${config.get('JWT_ACCESS_EXPIRES_IN', '15m')}. Press Ctrl+C here when you are done: the test data is deleted.`);
    await done;
    console.log('Deleting the test data');
  } finally {
    process.stdin.destroy();
    await cleanUp(prisma);
    await app.close();
  }
}

async function main() {
  if (process.argv[2] === 'http') return pageLoads();
  const count = Number(process.argv[2]);
  const group = Number(process.argv[3] ?? 100); // how many open the room at the same moment
  if (!Number.isInteger(count) || count < VOTES || !Number.isInteger(group) || group < 1) {
    throw new Error(`Usage: npx ts-node scripts/ramp-up.ts <watchers, ${VOTES} or more> [how many connect at once, 100 if absent]\n`
      + '   or: npx ts-node scripts/ramp-up.ts http');
  }
  const app = await NestFactory.createApplicationContext(RampUpModule, { logger: false });
  const prisma = app.get(PrismaService);
  let watchers: Watcher[] = [];
  let stopping = false;
  // Ctrl+C: no more votes, then the usual end. `on`, not `once`: through npx, one Ctrl+C arrives twice
  process.on('SIGINT', () => { stopping = true; });
  try {
    await cleanUp(prisma);
    const [owner, ...users] = await createUsers(prisma, app.get(SessionsService), count + 1);
    const room = await createRoom(prisma, owner);

    let started = Date.now();
    // `group` watchers connect at the same moment; the next group starts once all of these are in, or failed
    const results: PromiseSettledResult<Watcher>[] = [];
    for (let first = 0; first < users.length && !stopping; first += group) {
      results.push(...await Promise.allSettled(users.slice(first, first + group).map(user => watch(user, room.id, room.entryId))));
    }
    watchers = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    const reasons = results.flatMap(result => result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : []);
    console.log(`${count} watchers, ${group} at once: connected and watching in ${Date.now() - started} ms, `
      + `${count - watchers.length} failed${reasons.length ? ` (${[...new Set(reasons)].join(', ')})` : ''}`);

    // The newcomers' first updates make the server wait 200 ms before the next one: let that pass first
    await sleep(1000);
    // When vote n was sent: from then on, the song's count is n
    const sentAt = new Map<number, number>();
    for (let n = 1; n <= VOTES && !stopping; n++) {
      sentAt.set(n, Date.now());
      await vote(users[n - 1], room.id, room.entryId);
      await sleep(1000);
    }
    if (sentAt.size === 0) return;
    // The late updates: until every watcher saw the last vote, LATE_MS at most
    started = Date.now();
    while (watchers.some(watcher => !watcher.seen.has(sentAt.size)) && Date.now() - started < LATE_MS) await sleep(100);

    const times = watchers.flatMap(watcher => [...sentAt].flatMap(([n, sent]) => {
      const at = watcher.seen.get(n);
      return at === undefined ? [] : [at - sent];
    })).sort((a, b) => a - b);
    const expected = count * sentAt.size; // a watcher that failed to connect missed every update
    const missed = expected - times.length;
    console.log(`${sentAt.size} votes: ${times.length} of ${expected} updates received, ${missed} missed (${(100 * missed / expected).toFixed(2)}%)`);
    if (times.length) console.log(`vote to screen: median ${percentile(times, 0.5)} ms, p95 ${percentile(times, 0.95)} ms, max ${times[times.length - 1]} ms`);
  } finally {
    for (const watcher of watchers) watcher.socket.close();
    await cleanUp(prisma);
    await app.close();
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
