import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialProfile } from './facebook.provider';

// L'app mobile obtient un ID token via le SDK Google natif, puis l'envoie
// au back. On vérifie sa signature/validité via l'endpoint tokeninfo de
// Google et on s'assure qu'il a bien été émis pour NOTRE client (aud).
@Injectable()
export class GoogleProvider {
  constructor(private readonly config: ConfigService) {}

  async verify(idToken: string): Promise<SocialProfile> {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );
    if (!res.ok) {
      throw new UnauthorizedException('ID token Google invalide');
    }
    const data = (await res.json()) as {
      sub?: string;
      email?: string;
      email_verified?: string;
      name?: string;
      aud?: string;
    };

    const expectedClientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (expectedClientId && data.aud !== expectedClientId) {
      throw new UnauthorizedException('ID token Google émis pour une autre application');
    }
    if (!data.sub || !data.email) {
      throw new UnauthorizedException('Profil Google incomplet (email manquant)');
    }

    return { providerId: data.sub, email: data.email, name: data.name ?? data.email };
  }
}
