// Shared contract for any external music catalog (Deezer today).
// The rest of the app depends only on this contract, never on Deezer directly.

export interface CatalogTrack {
  externalId: string;
  title: string;
  artist: string;
  durationSec: number;
  link: string; // permanent URL: safe to store in the database
  coverUrl: string | null;
  previewUrl: string | null; // signed URL that expires: never store it
}

export interface CatalogSearchResult {
  total: number;
  items: CatalogTrack[];
}

export interface MusicProvider {
  search(query: string, limit: number, index: number): Promise<CatalogSearchResult>;
  // null when the track doesn't exist in the catalog
  getTrack(externalId: string): Promise<CatalogTrack | null>;
}

// Injection token: a TypeScript interface no longer exists at runtime,
// so Nest needs a real value to know what to inject.
export const MUSIC_PROVIDER = Symbol('MUSIC_PROVIDER');
