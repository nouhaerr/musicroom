import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const smtp = {
  MAIL_TRANSPORT: 'smtp', MAIL_HOST: 'smtp.example.com', MAIL_PORT: '465', MAIL_SECURE: 'true',
  MAIL_USER: 'sender@example.com', MAIL_PASSWORD: 'test-secret', MAIL_FROM: 'Music Room <sender@example.com>',
  APP_URL: 'http://localhost:3000/',
};
function config(values: Record<string, string>) {
  return { get: (key: string, fallback?: unknown) => values[key] ?? fallback } as unknown as ConfigService;
}

describe('SMTP mail delivery', () => {
  const sendMail = jest.fn();
  const verify = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.mocked(createTransport).mockReturnValue({ sendMail, verify } as unknown as ReturnType<typeof createTransport>);
    sendMail.mockResolvedValue({ accepted: ['recipient@example.com'], rejected: [] });
    verify.mockResolvedValue(true);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['465', 'true', true], ['587', 'false', false],
  ])('uses encrypted SMTP on port %s', async (MAIL_PORT, MAIL_SECURE, secure) => {
    await new MailService(config({ ...smtp, MAIL_PORT, MAIL_SECURE })).verifyConnection();
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      port: Number(MAIL_PORT), secure, requireTLS: true,
      auth: { user: smtp.MAIL_USER, pass: smtp.MAIL_PASSWORD },
    }));
    expect(verify).toHaveBeenCalledTimes(1);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends both account emails with encoded links, text and HTML, without logging tokens', async () => {
    const mail = new MailService(config(smtp));
    const token = 'private-token&extra="<value>';
    await mail.sendVerificationEmail('recipient@example.com', token);
    await mail.sendPasswordResetEmail('recipient@example.com', token);
    for (const [index, route] of ['verify-email', 'reset-password'].entries()) {
      const message = sendMail.mock.calls[index][0];
      const link = new URL(`http://localhost:3000/auth/${route}`);
      link.searchParams.set('token', token);
      expect(message.from).toBe(smtp.MAIL_FROM);
      expect(message.to).toEqual({ address: 'recipient@example.com', name: '' });
      expect(message.text).toContain(link.href);
      expect(message.html).toContain(`href="${link.href}"`);
      expect(message.html).not.toContain('<value>');
    }
    expect(JSON.stringify(jest.mocked(Logger.prototype.log).mock.calls)).not.toContain('private-token');
  });

  it.each([
    { MAIL_PASSWORD: '' }, { MAIL_HOST: '' }, { MAIL_FROM: '' },
    { MAIL_PORT: 'invalid' }, { MAIL_PORT: '0' }, { MAIL_SECURE: 'yes' },
    { MAIL_PORT: '465', MAIL_SECURE: 'false' }, { MAIL_PORT: '587', MAIL_SECURE: 'true' },
    { MAIL_TRANSPORT: 'smpt' },
  ])('rejects incomplete or invalid configuration %j', overrides => {
    expect(() => new MailService(config({ ...smtp, ...overrides }))).toThrow();
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('preserves explicit development logging without creating a SMTP connection', async () => {
    const mail = new MailService(config({ MAIL_TRANSPORT: 'log' }));
    await mail.sendVerificationEmail('recipient@example.com', 'dev-token');
    expect(createTransport).not.toHaveBeenCalled();
    expect(Logger.prototype.log).toHaveBeenCalledWith(expect.stringContaining('token=dev-token'));
    expect(() => new MailService(config({ MAIL_TRANSPORT: 'log', NODE_ENV: 'production' }))).toThrow();
  });

  it('returns 503 on SMTP errors without logging credentials, recipients or message bodies', async () => {
    sendMail.mockRejectedValue(Object.assign(new Error('test-secret recipient@example.com private-token'), { code: 'EAUTH' }));
    await expect(new MailService(config(smtp)).sendVerificationEmail('recipient@example.com', 'private-token'))
      .rejects.toMatchObject({ status: 503 });
    const logs = JSON.stringify(jest.mocked(Logger.prototype.error).mock.calls);
    expect(logs).toContain('EAUTH');
    expect(logs).not.toMatch(/test-secret|recipient@example.com|private-token/);
    expect(Logger.prototype.log).not.toHaveBeenCalled();
  });

  it('does not report success when no recipient was accepted', async () => {
    sendMail.mockResolvedValue({ accepted: [], rejected: ['recipient@example.com'] });
    await expect(new MailService(config(smtp)).sendVerificationEmail('recipient@example.com', 'token'))
      .rejects.toMatchObject({ status: 503 });
  });

  it('reports a failed connection check', async () => {
    verify.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    await expect(new MailService(config(smtp)).verifyConnection()).rejects.toMatchObject({ status: 503 });
    expect(sendMail).not.toHaveBeenCalled();
  });
});
