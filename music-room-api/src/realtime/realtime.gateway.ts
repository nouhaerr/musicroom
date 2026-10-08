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
import { SessionsService } from '../auth/sessions.service';
import { PartiesService } from '../parties/parties.service';
import { SubscribeDto } from './dto/subscribe.dto';

const MAX_MESSAGE_BYTES = 16 * 1024; // clients only ever send small messages
const MAX_TIMER_MS = 2 ** 31 - 1; // the longest delay setTimeout accepts
const MAX_SUBSCRIPTIONS = 20; // how many parties one connection may watch at the same time

// What the server knows about a connected client, set once during the handshake
export interface SocketData {
  userId: string;
  sessionId: string;
  tokenExpiresAt: number;
}
export type AuthedSocket = Socket<any, any, any, SocketData>;

// Every client message is answered through its acknowledgement with one of these.
// (Never add a key named `event` here: Nest would send the object as an event instead.)
export type Ack =
  | { ok: true }
  | { ok: false; error: { code: AckErrorCode; message: string } };
type AckErrorCode = 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'TOO_MANY' | 'INTERNAL';

const refuse = (code: AckErrorCode, message: string): Ack => ({ ok: false, error: { code, message } });

// The Socket.io room that gathers everyone watching one resource
export const roomOf = (target: SubscribeDto) => `${target.type}:${target.id}`;

@WebSocketGateway({ cors: { origin: '*' }, maxHttpBufferSize: MAX_MESSAGE_BYTES })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly sessions: SessionsService,
    private readonly parties: PartiesService,
  ) {}

  // Runs before a connection is accepted: a client without a valid login never connects
  afterInit(server: Server) {
    server.use(async (socket: AuthedSocket, next) => {
      try {
        const token = extractToken(socket);
        if (!token) throw new UnauthorizedException();
        const { user, sessionId, expiresAt } = await this.sessions.verifyAccessToken(token);
        socket.data.userId = user.id;
        socket.data.sessionId = sessionId;
        socket.data.tokenExpiresAt = expiresAt.getTime();
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
    if (!target) return refuse('BAD_REQUEST', 'Expected { type: "party", id: "<uuid>" }');
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
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(@ConnectedSocket() socket: AuthedSocket, @MessageBody() payload: unknown): Promise<Ack> {
    const target = parse(payload);
    if (!target) return refuse('BAD_REQUEST', 'Expected { type: "party", id: "<uuid>" }');
    await socket.leave(roomOf(target));
    return { ok: true };
  }

  // The same rule as the REST route: whoever may GET the resource may watch it
  private async assertCanView(target: SubscribeDto, userId: string): Promise<void> {
    await this.parties.getDetail(target.id, userId);
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
