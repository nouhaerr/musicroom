import { createPublicKey, type JsonWebKey } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SocialProfile {
  providerId: string;
  email: string;
  name: string;
}

@Injectable()
export class FacebookProvider {
  constructor(private readonly config: ConfigService) {}

  async verify(accessToken: string, nonce?: string): Promise<SocialProfile> {
    const appId = this.config.get<string>('FACEBOOK_CLIENT_ID')?.trim();
    if (nonce !== undefined) return this.verifyLimited(accessToken, nonce, appId);
    const appSecret = this.config.get<string>('FACEBOOK_CLIENT_SECRET')?.trim();
    if (!appId || !appSecret) throw new ServiceUnavailableException('Facebook is not configured');
    if (typeof accessToken !== 'string' || !accessToken.trim()) {
      throw new UnauthorizedException('Invalid Facebook access token');
    }
    const debug = await this.requestGraph(
      `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}`,
      `${appId}|${appSecret}`,
    );
    const checked = debug.data;
    const now = Date.now() / 1000;
    const invalidExpiry = (value: unknown) => value !== undefined && value !== 0 &&
      (typeof value !== 'number' || !Number.isFinite(value) || value <= now);
    if (!this.isObject(checked) || checked.is_valid !== true || checked.app_id !== appId ||
        typeof checked.user_id !== 'string' || !checked.user_id.trim() ||
        invalidExpiry(checked.expires_at) || invalidExpiry(checked.data_access_expires_at)) {
      throw new UnauthorizedException('Facebook token is invalid or was issued for another application');
    }
    const data = await this.requestGraph('https://graph.facebook.com/me?fields=id,name,email', accessToken);
    if (data.id !== checked.user_id || typeof data.email !== 'string' || !data.email.trim()) {
      throw new UnauthorizedException('Incomplete or inconsistent Facebook profile');
    }
    return { providerId: checked.user_id, email: data.email,
      name: typeof data.name === 'string' && data.name.trim() ? data.name : data.email };
  }

  private keys: (JsonWebKey & { kid: string; alg?: string })[] = [];
  private keysExpireAt = 0;
  private keysFlight: Promise<void> | null = null;

  private async loadKeys() {
    if (this.keysExpireAt > Date.now()) return;
    if (!this.keysFlight) this.keysFlight = (async () => {
      try {
        const response = await fetch('https://www.facebook.com/.well-known/oauth/openid/jwks/', {
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error();
        const data: unknown = await response.json();
        if (!this.isObject(data) || !Array.isArray(data.keys)) throw new Error();
        this.keys = data.keys.filter((key): key is JsonWebKey & { kid: string } =>
          this.isObject(key) && key.kty === 'RSA' && typeof key.kid === 'string' &&
          typeof key.n === 'string' && typeof key.e === 'string' &&
          (key.use === undefined || key.use === 'sig') && (key.alg === undefined || key.alg === 'RS256'));
        if (!this.keys.length) throw new Error();
        this.keysExpireAt = Date.now() + 5 * 60_000;
      } catch { throw new ServiceUnavailableException('Facebook verification is temporarily unavailable'); }
    })().finally(() => { this.keysFlight = null; });
    await this.keysFlight;
  }

  private async verifyLimited(token: string, nonce: string, appId?: string): Promise<SocialProfile> {
    if (!appId) throw new ServiceUnavailableException('Facebook is not configured');
    const invalid = () => new UnauthorizedException('Invalid or expired Facebook authentication token');
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw invalid();
    const jwt = new JwtService();
    let header: { alg?: string; kid?: string };
    try {
      header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()) as typeof header;
      if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string') throw invalid();
    } catch { throw invalid(); }
    await this.loadKeys();
    const key = this.keys.find(key => key.kid === header.kid);
    if (!key) throw invalid();
    try {
      const publicKey = createPublicKey({ key, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
      const payload = jwt.verify<Record<string, unknown>>(token, {
        publicKey, algorithms: ['RS256'], audience: appId, issuer: 'https://www.facebook.com',
      });
      if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number' || payload.iat > Date.now() / 1000 + 60 ||
          payload.nonce !== nonce || typeof payload.sub !== 'string' || !payload.sub.trim() ||
          typeof payload.email !== 'string' || !payload.email.trim()) throw invalid();
      return { providerId: payload.sub, email: payload.email,
        name: typeof payload.name === 'string' && payload.name.trim() ? payload.name : payload.email };
    } catch { throw invalid(); }
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private async requestGraph(url: string, token: string): Promise<Record<string, unknown>> {
    const unavailable = () => new ServiceUnavailableException('Facebook verification is temporarily unavailable');
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Une erreur réseau peut contenir l’URL et donc le token : ne pas la journaliser.
      throw unavailable();
    }
    if (response.status === 429 || response.status >= 500) throw unavailable();
    if (!response.ok) throw new UnauthorizedException('Invalid Facebook access token');
    let data: unknown;
    try { data = await response.json(); } catch { throw unavailable(); }
    if (!this.isObject(data)) throw unavailable();
    return data;
  }
}
