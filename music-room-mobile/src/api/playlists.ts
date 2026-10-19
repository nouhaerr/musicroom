import type { ApiClient } from './client.ts';

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
  };
}
