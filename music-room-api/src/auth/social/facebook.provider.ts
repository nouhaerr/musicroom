import { Injectable, UnauthorizedException } from '@nestjs/common';

export interface SocialProfile {
  providerId: string;
  email: string;
  name: string;
}

// L'application mobile utilise le SDK Facebook natif pour obtenir un
// access token, puis l'envoie au back. On ne fait JAMAIS confiance à un
// email/nom envoyé directement par le client : on revérifie tout auprès
// de l'API Facebook elle-même.
@Injectable()
export class FacebookProvider {
  async verify(accessToken: string): Promise<SocialProfile> {
    const url = `https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new UnauthorizedException('Access token Facebook invalide');
    }
    const data = (await res.json()) as { id?: string; name?: string; email?: string };
    if (!data.id || !data.email) {
      throw new UnauthorizedException('Profil Facebook incomplet (email manquant)');
    }
    return { providerId: data.id, email: data.email, name: data.name ?? data.email };
  }
}
