import { User } from '../../generated/prisma';

export type PublicUser = Omit<User, 'passwordHash'>;

// Retire les champs sensibles (mot de passe hashé) avant de renvoyer un
// utilisateur au client. À utiliser systématiquement en sortie de contrôleur.
export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}

// Explicit allowlist for profiles belonging to other people (including search).
export const publicProfileSelect = {
  id: true, name: true, publicInfo: true, musicPreferences: true,
} as const;
