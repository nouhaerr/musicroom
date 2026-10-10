export type ProfileInfo = Record<string, unknown> | null;

export interface PublicProfile {
  id: string;
  name: string;
  publicInfo: ProfileInfo;
  musicPreferences: string[];
  friendsOnlyInfo?: ProfileInfo;
}

export interface OwnProfile extends PublicProfile {
  email: string;
  privateInfo: ProfileInfo;
  googleId?: string | null;
}

export interface ProfileDraft {
  name: string;
  publicBio: string;
  friendsBio: string;
  privateBio: string;
  genres: string;
}

export function bio(info: ProfileInfo | undefined): string {
  return typeof info?.bio === 'string' ? info.bio : '';
}

export function profileDraft(profile: OwnProfile): ProfileDraft {
  return {
    name: profile.name,
    publicBio: bio(profile.publicInfo),
    friendsBio: bio(profile.friendsOnlyInfo),
    privateBio: bio(profile.privateInfo),
    genres: profile.musicPreferences.join(', '),
  };
}

export function profileChanges(original: OwnProfile, draft: ProfileDraft) {
  const name = draft.name.trim();
  if (!name) throw new Error('Saisissez votre nom.');
  const musicPreferences = [...new Set(draft.genres.split(',').map(g => g.trim().toLowerCase()).filter(Boolean))];
  if (musicPreferences.length > 50 || musicPreferences.some(g => g.length > 50)) {
    throw new Error('Choisissez au maximum 50 genres de 50 caractères chacun.');
  }
  // PATCH replaces each JSON object: retain fields created by another client.
  return {
    name, musicPreferences,
    publicInfo: { ...original.publicInfo, bio: draft.publicBio.trim() },
    friendsOnlyInfo: { ...original.friendsOnlyInfo, bio: draft.friendsBio.trim() },
    privateInfo: { ...original.privateInfo, bio: draft.privateBio.trim() },
  };
}

/** Display only the two sections the other-profile endpoint can expose. */
export function visibleProfileSections(profile: PublicProfile) {
  const sections = [{ title: 'Informations publiques', info: profile.publicInfo }];
  if (Object.hasOwn(profile, 'friendsOnlyInfo')) {
    sections.push({ title: 'Informations partagées avec les amis', info: profile.friendsOnlyInfo ?? null });
  }
  return sections;
}

export interface FriendRequest {
  id: string;
  senderId: string;
  receiverId: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  sender: PublicProfile;
  receiver: PublicProfile;
}

export const PAGE_SIZE = 20;

export function usersQuery(q: string, genre: string, page: number): string {
  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (q.trim()) params.set('q', q.trim());
  if (genre.trim()) params.set('genre', genre.trim().toLowerCase());
  return `/users/search?${params}`;
}
