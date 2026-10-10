import { HttpException, Logger, UnauthorizedException } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Server, Socket } from 'socket.io';
import { Platform } from '../../generated/prisma';
import { SessionsService } from '../auth/sessions.service';
import { PartiesService } from '../parties/parties.service';
import { PlaylistsService } from '../playlists/playlists.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscribeDto } from './dto/subscribe.dto';
import { RealtimeService } from './realtime.service';

const MAX_MESSAGE_BYTES = 16 * 1024; // clients only ever send small messages
const MAX_TIMER_MS = 2 ** 31 - 1; // the longest delay setTimeout accepts
const MAX_SUBSCRIPTIONS = 20; // how many parties and playlists one connection may watch at the same time
const MAX_CONNECTIONS_PER_USER = 5; // a phone, a tablet, and room for a reconnection that overlaps the old connection
const MESSAGE_WINDOW_MS = 10_000;
const MAX_MESSAGES_PER_WINDOW = 30; // per connection: an app sends a few messages when a screen opens or closes
const SNAPSHOT_INTERVAL_MS = 200; // at most 5 snapshots per second per room: changes in between are merged
const RETRY_DELAY_MS = 1000; // after a failed read (e.g. database busy), try again this much later

// The full state of a party or of a playlist, as sent to its watchers
type Snapshot = Awaited<ReturnType<PartiesService['snapshot']>> | Awaited<ReturnType<PlaylistsService['snapshot']>>;

// What is waiting to be sent to one room
interface Pending {
  target: SubscribeDto;
  everyone: boolean; // something changed: everyone in the room gets the new snapshot
  newcomers: Set<string>; // sockets that just subscribed: only they get the current snapshot
}

// What the server knows about a connected client, set once during the handshake
export interface SocketData {
  userId: string;
  sessionId: string;
  tokenExpiresAt: number;
  device: { id: string; platform: Platform; appVersion: string } | null; // the one the app registered, for the action log
}
export type AuthedSocket = Socket<any, any, any, SocketData>;

// Every client message is answered through its acknowledgement with one of these.
// (Never add a key named `event` here: Nest would send the object as an event instead.)
export type Ack =
  | { ok: true }
  | { ok: false; error: { code: AckErrorCode; message: string } };
type AckErrorCode = 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'TOO_MANY' | 'RATE_LIMITED' | 'INTERNAL';

const refuse = (code: AckErrorCode, message: string): Ack => ({ ok: false, error: { code, message } });
const EXPECTED_PAYLOAD = 'Expected { type: "party" | "playlist", id: "<uuid>" }';

// The Socket.io room that gathers everyone watching one resource
export const roomOf = (target: SubscribeDto) => `${target.type}:${target.id}`;

