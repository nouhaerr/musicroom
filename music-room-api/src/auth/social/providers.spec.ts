import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { FacebookProvider } from './facebook.provider';

// Provider tests must not inherit OAuth settings loaded from the developer's .env.
function testConfig(values: Record<string, string>) {
  return { get: (key: string, fallback?: unknown) => values[key] ?? fallback } as unknown as ConfigService;
}

const config = testConfig({ GOOGLE_CLIENT_ID: 'our-google-app', FACEBOOK_CLIENT_ID: 'our-facebook-app', FACEBOOK_CLIENT_SECRET: 'test-secret' });
const response = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response;
const validDebug = { data: { app_id: 'our-facebook-app', is_valid: true, user_id: 'fb-user' } };

describe('Social provider identity checks', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    { app_id: 'other-app', is_valid: true, user_id: 'fb-user' },
    { app_id: 'our-facebook-app', is_valid: false, user_id: 'fb-user' },
    { app_id: 'our-facebook-app', is_valid: true, user_id: 'fb-user', expires_at: 1 },
    { app_id: 'our-facebook-app', is_valid: true, user_id: 'fb-user', data_access_expires_at: 1 },
    { app_id: 'our-facebook-app', is_valid: 'true', user_id: 'fb-user' },
    { app_id: 'our-facebook-app', is_valid: true, user_id: 123 },
    { app_id: 'our-facebook-app', is_valid: true, user_id: 'fb-user', expires_at: 'later' },
  ])('rejects unsafe Facebook debug results %j', async data => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(response({ data }));
    await expect(new FacebookProvider(config).verify('token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('checks the profile belongs to the debugged Facebook user', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response({ data: { app_id: 'our-facebook-app', is_valid: true, user_id: 'fb-user' } }))
      .mockResolvedValueOnce(response({ id: 'another-user', email: 'user@example.com' }));
    await expect(new FacebookProvider(config).verify('token')).rejects.toThrow();
  });

  it('accepts a Facebook token for our app and matching user', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response({ data: { app_id: 'our-facebook-app', is_valid: true, user_id: 'fb-user' } }))
      .mockResolvedValueOnce(response({ id: 'fb-user', email: 'user@example.com' }));
    await expect(new FacebookProvider(config).verify('token')).resolves.toMatchObject({ providerId: 'fb-user' });
  });

  it('requires configuration before contacting Meta', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unexpected network call'));
    await expect(new FacebookProvider(testConfig({})).verify('token')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['', '   '])('rejects an empty token without contacting Meta', async token => {
    const fetch = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unexpected network call'));
    await expect(new FacebookProvider(config).verify(token)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '   ', 123])('rejects a missing or malformed email (%j)', async email => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(validDebug))
      .mockResolvedValueOnce(response({ id: 'fb-user', email }));
    await expect(new FacebookProvider(config).verify('token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  describe.each(['debug', 'profile'])('%s request failures', stage => {
    function mockRequest() {
      const fetch = jest.spyOn(global, 'fetch');
      if (stage === 'profile') fetch.mockResolvedValueOnce(response(validDebug));
      return fetch;
    }

    it.each([429, 500, 503])('returns 503 for upstream HTTP %s', async status => {
      mockRequest().mockResolvedValueOnce(response({ error: { message: 'private-provider-details' } }, status));
      await expect(new FacebookProvider(config).verify('token')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('returns 401 for a rejected token', async () => {
      mockRequest().mockResolvedValueOnce(response({ error: 'invalid token' }, 400));
      await expect(new FacebookProvider(config).verify('token')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it.each([new TypeError('private-token-in-network-error'), new DOMException('private-token', 'TimeoutError')])(
      'hides network and timeout details', async error => {
        mockRequest().mockRejectedValueOnce(error);
        await expect(new FacebookProvider(config).verify('token')).rejects.toThrow(
          new ServiceUnavailableException('Vérification Facebook temporairement indisponible'),
        );
      },
    );

    it('handles unreadable JSON without exposing the provider response', async () => {
      mockRequest().mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('private-body'); } } as unknown as Response);
      await expect(new FacebookProvider(config).verify('token')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it.each([null, [], 'invalid'])('handles an unexpected JSON shape (%j)', async body => {
      mockRequest().mockResolvedValueOnce(response(body));
      await expect(new FacebookProvider(config).verify('token')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
