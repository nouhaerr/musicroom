import type { ApiClient } from './client.ts';
import type { Song } from './parties.ts';

// What the server sends for a playlist
export interface Playlist {
  id: string;
  ownerId: string;
  name: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  editLicense: 'EVERYONE' | 'INVITED_ONLY';
}

// A playlist as the list gives it: with its owner, how many songs it has and the picture of the first one
export type PlaylistCard = Playlist & { owner: { id: string; name: string }; songsCount: number; cover: string | null };

// A playlist as its page gives it: with its owner, and for the user who asks only, whether they may change its songs
// and their own invitation to it
export type PlaylistPage = Playlist & {
  owner: { id: string; name: string };
  canEdit: boolean;
  invitation: { id: string; status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED' } | null;
};

// One song of a playlist: its place, the song, and who added it
export interface PlaylistEntry {
  id: string; // the playlistSongId: what a removal names
  position: number;
  song: Song;
  addedBy: { id: string; name: string };
}

// One realtime message: the whole playlist, as GET /playlists/:id/songs returns it
export interface PlaylistSnapshot {
  playlist: Playlist;
  songs: PlaylistEntry[]; // every song: the server keeps a playlist at MAX_PLAYLIST_SONGS songs at most (100 by default)
  songsLength: number;
}

export const PLAYLISTS_PAGE_SIZE = 20;

// The calls of the Playlists tab
export function playlistsApi(client: ApiClient) {
  const id = encodeURIComponent;
  return {
    // A page of the public or of the private playlists, newest first; with a search, only those whose name contains it
    list: async (page: number, search: string, visibility: Playlist['visibility']) => {
      const playlists = await client.request<PlaylistCard[]>(`/playlists?page=${page}&limit=${PLAYLISTS_PAGE_SIZE}&visibility=${visibility}${search ? `&q=${id(search)}` : ''}`);
      if (!Array.isArray(playlists)) throw new Error('Invalid playlists response.');
      return playlists;
    },
    // What the page of one playlist needs besides its songs: who owns it, whether I may edit it, my invitation
    page: async (playlistId: string) => {
      const page = await client.request<PlaylistPage>(`/playlists/${id(playlistId)}`);
      if (typeof page?.canEdit !== 'boolean' || typeof page.owner?.name !== 'string') throw new Error('Invalid playlist response.');
      return page;
    },
    remove: (playlistId: string, entryId: string) => client.request(`/playlists/${id(playlistId)}/songs/${id(entryId)}`, 'DELETE'),
    // Accepting an invitation to an "invitees edit" playlist is what lets me change its songs
    answer: (invitationId: string, accept: boolean) =>
      client.request(`/invitations/${id(invitationId)}/${accept ? 'accept' : 'decline'}`, 'POST', {}),
  };
}
