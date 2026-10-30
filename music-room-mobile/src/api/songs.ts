import type { ApiClient } from './client';

// A song of the music catalog (Deezer), as the search gives it
export interface CatalogTrack {
  externalId: string; // the catalog's id: what a party or a playlist needs to add it
  title: string;
  artist: string;
  coverUrl: string | null;
}

// The calls of the Suggest and Add tracks pages, and of the players
export function songsApi(client: ApiClient) {
  return {
    // The first 20 songs of the catalog matching the text
    search: async (text: string) => {
      const answer = await client.request<{ items: CatalogTrack[] }>(`/songs/search?q=${encodeURIComponent(text)}`);
      if (!Array.isArray(answer?.items)) throw new Error('Invalid search response.');
      return answer.items;
    },
    // A fresh link to the 30-second extract of a stored song: the links expire, so ask right before playing
    preview: async (songId: string) => {
      const answer = await client.request<{ previewUrl: string }>(`/songs/${encodeURIComponent(songId)}/preview`);
      if (typeof answer?.previewUrl !== 'string') throw new Error('Invalid preview response.');
      return answer.previewUrl;
    },
  };
}
