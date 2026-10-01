import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialProfile } from './facebook.provider';

// L'app mobile obtient un ID token via le SDK Google natif, puis l'envoie
// au back. On vérifie sa signature/validité via l'endpoint tokeninfo de
// Google et on s'assure qu'il a bien été émis pour NOTRE client (aud).
@Injectable()
export class GoogleProvider {
  private readonly clientId: string;
  constructor(config: ConfigService) {
    this.clientId = config.get<string>('GOOGLE_CLIENT_ID')?.trim() ?? '';
    if (!this.clientId) throw new Error('GOOGLE_CLIENT_ID est requis');
  }

  async verify(idToken: string): Promise<SocialProfile> {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) {
      throw new UnauthorizedException('ID token Google invalide');
    }
    const data = (await res.json()) as {
      sub?: string;
      email?: string;
      email_verified?: string | boolean;
      name?: string;
      aud?: string;
    };

    if (data.aud !== this.clientId) {
      throw new UnauthorizedException('ID token Google émis pour une autre application');
    }
    if (data.email_verified !== true && data.email_verified !== 'true') {
      throw new UnauthorizedException('Email Google non vérifié');
    }
    if (!data.sub || !data.email) {
      throw new UnauthorizedException('Profil Google incomplet (email manquant)');
    }

    return { providerId: data.sub, email: data.email, name: data.name ?? data.email };
  }
}
