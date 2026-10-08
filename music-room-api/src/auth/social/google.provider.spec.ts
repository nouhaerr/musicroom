import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync, sign } from 'crypto';
import { gaxios, OAuth2Client } from 'google-auth-library';
import { GoogleProvider } from './google.provider';

// Real RSA signatures and Google verifier; only certificate retrieval is replaced.
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const clientId = 'test-web-client.apps.googleusercontent.com';
function config(values: Record<string, string> = {}) {
  const settings = { GOOGLE_CLIENT_ID: clientId, ...values };
  return { get: (key: string, fallback?: unknown) => settings[key as keyof typeof settings] ?? fallback } as unknown as ConfigService;
}
function token(overrides: Record<string, unknown> = {}, privateKey = keys.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const content = `${encode({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })}.${encode({
    iss: 'https://accounts.google.com', aud: clientId, sub: 'google-subject',
    email: 'user@example.com', email_verified: true, name: 'Test User',
    iat: now - 10, exp: now + 3600, ...overrides,
  })}`;
  return `${content}.${sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url')}`;
}

describe('Google ID token verification', () => {
  beforeEach(() => {
    jest.spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync').mockResolvedValue({
      certs: { 'test-key': keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() },
      format: 'PEM',
    } as Awaited<ReturnType<OAuth2Client['getFederatedSignonCertsAsync']>>);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['', '   '])('requires a client ID by default (%j)', GOOGLE_CLIENT_ID => {
    expect(() => new GoogleProvider(config({ GOOGLE_CLIENT_ID }))).toThrow('GOOGLE_CLIENT_ID');
  });
  it('requires an ID when explicitly enabled and rejects invalid enablement', () => {
    expect(() => new GoogleProvider(config({ GOOGLE_AUTH_ENABLED: 'true', GOOGLE_CLIENT_ID: '' }))).toThrow();
    expect(() => new GoogleProvider(config({ GOOGLE_AUTH_ENABLED: 'yes' }))).toThrow();
  });
  it('does not fetch certificates or accept tokens when disabled', async () => {
    await expect(new GoogleProvider(config({ GOOGLE_AUTH_ENABLED: 'false', GOOGLE_CLIENT_ID: '' })).verify(token()))
      .rejects.toMatchObject({ status: 503 });
    expect(OAuth2Client.prototype.getFederatedSignonCertsAsync).not.toHaveBeenCalled();
  });
  it.each(['accounts.google.com', 'https://accounts.google.com'])('accepts a signed token from %s for our Web client', async iss => {
    await expect(new GoogleProvider(config()).verify(token({ iss }))).resolves.toEqual({
      providerId: 'google-subject', email: 'user@example.com', name: 'Test User',
    });
  });
  it.each([
    { aud: 'another-client' }, { iss: 'https://attacker.example.com' },
    { exp: Math.floor(Date.now() / 1000) - 1000 }, { exp: undefined },
    { email_verified: false }, { email_verified: 'true' }, { email_verified: undefined },
    { email: undefined }, { sub: '' },
  ])('rejects invalid claims %j', async claims => {
    await expect(new GoogleProvider(config()).verify(token(claims))).rejects.toMatchObject({ status: 401 });
  });
  it('rejects a token signed by a different private key', async () => {
    await expect(new GoogleProvider(config()).verify(token({}, otherKeys.privateKey))).rejects.toMatchObject({ status: 401 });
  });
  it.each(['', ' ', 'not-a-jwt'])('rejects malformed tokens without exposing them (%j)', async raw => {
    await expect(new GoogleProvider(config()).verify(raw)).rejects.toMatchObject({ status: 401 });
  });
  it('maps certificate download failures to 503 without exposing the underlying error', async () => {
    jest.mocked(OAuth2Client.prototype.getFederatedSignonCertsAsync).mockRejectedValue(
      new gaxios.GaxiosError('private-error-details', { url: new URL('https://www.googleapis.com/oauth2/v1/certs'), headers: new Headers() }),
    );
    await expect(new GoogleProvider(config()).verify(token())).rejects.toMatchObject({
      status: 503, message: 'Vérification Google temporairement indisponible',
    });
  });
});
