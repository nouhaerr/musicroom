import { ConfigService } from '@nestjs/config';
import { GoogleProvider } from './google.provider';
import { FacebookProvider } from './facebook.provider';

const config = new ConfigService({ GOOGLE_CLIENT_ID: 'our-google-app', FACEBOOK_CLIENT_ID: 'our-facebook-app', FACEBOOK_CLIENT_SECRET: 'test-secret' });
const response = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response;

describe('Social provider identity checks', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['', '   '])('fails startup for missing Google audience %j', value => {
    expect(() => new GoogleProvider(new ConfigService({ GOOGLE_CLIENT_ID: value }))).toThrow('GOOGLE_CLIENT_ID');
  });

  it.each([
    { aud: 'another-app', email_verified: 'true' },
    { aud: 'our-google-app', email_verified: 'false' },
    { aud: 'our-google-app', email_verified: false },
    { aud: 'our-google-app' },
  ])('rejects unsafe Google claims %j', async claims => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response({ sub: 'google-user', email: 'user@example.com', ...claims }));
    await expect(new GoogleProvider(config).verify('token')).rejects.toThrow();
  });

  it.each([true, 'true'])('accepts verified Google identity (%j)', async email_verified => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response({ sub: 'google-user', email: 'user@example.com', aud: 'our-google-app', email_verified }));
    await expect(new GoogleProvider(config).verify('token')).resolves.toMatchObject({ providerId: 'google-user' });
  });

  it.each([
    { app_id: 'other-app', is_valid: true, user_id: 'fb-user' },
    { app_id: 'our-facebook-app', is_valid: false, user_id: 'fb-user' },
    { app_id: 'our-facebook-app', is_valid: true, user_id: 'fb-user', expires_at: 1 },
  ])('rejects unsafe Facebook debug results %j', async data => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(response({ data }));
    await expect(new FacebookProvider(config).verify('token')).rejects.toThrow();
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
});
