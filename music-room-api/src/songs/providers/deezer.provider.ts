import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { CatalogSearchResult, CatalogTrack, MusicProvider } from './music-provider';

const DEEZER_API = 'https://api.deezer.com';
const DEEZER_NOT_FOUND = 800; // Deezer's error code for "no data"
const TIMEOUT_MS = 5000;
const MAX_TEXT_LENGTH = 500; // titles and names; PostgreSQL also cannot index a much longer title
const MAX_URL_LENGTH = 2048;
const MAX_INT4 = 2 ** 31 - 1; // durations are stored in a 32-bit column

type JsonObject = Record<string, unknown>;

// Only the Deezer fields we actually read (the real JSON has many more), as isDeezerTrack checks them
interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  link: string;
  preview?: string | null;
  artist: { name: string };
  album?: { cover_medium?: string | null } | null;
}

// Deezer reports errors with HTTP 200 and { error: { type, message, code } } in the body
interface DeezerError {
  message: string;
  code: number;
}

@Injectable()
export class DeezerProvider implements MusicProvider {
  private readonly logger = new Logger(DeezerProvider.name);

  async search(query: string, limit: number, index: number): Promise<CatalogSearchResult> {
    const params = new URLSearchParams({ q: query, limit: String(limit), index: String(index) });
    const path = `/search?${params}`;
    const body = await this.request(path);
    if (!body) return { total: 0, items: [] };
    if (!Array.isArray(body.data)) throw this.unavailable(`Deezer sent no list of results on ${path}`);

    // One malformed entry must not break a whole search: keep the well-formed tracks,
    // and never more of them than the client asked for
    const items = body.data.filter(isDeezerTrack).slice(0, limit).map(toCatalogTrack);
    // A total that cannot be one (negative, decimal, smaller than this page) is replaced
    const total = isIntegerBetween(body.total, items.length, Number.MAX_SAFE_INTEGER) ? body.total : items.length;
    return { total, items };
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
    const track = await this.request(path);
    if (!track) return null;
    if (!isDeezerTrack(track)) throw this.unavailable(`Deezer sent an unexpected track on ${path}`);
    return toCatalogTrack(track);
  }

  // Calls Deezer; returns null for "not found", throws 502 for any other failure.
  // A Deezer answer is outside data: nothing in it is used before its shape is checked, even with HTTP 200.
  private async request(path: string): Promise<JsonObject | null> {
    let body: unknown;
    try {
      const res = await fetch(`${DEEZER_API}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = await res.json();
    } catch (err) {
      throw this.unavailable(`Deezer request failed on ${path}: ${(err as Error).message}`);
    }

    // Valid JSON is not always an object: `null`, a number or a list are answers too
    if (!isObject(body)) throw this.unavailable(`Deezer sent no JSON object on ${path}`);
    if ('error' in body) {
      const { error } = body;
      if (!isDeezerError(error)) throw this.unavailable(`Deezer sent an unexpected error on ${path}`);
      if (error.code === DEEZER_NOT_FOUND) return null;
      throw this.unavailable(`Deezer error ${error.code} on ${path}: ${JSON.stringify(error.message.slice(0, 200))}`);
    }
    return body;
  }

  // The real reason goes to the server logs; the client only learns that the catalog is unavailable
  private unavailable(reason: string): BadGatewayException {
    this.logger.warn(reason);
    return new BadGatewayException('Music catalog unavailable');
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// JSON has a single number type: 1.5, -1 and 1e30 are all "numbers"
function isIntegerBetween(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

// Text we store and show: not empty, not huge, and without the NUL character that PostgreSQL refuses
function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT_LENGTH && !value.includes('\0');
}

// An absolute http(s) URL, the only kind a client can safely be told to open
function isUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH || /\s/.test(value) || value.includes('\0')) return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

// Deezer leaves a field out, or sends null or "", when it has no value: all three are fine
function isUrlOrNothing(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || value === '' || isUrl(value);
}

function isDeezerError(value: unknown): value is DeezerError {
  return isObject(value) && typeof value.code === 'number' && typeof value.message === 'string';
}

// Every field we read is checked, the optional ones too: a track with one wrong field is refused
// as a whole, so nothing unexpected is ever stored or sent to a client
function isDeezerTrack(value: unknown): value is DeezerTrack {
  if (!isObject(value)) return false;
  const { id, title, duration, link, preview, artist, album } = value;
  return (
    isIntegerBetween(id, 1, Number.MAX_SAFE_INTEGER) &&
    isText(title) &&
    isIntegerBetween(duration, 0, MAX_INT4) &&
    isUrl(link) &&
    isUrlOrNothing(preview) &&
    isObject(artist) &&
    isText(artist.name) &&
    (album === undefined || album === null || (isObject(album) && isUrlOrNothing(album.cover_medium)))
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
