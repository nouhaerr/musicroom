export type ProfileInfo = Record<string, unknown> | null;

export interface PublicProfile {
  relationship?: 'NONE' | 'OUTGOING' | 'INCOMING' | 'FRIENDS';
  friendRequestId?: string | null;
  id: string;
  name: string;
  username?: string | null;
  publicInfo: ProfileInfo;
  musicPreferences: string[];
  friendsOnlyInfo?: ProfileInfo;
}

export interface OwnProfile extends PublicProfile {
  email: string;
  emailVerifiedAt?: string | null;
  hasPassword?: boolean;
  privateInfo: ProfileInfo;
  googleId?: string | null;
  facebookId?: string | null;
}

export interface ProfileDraft {
  name: string;
  publicBio: string;
  friendsBio: string;
  privateBio: string;
  genres: string;
}

/** Keep editable text only; photos use the dedicated avatar endpoint. */
export function editableInfo(info: ProfileInfo | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(info ?? {}).filter(([key, value]) =>
    !['avatar', 'username', 'shareListeningActivity'].includes(key) &&
    key.length <= 50 && typeof value === 'string' && value.length <= 500,
  ).slice(0, 20)) as Record<string, string>;
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
  if (!name) throw new Error('Enter your name.');
  const musicPreferences = [...new Set(draft.genres.split(',').map(g => g.trim().toLowerCase()).filter(Boolean))];
  if (musicPreferences.length > 50 || musicPreferences.some(g => g.length > 50)) {
    throw new Error('Choose up to 50 genres, with no more than 50 characters each.');
  }
  // PATCH replaces each JSON object: retain fields created by another client.
  return {
    name, musicPreferences,
    publicInfo: { ...editableInfo(original.publicInfo), bio: draft.publicBio.trim() },
    friendsOnlyInfo: { ...editableInfo(original.friendsOnlyInfo), bio: draft.friendsBio.trim() },
    privateInfo: { ...editableInfo(original.privateInfo), bio: draft.privateBio.trim() },
  };
}

/** Display only the two sections the other-profile endpoint can expose. */
export function visibleProfileSections(profile: PublicProfile) {
  const sections = [{ title: 'Public information', info: profile.publicInfo }];
  if (Object.hasOwn(profile, 'friendsOnlyInfo')) {
    sections.push({ title: 'Friends-only information', info: profile.friendsOnlyInfo ?? null });
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
