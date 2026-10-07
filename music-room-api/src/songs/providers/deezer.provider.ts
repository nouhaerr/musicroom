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
  preview?: string;
  artist: { name: string };
  album?: { cover_medium?: string };
}

// Deezer reports errors with HTTP 200 and this shape in the body
interface DeezerError {
  error: { type: string; message: string; code: number };
}

@Injectable()
export class DeezerProvider implements MusicProvider {
  private readonly logger = new Logger(DeezerProvider.name);

  async search(query: string, limit: number, index: number): Promise<CatalogSearchResult> {
    const params = new URLSearchParams({ q: query, limit: String(limit), index: String(index) });
    const path = `/search?${params}`;
    const body = await this.request<{ data?: unknown; total?: unknown }>(path);
    if (!body) return { total: 0, items: [] };
    if (!Array.isArray(body.data)) throw this.unavailable(`Deezer sent no list of results on ${path}`);

    // One malformed entry must not break a whole search: keep the well-formed tracks
    const items = body.data.filter(isDeezerTrack).map(toCatalogTrack);
    return { total: typeof body.total === 'number' ? body.total : items.length, items };
  }

  normalizeId(externalId: string): string | null {
    // Deezer ids are digits only, and Deezer ignores leading zeros (067238732 = 67238732)
    if (!/^\d+$/.test(externalId)) return null;
    return externalId.replace(/^0+(?=\d)/, '');
  }

  async getTrack(externalId: string): Promise<CatalogTrack | null> {
    const id = this.normalizeId(externalId);
    if (!id) return null;
    const path = `/track/${id}`;
    const track = await this.request<unknown>(path);
    if (!track) return null;
    if (!isDeezerTrack(track)) throw this.unavailable(`Deezer sent an unexpected track on ${path}`);
    return toCatalogTrack(track);
  }

  // Calls Deezer; returns null for "not found", throws 502 for any other failure
  private async request<T>(path: string): Promise<T | null> {
    let body: T | DeezerError;
    try {
      const res = await fetch(`${DEEZER_API}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = (await res.json()) as T | DeezerError;
    } catch (err) {
      throw this.unavailable(`Deezer request failed on ${path}: ${(err as Error).message}`);
    }

    if (isDeezerError(body)) {
      if (body.error.code === DEEZER_NOT_FOUND) return null;
      throw this.unavailable(`Deezer error ${body.error.code} on ${path}: ${body.error.message}`);
    }
    return body;
  }

  // The real reason goes to the server logs; the client only learns that the catalog is unavailable
  private unavailable(reason: string): BadGatewayException {
    this.logger.warn(reason);
    return new BadGatewayException('Music catalog unavailable');
  }
}

function isDeezerError(body: unknown): body is DeezerError {
  return typeof body === 'object' && body !== null && 'error' in body;
}

// A Deezer answer is outside data: check its shape before reading it, even with HTTP 200
function isDeezerTrack(value: unknown): value is DeezerTrack {
  if (typeof value !== 'object' || value === null) return false;
  const track = value as { id?: unknown; title?: unknown; duration?: unknown; link?: unknown; artist?: { name?: unknown } | null };
  return (
    typeof track.id === 'number' &&
    typeof track.title === 'string' &&
    typeof track.duration === 'number' &&
    typeof track.link === 'string' &&
    typeof track.artist?.name === 'string'
  );
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
