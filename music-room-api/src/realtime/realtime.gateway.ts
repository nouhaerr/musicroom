import { Logger, UnauthorizedException } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SessionsService } from '../auth/sessions.service';

const MAX_MESSAGE_BYTES = 16 * 1024; // clients only ever send small messages
const MAX_TIMER_MS = 2 ** 31 - 1; // the longest delay setTimeout accepts

// What the server knows about a connected client, set once during the handshake
export interface SocketData {
  userId: string;
  sessionId: string;
  tokenExpiresAt: number;
}
export type AuthedSocket = Socket<any, any, any, SocketData>;

@WebSocketGateway({ cors: { origin: '*' }, maxHttpBufferSize: MAX_MESSAGE_BYTES })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly sessions: SessionsService) {}

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
