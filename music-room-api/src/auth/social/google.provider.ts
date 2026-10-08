import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { gaxios, OAuth2Client, TokenPayload } from 'google-auth-library';
import { SocialProfile } from './facebook.provider';

// L'app mobile obtient un ID token via le SDK Google natif, puis l'envoie
// au back. La bibliothèque Google vérifie signature, audience, émetteur
// et expiration avec les clés publiques Google mises en cache.
@Injectable()
export class GoogleProvider {
  private readonly clientId: string;
  private readonly enabled: boolean;
  private readonly client = new OAuth2Client({
    transporterOptions: { timeout: 10_000, retryConfig: { retry: 0 } },
  });
  constructor(config: ConfigService) {
    const enabled = config.get<string>('GOOGLE_AUTH_ENABLED', 'true');
    if (enabled !== 'true' && enabled !== 'false') {
      throw new Error('GOOGLE_AUTH_ENABLED doit valoir true ou false');
    }
    this.enabled = enabled === 'true';
    this.clientId = config.get<string>('GOOGLE_CLIENT_ID')?.trim() ?? '';
    if (this.enabled && !this.clientId) throw new Error('GOOGLE_CLIENT_ID est requis');
  }

  async verify(idToken: string): Promise<SocialProfile> {
    if (!this.enabled) {
      throw new ServiceUnavailableException('La connexion Google est désactivée');
    }
    if (typeof idToken !== 'string' || !idToken.trim()) {
      throw new UnauthorizedException('ID token Google invalide');
    }
    let data: TokenPayload | undefined;
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.clientId });
      data = ticket.getPayload();
    } catch (error) {
      // Les erreurs de la bibliothèque peuvent contenir le JWT ou ses claims :
      // ne jamais les exposer dans les logs ou dans la réponse HTTP.
      if (error instanceof gaxios.GaxiosError) {
        throw new ServiceUnavailableException('Vérification Google temporairement indisponible');
      }
      throw new UnauthorizedException('ID token Google invalide ou expiré');
    }
    if (!data || data.aud !== this.clientId) {
      throw new UnauthorizedException('ID token Google émis pour une autre application');
    }
    if (data.email_verified !== true) {
      throw new UnauthorizedException('Email Google non vérifié');
    }
    if (typeof data.sub !== 'string' || !data.sub.trim() || typeof data.email !== 'string' || !data.email.trim()) {
      throw new UnauthorizedException('Profil Google incomplet (email manquant)');
    }

    return { providerId: data.sub, email: data.email,
      name: typeof data.name === 'string' && data.name.trim() ? data.name : data.email };
  }
}