@WebSocketGateway({ cors: { origin: '*' }, maxHttpBufferSize: MAX_MESSAGE_BYTES })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  // One entry per room that has snapshots being sent; removed as soon as there is nothing left
  private readonly pending = new Map<string, Pending>();

  // How many connections each user has open; an entry is removed with the user's last connection
  private readonly connections = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly parties: PartiesService,
    private readonly playlists: PlaylistsService,
    private readonly realtime: RealtimeService,
  ) {}

  // Runs before a connection is accepted: a client without a valid login never connects
  afterInit(server: Server) {
    this.realtime.listen((target) => this.requestSnapshot(target));
    server.use(async (socket: AuthedSocket, next) => {
      try {
        const token = extractToken(socket);
        if (!token) throw new UnauthorizedException();
        const { user, sessionId, expiresAt } = await this.sessions.verifyAccessToken(token);
        socket.data.userId = user.id;
        socket.data.sessionId = sessionId;
        socket.data.tokenExpiresAt = expiresAt.getTime();
        socket.data.device = await this.deviceOf(socket, user.id);
        next();
      } catch (err) {
        // Anything other than a refused login is a server problem (e.g. the database is down)
        if (!(err instanceof UnauthorizedException)) {
          this.logger.error(`Handshake failed: ${(err as Error).message}`);
        }
        next(new Error('Unauthorized'));
      }
    });
  }

  // A connection is only valid as long as its access token: tell the client and close it at
  // that exact moment. Reconnecting is the client's job: it gets a fresh token (POST
  // /auth/refresh) and opens a new connection, which goes through the same check again.
  handleConnection(socket: AuthedSocket) {
    if (!this.countConnection(socket)) return;
    this.limitMessages(socket);
    this.logAction(socket, 'connect');

    const delay = Math.min(Math.max(socket.data.tokenExpiresAt - Date.now(), 0), MAX_TIMER_MS);
    const timer = setTimeout(() => {
      socket.emit('session:expired');
      socket.disconnect(true);
    }, delay);
    timer.unref();
    socket.on('disconnect', () => clearTimeout(timer));
  }

  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() socket: AuthedSocket, @MessageBody() payload: unknown): Promise<Ack> {
    const target = parse(payload);
    const ack = target ? await this.join(socket, target) : refuse('BAD_REQUEST', EXPECTED_PAYLOAD);
    this.logAction(socket, target ? `subscribe ${target.type}` : 'subscribe', ack);
    return ack;
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(@ConnectedSocket() socket: AuthedSocket, @MessageBody() payload: unknown): Promise<Ack> {
    const target = parse(payload);
    const ack = target ? await this.leave(socket, target) : refuse('BAD_REQUEST', EXPECTED_PAYLOAD);
    this.logAction(socket, target ? `unsubscribe ${target.type}` : 'unsubscribe', ack);
    return ack;
  }

  private async join(socket: AuthedSocket, target: SubscribeDto): Promise<Ack> {
    if (!(await this.stillLoggedIn(socket))) return refuse('UNAUTHORIZED', 'Session expired or revoked');

    try {
      await this.assertCanView(target, socket.data.userId);
    } catch (err) {
      return this.refusal(err);
    }

    // From here to the join there is no `await`: no other message from this client can run
    // in between, so several subscriptions arriving together cannot exceed the limit
    const room = roomOf(target);
    if (!socket.rooms.has(room) && subscriptionCount(socket) >= MAX_SUBSCRIPTIONS) {
      return refuse('TOO_MANY', `At most ${MAX_SUBSCRIPTIONS} subscriptions per connection`);
    }
    await socket.join(room);
    this.requestSnapshot(target, socket.id);
    return { ok: true };
  }

  private async leave(socket: AuthedSocket, target: SubscribeDto): Promise<Ack> {
    await socket.leave(roomOf(target));
    return { ok: true };
  }

  // One more connection for this user, until it closes. Over the limit, the connection is told
  // why and closed. Counting here, where nothing is awaited, keeps simultaneous connections
  // from slipping past the limit together.
  private countConnection(socket: AuthedSocket): boolean {
    const { userId } = socket.data;
    const open = (this.connections.get(userId) ?? 0) + 1;
    this.connections.set(userId, open);
    socket.on('disconnect', () => {
      const left = (this.connections.get(userId) ?? 1) - 1;
      if (left > 0) this.connections.set(userId, left);
      else this.connections.delete(userId);
    });
    if (open <= MAX_CONNECTIONS_PER_USER) return true;
    socket.emit('connection:refused', { code: 'TOO_MANY_CONNECTIONS' });
    socket.disconnect(true);
    return false;
  }

  // The global rate limit of the HTTP routes does not see socket messages: each connection gets
  // its own. A message over the limit is answered right here, before any handler runs, so it
  // costs no database query.
  private limitMessages(socket: AuthedSocket) {
    let windowStart = Date.now();
    let messages = 0;
    socket.use((packet, next) => {
      const now = Date.now();
      if (now - windowStart >= MESSAGE_WINDOW_MS) {
        windowStart = now;
        messages = 0;
      }
      messages += 1;
      if (messages <= MAX_MESSAGES_PER_WINDOW) return next();
      const answer: unknown = packet[packet.length - 1];
      const refusal = refuse('RATE_LIMITED', `At most ${MAX_MESSAGES_PER_WINDOW} messages every ${MESSAGE_WINDOW_MS / 1000} seconds`);
      if (typeof answer === 'function') answer(refusal);
      // Logged once per window: logging every refused message would turn a flood into database writes
      if (messages === MAX_MESSAGES_PER_WINDOW + 1) this.logAction(socket, 'message', refusal);
    });
  }

  // The device the app registered (POST /devices) and names in the handshake, if it is this user's
  private async deviceOf(socket: Socket, userId: string): Promise<SocketData['device']> {
    const id = extractDeviceId(socket);
    if (!id) return null;
    return this.prisma.device.findFirst({ where: { id, userId }, select: { id: true, platform: true, appVersion: true } });
  }

  // Every action of the app is logged with its device, like the HTTP routes are (subject V.6).
  // Not awaited, and a logging problem never breaks the action itself.
  private logAction(socket: AuthedSocket, action: string, ack?: Ack) {
    const { userId, device } = socket.data;
    const data = {
      userId,
      action: `WS ${action}`,
      platform: device?.platform,
      appVersion: device?.appVersion,
      metadata: ack && !ack.ok ? { error: ack.error.code } : undefined,
    };
    this.prisma.actionLog
      .create({ data: { ...data, deviceId: device?.id } })
      // The device may have been deleted since the connection opened: keep the log, without the link
      .catch(() => this.prisma.actionLog.create({ data }))
      .catch((err: Error) => this.logger.error(`Action log failed: ${err.message}`));
  }

  // The same rule as the REST route: whoever may GET the resource may watch it
  private async assertCanView(target: SubscribeDto, userId: string): Promise<void> {
    if (target.type === 'party') await this.parties.getDetail(target.id, userId);
    else await this.playlists.getDetail(target.id, userId);
  }

  // Takes a snapshot: the full state of what a room watches, as it is in the database right now
  private takeSnapshot(target: SubscribeDto): Promise<Snapshot> {
    return target.type === 'party' ? this.parties.snapshot(target.id) : this.playlists.snapshot(target.id);
  }

  // Which of these users may still see what the snapshot shows (it holds the party or the playlist itself)
  private viewers(snapshot: Snapshot, userIds: string[]): Promise<Set<string>> {
    return 'party' in snapshot ? this.parties.viewers(snapshot.party, userIds) : this.playlists.viewers(snapshot.playlist, userIds);
  }

  // The connections currently in a room: all of them, or only those among `ids`
  private socketsIn(room: string, ids?: Set<string>): AuthedSocket[] {
    const members = this.server.sockets.adapter.rooms.get(room) ?? new Set<string>();
    const wanted = ids ? [...ids].filter((id) => members.has(id)) : [...members];
    return wanted.map((id) => this.server.sockets.sockets.get(id)).filter((socket) => socket !== undefined);
  }

  // A logout or a revoked invitation must also take effect on a connection that is already
  // subscribed: right before a snapshot goes out, everyone about to receive it is checked again,
  // with two queries whatever their number. Whoever fails is out of the room before the send.
  private async removeUnauthorized(target: SubscribeDto, snapshot: Snapshot, sockets: AuthedSocket[]) {
    if (sockets.length === 0) return;
    const [loggedIn, viewers] = await Promise.all([
      this.sessions.validSessionIds(sockets.map((socket) => socket.data.sessionId)),
      this.viewers(snapshot, sockets.map((socket) => socket.data.userId)),
    ]);
    for (const socket of sockets) {
      if (!loggedIn.has(socket.data.sessionId)) {
        socket.emit('session:expired');
        socket.disconnect(true); // closing it also takes it out of every room
      } else if (!viewers.has(socket.data.userId)) {
        await socket.leave(roomOf(target));
        socket.emit('unsubscribed', { type: target.type, id: target.id, code: 'FORBIDDEN' });
      }
    }
  }

  // Asks for a snapshot of `target`: for the whole room (something changed), or only for one
  // socket that just subscribed. If snapshots are already being sent to that room, the request
  // is merged into the next one instead of starting a second sender.
  private requestSnapshot(target: SubscribeDto, newcomerId?: string) {
    const room = roomOf(target);
    let pending = this.pending.get(room);
    const idle = !pending;
    if (!pending) {
      pending = { target, everyone: false, newcomers: new Set() };
      this.pending.set(room, pending);
    }
    if (newcomerId) pending.newcomers.add(newcomerId);
    else pending.everyone = true;
    if (idle) void this.sendSnapshots(room, pending);
  }

  // The only sender of a room: one read and send at a time, so snapshots go out in the order
  // they were read and a client never gets an older state after a newer one. Each read starts
  // after the change that asked for it was committed, so the last snapshot is always current.
  private async sendSnapshots(room: string, pending: Pending) {
    while (pending.everyone || pending.newcomers.size > 0) {
      const { everyone, newcomers } = pending;
      pending.everyone = false;
      pending.newcomers = new Set();
      let delay = SNAPSHOT_INTERVAL_MS;
      try {
        if (!this.server.sockets.adapter.rooms.get(room)?.size) continue; // nobody watching: no read
        const snapshot = await this.takeSnapshot(pending.target);
        const event = `${pending.target.type}:snapshot`;
        // The snapshot is read first, the receivers are checked after: whoever lost access
        // before this state existed is found out here and never sees it
        const receivers = this.socketsIn(room, everyone ? undefined : newcomers);
        await this.removeUnauthorized(pending.target, snapshot, receivers);
        if (everyone) {
          this.server.to(room).emit(event, snapshot);
        } else {
          for (const socket of receivers) {
            if (socket.rooms.has(room)) socket.emit(event, snapshot); // still subscribed
          }
        }
      } catch (err) {
        this.logger.error(`Snapshot of ${room} failed: ${(err as Error).message}`);
        // Nothing was sent: ask again, together with whatever arrived meanwhile
        if (everyone) pending.everyone = true;
        for (const id of newcomers) pending.newcomers.add(id);
        delay = RETRY_DELAY_MS;
      }
      await sleep(delay);
    }
    this.pending.delete(room);
  }

  // A logout must also take effect on a connection that is already open: the login is
  // checked again on every message, with the same rules as the handshake
  private async stillLoggedIn(socket: AuthedSocket): Promise<boolean> {
    try {
      const token = extractToken(socket);
      if (!token) throw new UnauthorizedException();
      await this.sessions.verifyAccessToken(token);
      return true;
    } catch (err) {
      if (!(err instanceof UnauthorizedException)) {
        this.logger.error(`Session check failed: ${(err as Error).message}`);
      }
      socket.emit('session:expired');
      // After the current message has been answered, so the client gets its refusal first
      setImmediate(() => socket.disconnect(true));
      return false;
    }
  }

  private refusal(err: unknown): Ack {
    if (err instanceof HttpException && err.getStatus() === 403) return refuse('FORBIDDEN', err.message);
    if (err instanceof HttpException && err.getStatus() === 404) return refuse('NOT_FOUND', err.message);
    this.logger.error(`Subscribe failed: ${(err as Error).message}`);
    return refuse('INTERNAL', 'Internal error');
  }
}

// The device id comes the same two ways as the token: the handshake `auth` object, or the
// X-Device-Id header that the HTTP routes use
function extractDeviceId(socket: Socket): string | null {
  const fromAuth: unknown = socket.handshake.auth?.deviceId;
  const fromHeader = socket.handshake.headers['x-device-id'];
  const id = fromAuth ?? fromHeader;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

// The token comes from the handshake `auth` object, or from an Authorization header.
// Never from the query string: URLs end up in logs.
function extractToken(socket: Socket): string | null {
  const fromAuth: unknown = socket.handshake.auth?.token;
  const header = socket.handshake.headers.authorization;
  const fromHeader = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
  const token = fromAuth ?? fromHeader;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

// The global ValidationPipe does not run on socket messages: validate the payload here,
// with the same options (unknown fields are refused)
function parse(payload: unknown): SubscribeDto | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const target = plainToInstance(SubscribeDto, payload);
  const errors = validateSync(target, { whitelist: true, forbidNonWhitelisted: true });
  return errors.length === 0 ? target : null;
}

// Every socket is always in one room named after its own id: that one is not a subscription
function subscriptionCount(socket: Socket): number {
  return socket.rooms.size - (socket.rooms.has(socket.id) ? 1 : 0);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
