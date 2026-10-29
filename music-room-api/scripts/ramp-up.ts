import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { validateEnvironment } from '../src/config/environment';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SessionsService } from '../src/auth/sessions.service';
import { io, Socket } from 'socket.io-client';

// The script runs in the backend container, next to the server
const SERVER = `http://localhost:${process.env.PORT ?? 3000}`;
// Every test user has an email at this domain, and the room's song this id: what the cleanup finds them by
const DOMAIN = 'ramp-up.test';
const SONG_ID = 'ramp-up-song';
const VOTES = 10; // one per second, each by another watcher: the song's count goes 1, 2... 10
const LATE_MS = 5000; // an update still missing this long after the last vote counts as missed
const ANSWER_MS = 10_000; // how long the app waits for the server to accept a subscription (ACK_TIMEOUT_MS in its live.ts)

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
// action logs, then the users (their sessions go with them), then the song
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

// A public room made through the real route, with one song written straight into its queue (no Deezer call)
async function createRoom(prisma: PrismaService, owner: TestUser) {
  const response = await fetch(`${SERVER}/parties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` },
    body: JSON.stringify({ name: 'Ramp-up' }),
  });
  if (response.status !== 201) throw new Error(`Creating the room failed: ${response.status}`);
  const { id, partyPlaylistId } = await response.json() as { id: string; partyPlaylistId: string };
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

async function main() {
  const count = Number(process.argv[2]);
  const group = Number(process.argv[3] ?? 100); // how many open the room at the same moment
  if (!Number.isInteger(count) || count < VOTES || !Number.isInteger(group) || group < 1) {
    throw new Error(`Usage: npx ts-node scripts/ramp-up.ts <watchers, ${VOTES} or more> [how many connect at once, 100 if absent]`);
  }
  const app = await NestFactory.createApplicationContext(RampUpModule, { logger: false });
  const prisma = app.get(PrismaService);
  let watchers: Watcher[] = [];
  let stopping = false;
  process.once('SIGINT', () => { stopping = true; }); // Ctrl+C: no more votes, then the usual end
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
