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

  async verify(accessToken: string): Promise<SocialProfile> {
    const appId = this.config.get<string>('FACEBOOK_CLIENT_ID')?.trim();
    const appSecret = this.config.get<string>('FACEBOOK_CLIENT_SECRET')?.trim();
    if (!appId || !appSecret) throw new ServiceUnavailableException('Facebook non configuré');
    if (typeof accessToken !== 'string' || !accessToken.trim()) {
      throw new UnauthorizedException('Access token Facebook invalide');
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
      throw new UnauthorizedException('Token Facebook invalide ou émis pour une autre application');
    }
    const data = await this.requestGraph('https://graph.facebook.com/me?fields=id,name,email', accessToken);
    if (data.id !== checked.user_id || typeof data.email !== 'string' || !data.email.trim()) {
      throw new UnauthorizedException('Profil Facebook incomplet ou incohérent');
    }
    return { providerId: checked.user_id, email: data.email,
      name: typeof data.name === 'string' && data.name.trim() ? data.name : data.email };
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private async requestGraph(url: string, token: string): Promise<Record<string, unknown>> {
    const unavailable = () => new ServiceUnavailableException('Vérification Facebook temporairement indisponible');
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
    if (!response.ok) throw new UnauthorizedException('Access token Facebook invalide');
    let data: unknown;
    try { data = await response.json(); } catch { throw unavailable(); }
    if (!this.isObject(data)) throw unavailable();
    return data;
  }
}
