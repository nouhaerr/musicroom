import { User } from '../../generated/prisma';

export type PublicUser = Omit<User, 'passwordHash'> & { hasPassword: boolean };

// Retire les champs sensibles (mot de passe hashé) avant de renvoyer un
// utilisateur au client. À utiliser systématiquement en sortie de contrôleur.
export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return { ...publicUser, hasPassword: !!_passwordHash };
}

// Explicit allowlist for profiles belonging to other people (including search).
export const publicProfileSelect = {
  id: true, name: true, username: true, publicInfo: true, musicPreferences: true,
} as const;
