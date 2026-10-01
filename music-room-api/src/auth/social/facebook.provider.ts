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
    const debug = await fetch(`https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}`, {
      headers: { Authorization: `Bearer ${appId}|${appSecret}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!debug.ok) throw new UnauthorizedException('Access token Facebook invalide');
    const { data: checked } = await debug.json() as { data?: {
      is_valid?: boolean; app_id?: string; user_id?: string; expires_at?: number; data_access_expires_at?: number;
    } };
    const now = Date.now() / 1000;
    if (!checked?.is_valid || checked.app_id !== appId || !checked.user_id ||
        (checked.expires_at && checked.expires_at <= now) ||
        (checked.data_access_expires_at && checked.data_access_expires_at <= now)) {
      throw new UnauthorizedException('Token Facebook invalide ou émis pour une autre application');
    }
    const res = await fetch('https://graph.facebook.com/me?fields=id,name,email', {
      headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new UnauthorizedException('Access token Facebook invalide');
    const data = await res.json() as { id?: string; name?: string; email?: string };
    if (data.id !== checked.user_id || !data.email) {
      throw new UnauthorizedException('Profil Facebook incomplet ou incohérent');
    }
    return { providerId: checked.user_id, email: data.email, name: data.name ?? data.email };
  }
}
