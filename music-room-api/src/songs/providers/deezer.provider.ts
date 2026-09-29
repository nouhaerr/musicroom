import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { CatalogSearchResult, CatalogTrack, MusicProvider } from './music-provider';

const DEEZER_API = 'https://api.deezer.com';
const DEEZER_NOT_FOUND = 800; // Deezer's error code for "no data"
const TIMEOUT_MS = 5000;

// Only the Deezer fields we actually read (the real JSON has many more)
interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  link: string;
  preview: string;
  artist: { name: string };
  album?: { cover_medium?: string };
}

interface DeezerSearchResponse {
  data: DeezerTrack[];
  total: number;
}

// Deezer reports errors with HTTP 200 and this shape in the body
interface DeezerError {
  error: { type: string; message: string; code: number };
}
';'
@Injectable()
export class DeezerProvider implements MusicProvider {
  private readonly logger = new Logger(DeezerProvider.name);

  async search(query: string, limit: number, index: number): Promise<CatalogSearchResult> {
    const params = new URLSearchParams({ q: query, limit: String(limit), index: String(index) });
    const body = await this.request<DeezerSearchResponse>(`/search?${params}`);
    if (!body) return { total: 0, items: [] };
    return { total: body.total, items: body.data.map(toCatalogTrack) };
  }

  async getTrack(externalId: string): Promise<CatalogTrack | null> {
    // Deezer ids are digits only: reject anything else without calling Deezer
    if (!/^\d+$/.test(externalId)) return null;
    const track = await this.request<DeezerTrack>(`/track/${externalId}`);
    return track ? toCatalogTrack(track) : null;
  }

  // Calls Deezer; returns null for "not found", throws 502 for any other failure
  private async request<T>(path: string): Promise<T | null> {
    let body: T | DeezerError;
    try {
      const res = await fetch(`${DEEZER_API}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = (await res.json()) as T | DeezerError;
    } catch (err) {
      this.logger.warn(`Deezer request failed on ${path}: ${(err as Error).message}`);
      throw new BadGatewayException('Music catalog unavailable');
    }

    if (isDeezerError(body)) {
      if (body.error.code === DEEZER_NOT_FOUND) return null;
      this.logger.warn(`Deezer error ${body.error.code} on ${path}: ${body.error.message}`);
      throw new BadGatewayException('Music catalog unavailable');
    }
    return body;
  }
}

function isDeezerError(body: unknown): body is DeezerError {
  return typeof body === 'object' && body !== null && 'error' in body;
}

// Deezer's shape -> our shape. Empty strings become null.
function toCatalogTrack(t: DeezerTrack): CatalogTrack {
  return {
    externalId: String(t.id),
    title: t.title,
    artist: t.artist.name,
    durationSec: t.duration,
    link: t.link,
    coverUrl: t.album?.cover_medium || null,
    previewUrl: t.preview || null,
  };
}
