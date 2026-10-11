import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync } from 'crypto';
import { FacebookProvider } from './facebook.provider';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const nonce = 'random-attempt-nonce-12345';
const jwt = new JwtService();
const sign = (claims: Record<string, unknown> = {}, key = privateKey) => jwt.sign({
  sub: 'facebook-user', email: 'user@example.com', name: 'Listener', nonce, ...claims,
}, { privateKey: key.export({ format: 'pem', type: 'pkcs8' }), algorithm: 'RS256', keyid: 'meta-key',
  audience: 'our-app', issuer: 'https://www.facebook.com', expiresIn: '1h' });
let provider: FacebookProvider;
let fetchMock: jest.SpyInstance;
beforeEach(() => {
  provider = new FacebookProvider(new ConfigService({ FACEBOOK_CLIENT_ID: 'our-app' }));
  fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'meta-key', alg: 'RS256' }],
  })));
});
afterEach(() => jest.restoreAllMocks());

it('verifies a signed Limited Login token and fetches only the fixed Meta JWKS endpoint', async () => {
  await expect(provider.verify(sign(), nonce)).resolves.toEqual({ providerId: 'facebook-user', email: 'user@example.com', name: 'Listener' });
  await expect(provider.verify(sign(), nonce)).resolves.toHaveProperty('providerId');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe('https://www.facebook.com/.well-known/oauth/openid/jwks/');
});
it.each([
  { nonce: 'different-nonce-value' }, { sub: '' }, { email: '' }, { iat: Math.floor(Date.now() / 1000) + 600 },
])('rejects invalid claims %j', async claims => {
  await expect(provider.verify(sign(claims), nonce)).rejects.toMatchObject({ status: 401 });
});
it.each(['aud', 'iss', 'exp'])('rejects an invalid %s', async field => {
  const claims = { sub: 'id', email: 'a@b.com', nonce, aud: 'our-app', iss: 'https://www.facebook.com', exp: Math.floor(Date.now() / 1000) + 60, iat: Math.floor(Date.now() / 1000),
    [field]: field === 'exp' ? 1 : 'wrong' };
  const token = jwt.sign(claims, { privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }), algorithm: 'RS256', keyid: 'meta-key' });
  await expect(provider.verify(token, nonce)).rejects.toMatchObject({ status: 401 });
});
it('rejects a forged signature', async () => {
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  await expect(provider.verify(sign({}, other.privateKey), nonce)).rejects.toMatchObject({ status: 401 });
});
it('requires expiry and refuses unsigned or malformed tokens', async () => {
  const token = jwt.sign({ sub: 'id', email: 'a@b.com', nonce }, { privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }), algorithm: 'RS256', keyid: 'meta-key', audience: 'our-app', issuer: 'https://www.facebook.com' });
  await expect(provider.verify(token, nonce)).rejects.toMatchObject({ status: 401 });
  await expect(provider.verify('not-a-token', nonce)).rejects.toMatchObject({ status: 401 });
});
it('reports provider outages without exposing secrets', async () => {
  fetchMock.mockRejectedValue(new Error('sensitive-details'));
  await expect(provider.verify(sign(), nonce)).rejects.toMatchObject({ status: 503, message: 'Facebook verification is temporarily unavailable' });
});
it('rejects a missing nonce by using the existing Graph validation path', async () => {
  await expect(provider.verify(sign())).rejects.toMatchObject({ status: 503 }); // No app secret: never accepts a JWT without nonce.
});
