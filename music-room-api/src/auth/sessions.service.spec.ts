import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService, tokenHash } from './sessions.service';

const user = { id: 'user-id', email: 'user@example.com', passwordHash: 'secret-hash', updatedAt: new Date() };
const testSettings: Record<string, string> = { JWT_ACCESS_SECRET: 'access-test', JWT_REFRESH_SECRET: 'refresh-test' };
// Keep JWT tests independent from environment variables loaded by Prisma.
const config = {
  get: (key: string, fallback?: unknown) => testSettings[key] ?? fallback,
  getOrThrow: (key: string) => {
    if (!testSettings[key]) throw new Error(`Missing setting: ${key}`);
    return testSettings[key];
  },
} as unknown as ConfigService;
const jwt = new JwtService();

function fixture() {
  const db = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue(user) },
    authSession: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn() },
    refreshToken: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  db.$transaction.mockImplementation(async fn => fn(db));
  const service = new SessionsService(db as unknown as PrismaService, jwt, config);
  const token = jwt.sign({ sub: user.id, sid: 'session-id', type: 'refresh', jti: 'unique-token' }, { secret: 'refresh-test', expiresIn: '1h' });
  const record = {
    id: 'token-id', sessionId: 'session-id', consumedAt: null, expiresAt: new Date(Date.now() + 3600000),
    session: { userId: user.id, user, revokedAt: null, expiresAt: new Date(Date.now() + 3600000) },
  };
  db.refreshToken.findUnique.mockResolvedValue(record);
  return { db, service, token, record };
}

describe('Session lifecycle', () => {
  it('stores only a hash and excludes passwordHash from the response', async () => {
    const { db, service } = fixture();
    const result = await service.create(user.id);
    const data = db.authSession.create.mock.calls[0][0].data;
    expect(data.refreshTokens.create.tokenHash).toBe(tokenHash(result.refreshToken));
    expect(JSON.stringify(data)).not.toContain(result.refreshToken);
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(jwt.verify(result.accessToken, { secret: 'access-test' }).sid).toBe(data.id);
  });

  it('rejects credentials checked before a password/profile change', async () => {
    const { db, service } = fixture();
    await expect(service.create(user.id, new Date(0))).rejects.toThrow();
    expect(db.authSession.create).not.toHaveBeenCalled();
  });

  it('consumes the old refresh token and issues a different one', async () => {
    const { db, service, token } = fixture();
    const result = await service.refresh(token);
    expect(result.refreshToken).not.toBe(token);
    expect(db.refreshToken.update).toHaveBeenCalledWith(expect.objectContaining({ data: { consumedAt: expect.any(Date) } }));
    expect(db.refreshToken.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tokenHash: tokenHash(result.refreshToken) }) }));
  });

  it('commits revocation of ALL sessions before reporting replay', async () => {
    const { db, service, token, record } = fixture();
    db.refreshToken.findUnique.mockResolvedValue({ ...record, consumedAt: new Date() });
    await expect(service.refresh(token)).rejects.toThrow();
    expect(db.authSession.updateMany).toHaveBeenCalledWith({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    // A throw inside the transaction would roll the revocation back.
    await expect(db.$transaction.mock.results[0].value).resolves.toBeNull();
    expect(db.refreshToken.create).not.toHaveBeenCalled();
  });

  it.each(['revoked', 'expired', 'missing'])('rejects a %s session/token', async state => {
    const { db, service, token, record } = fixture();
    if (state === 'missing') db.refreshToken.findUnique.mockResolvedValue(null);
    if (state === 'revoked') record.session.revokedAt = new Date() as never;
    if (state === 'expired') record.expiresAt = new Date(0);
    await expect(service.refresh(token)).rejects.toThrow();
    expect(db.refreshToken.create).not.toHaveBeenCalled();
  });

  it('does not accept an access token as a refresh token', async () => {
    const { db, service } = fixture();
    const token = jwt.sign({ sub: user.id, sid: 'session-id', type: 'access' }, { secret: 'access-test' });
    await expect(service.refresh(token)).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects access tokens for revoked sessions', async () => {
    const { db, service } = fixture();
    db.authSession.findFirst.mockResolvedValue(null);
    await expect(service.validateAccess({ sub: user.id, email: user.email, type: 'access', sid: 'session-id' })).rejects.toThrow();
  });

  it('logs out only the requested session owned by the user', async () => {
    const { db, service } = fixture();
    await service.logout(user.id, 'session-id');
    expect(db.authSession.updateMany).toHaveBeenCalledWith({ where: { id: 'session-id', userId: user.id, revokedAt: null }, data: { revokedAt: expect.any(Date) } });
  });
});
