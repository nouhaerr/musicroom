import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from './sessions.service';
import { FacebookProvider } from './social/facebook.provider';
import { GoogleProvider } from './social/google.provider';

describe('Account privacy during SMTP failures', () => {
  it.each(['resendVerification', 'forgotPassword'] as const)('%s keeps the generic response when SMTP is down', async method => {
    const findByEmail = jest.fn().mockResolvedValue({
      id: 'test-user', email: 'user@example.com', passwordHash: 'hash', emailVerifiedAt: null,
    });
    const failedMail = jest.fn().mockRejectedValue(new ServiceUnavailableException('SMTP unavailable'));
    const service = new AuthService(
      { passwordResetToken: { create: jest.fn() } } as unknown as PrismaService,
      {} as SessionsService,
      { findByEmail } as unknown as UsersService,
      { sendVerificationEmail: failedMail, sendPasswordResetEmail: failedMail } as unknown as MailService,
      { sign: () => 'test-token', decode: () => ({ exp: 2000000000 }) } as unknown as JwtService,
      { getOrThrow: () => 'test-secret' } as unknown as ConfigService,
      {} as FacebookProvider, {} as GoogleProvider,
    );
    await expect(service[method]('user@example.com')).resolves.toBeUndefined();
    expect(failedMail).toHaveBeenCalledTimes(1);
    findByEmail.mockResolvedValue(null);
    await expect(service[method]('unknown@example.com')).resolves.toBeUndefined();
    expect(failedMail).toHaveBeenCalledTimes(1);
  });
});
