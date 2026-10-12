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

// One realtime message: the whole party, as GET /parties/:id and GET /parties/:id/queue return it
export interface PartySnapshot {
  party: Party;
  queue: QueueEntry[]; // the first 100 entries
  queueLength: number; // the real length of the queue
}
