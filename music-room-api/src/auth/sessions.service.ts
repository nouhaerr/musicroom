import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma';
import { JwtPayload } from './token.types';
import { lockUsers } from '../common/locks';
import { toPublicUser } from '../users/user.mapper';

export function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private tokens(userId: string, email: string, sid: string) {
    const accessToken = this.jwt.sign({ sub: userId, email, sid, type: 'access' }, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET', 'dev_access_secret'),
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
      algorithm: 'HS256',
    });
    const refreshToken = this.jwt.sign({ sub: userId, email, sid, type: 'refresh', jti: randomUUID() }, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET', 'dev_refresh_secret'),
      expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
      algorithm: 'HS256',
    });
    const expiresAt = new Date(this.jwt.decode<{ exp: number }>(refreshToken).exp * 1000);
    return { accessToken, refreshToken, expiresAt };
  }

  async create(userId: string, credentialsCheckedAt?: Date) {
    return this.prisma.$transaction(async tx => {
      await lockUsers(tx, [userId]);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (credentialsCheckedAt && user.updatedAt.getTime() !== credentialsCheckedAt.getTime()) {
        throw new UnauthorizedException('Compte modifié pendant la connexion, veuillez réessayer');
      }
      const sid = randomUUID();
      const { expiresAt, ...tokens } = this.tokens(user.id, user.email, sid);
      await tx.authSession.create({ data: {
        id: sid, userId, expiresAt,
        refreshTokens: { create: { tokenHash: tokenHash(tokens.refreshToken), expiresAt } },
      } });
      return { ...tokens, user: toPublicUser(user) };
    });
  }

  async refresh(token: string) {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET', 'dev_refresh_secret'),
        algorithms: ['HS256'],
      });
    } catch { throw new UnauthorizedException('Token invalide ou expiré'); }
    if (payload.type !== 'refresh' || !payload.sid || !payload.sub || !payload.jti) {
      throw new UnauthorizedException('Type de token invalide');
    }

    const result = await this.prisma.$transaction(async tx => {
      await lockUsers(tx, [payload.sub]);
      const record = await tx.refreshToken.findUnique({
        where: { tokenHash: tokenHash(token) }, include: { session: { include: { user: true } } },
      });
      if (!record || record.sessionId !== payload.sid || record.session.userId !== payload.sub) return null;
      if (record.consumedAt) {
        // Return rather than throw here: revocation must commit before the 401.
        await this.revokeAll(tx, payload.sub);
        return null;
      }
      const now = new Date();
      if (record.session.revokedAt || record.expiresAt <= now || record.session.expiresAt <= now) return null;
      await tx.refreshToken.update({ where: { id: record.id }, data: { consumedAt: now } });
      const { expiresAt, ...tokens } = this.tokens(payload.sub, record.session.user.email, record.sessionId);
      await tx.refreshToken.create({ data: { sessionId: record.sessionId, tokenHash: tokenHash(tokens.refreshToken), expiresAt } });
      await tx.authSession.update({ where: { id: record.sessionId }, data: { expiresAt } });
      return { ...tokens, user: toPublicUser(record.session.user) };
    });
    if (!result) throw new UnauthorizedException('Session invalide ou token déjà utilisé');
    return result;
  }

  async logout(userId: string, sessionId: string) {
    await this.prisma.$transaction(async tx => {
      await lockUsers(tx, [userId]);
      await tx.authSession.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    return { message: 'Déconnecté' };
  }

  revokeAll(tx: Prisma.TransactionClient, userId: string) {
    return tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async validateAccess(payload: JwtPayload) {
    if (payload.type !== 'access' || !payload.sid || !payload.sub) throw new UnauthorizedException('Session invalide');
    const session = await this.prisma.authSession.findFirst({
      where: { id: payload.sid, userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
    if (!session) throw new UnauthorizedException('Session expirée ou révoquée');
    return toPublicUser(session.user);
  }
}
