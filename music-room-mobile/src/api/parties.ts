import type { ApiClient } from './client.ts';

// What the server sends for a party. The screens of the design call it a "room".

export interface Song {
  id: string;
  externalId: string | null;
  title: string;
  artist: string;
  durationSec: number;
  sourceUri: string;
  thumbnailUrl: string | null;
}

export interface Party {
  id: string;
  ownerId: string;
  name: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  voteLicense: 'EVERYONE' | 'INVITED_ONLY' | 'LOCATION_TIME';
  voteStartsAt: string | null;
  voteEndsAt: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  nowPlaying: Song | null;
  nowPlayingStartedAt: string | null;
  playbackVersion: number;
}

export interface QueueEntry {
  id: string; // the partySongId: what a vote names
  voteCount: number;
  song: Song;
}

// Where a phone is, for a party that counts votes at its location
export interface Position { latitude: number; longitude: number }

// One realtime message: the whole party, as GET /parties/:id and GET /parties/:id/queue return it
export interface PartySnapshot {
  party: Party;
  queue: QueueEntry[]; // the first 100 entries
  queueLength: number; // the real length of the queue
  playingForMs: number | null; // how long the song has been playing when the server sent this; null if none is
}

const VOTES_PAGE_SIZE = 100; // the largest page the server gives

// The calls of the party page
export function partiesApi(client: ApiClient) {
  const id = encodeURIComponent;
  const vote = (partyId: string, entryId: string) => `/parties/${id(partyId)}/songs/${id(entryId)}/vote`;
  return {
    // The queue entries I voted for in this party: what the page marks as "You voted"
    myVotes: async (partyId: string) => {
      const voted = new Set<string>();
      for (let page = 1; ; page++) {
        const ids = await client.request<string[]>(`/parties/${id(partyId)}/votes/mine?page=${page}&limit=${VOTES_PAGE_SIZE}`);
        if (!Array.isArray(ids) || !ids.every(entryId => typeof entryId === 'string')) throw new Error('Invalid votes response.');
        for (const entryId of ids) voted.add(entryId);
        if (ids.length < VOTES_PAGE_SIZE) return voted;
      }
    },
    // Adds a catalog song at the end of the queue, with no votes yet
    suggest: (partyId: string, externalId: string) => client.request(`/parties/${id(partyId)}/songs`, 'POST', { externalId }),
    // The position is only for a party that counts votes at its location (voteLicense LOCATION_TIME)
    vote: (partyId: string, entryId: string, position?: Position) => client.request(vote(partyId, entryId), 'POST', position ?? {}),
    unvote: (partyId: string, entryId: string) => client.request(vote(partyId, entryId), 'DELETE'),
    // The host moves to the next song. The version is the one last seen: the server refuses an older one.
    next: (partyId: string, expectedPlaybackVersion: number) =>
      client.request(`/parties/${id(partyId)}/next`, 'POST', { expectedPlaybackVersion }),
  };
}

// How far the song playing is: what the server measured, plus the time since this phone received it.
// The phone's clock is never compared with the server's. Never outside the song.
// EXPO_PUBLIC_SONG_SECONDS (in .env) makes every song count for at most that many seconds; empty, each keeps its real length.
export function progress(snapshot: { party: Pick<Party, 'nowPlaying'>; playingForMs: number | null }, receivedAt: number, now: number) {
  const { nowPlaying } = snapshot.party;
  if (!nowPlaying || typeof snapshot.playingForMs !== 'number') return null;
  const cap = Number(process.env.EXPO_PUBLIC_SONG_SECONDS);
  const durationSec = cap > 0 ? Math.min(nowPlaying.durationSec, cap) : nowPlaying.durationSec;
  const elapsedSec = Math.min(Math.max(Math.floor((snapshot.playingForMs + now - receivedAt) / 1000), 0), durationSec);
  return { elapsedSec, durationSec };
}

// 65 seconds are shown as 1:05
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
