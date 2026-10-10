import { BadGatewayException, Logger } from '@nestjs/common';
import { DeezerProvider } from './deezer.provider';

const track = (id: number, extra: Record<string, unknown> = {}) => ({
  id, title: `Track ${id}`, duration: 200, link: `https://www.deezer.com/track/${id}`,
  preview: 'https://cdn.example/preview.mp3', artist: { name: 'Artist' },
  album: { cover_medium: 'https://cdn.example/cover.jpg' }, ...extra,
});
const answer = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const notFound = { error: { type: 'DataException', message: 'no data', code: 800 } };

// Answers with HTTP 200 and valid JSON that are still not what Deezer documents.
// [what is wrong, the body]
const malformedBodies: [string, unknown][] = [
  ['null', null],
  ['a number', 0],
  ['an empty string', ''],
  ['false', false],
  ['true', true],
  ['a string', 'oops'],
  ['a list', [track(1)]],
  ['an error that is null', { error: null }],
  ['an error that is null next to a valid track', track(1, { error: null })],
  ['an error that is a string', { error: 'oops' }],
  ['an error that is a number', { error: 42 }],
  ['an error that is false', { error: false }],
  ['an error that is a list', { error: [] }],
  ['an error without a code', { error: { message: 'no data' } }],
  ['an error whose code is text', { error: { code: '800', message: 'no data' } }],
  ['an error without a message', { error: { code: 800 } }],
  ['an error whose message is not text', { error: { code: 800, message: 5 } }],
];

// One field of an otherwise valid track is wrong. [what is wrong, the field]
const malformedFields: [string, Record<string, unknown>][] = [
  ['an id that is text', { id: '1' }],
  ['a decimal id', { id: 1.5 }],
  ['a negative id', { id: -1 }],
  ['an id of 0', { id: 0 }],
  ['an id too large to be exact', { id: Number.MAX_SAFE_INTEGER + 1 }],
  ['an id in exponent form', { id: 1e21 }],
  ['no title', { title: undefined }],
  ['a null title', { title: null }],
  ['a title that is not text', { title: 5 }],
  ['an empty title', { title: '' }],
  ['a title with a NUL character', { title: 'a\u0000b' }],
  ['a title of 501 characters', { title: 'x'.repeat(501) }],
  ['a duration that is text', { duration: '200' }],
  ['a null duration', { duration: null }],
  ['a decimal duration', { duration: 1.5 }],
  ['a negative duration', { duration: -1 }],
  ['a duration above 32 bits', { duration: 2 ** 31 }],
  ['a link that is not text', { link: 5 }],
  ['an empty link', { link: '' }],
  ['a link that is not a URL', { link: 'not a url' }],
  ['a link without a host', { link: 'https://' }],
  ['a relative link', { link: '/track/1' }],
  ['a javascript: link', { link: 'javascript:alert(1)' }],
  ['an ftp link', { link: 'ftp://cdn.example/file' }],
  ['a link with a space', { link: 'https://cdn.example/a b' }],
  ['a link with a line break', { link: 'https://cdn.example/a\nb' }],
  ['a link with a NUL character', { link: 'https://cdn.example/a\u0000b' }],
  ['a link of 2049 characters', { link: `https://cdn.example/${'x'.repeat(2029)}` }],
  ['a preview that is an object', { preview: {} }],
  ['a preview that is a number', { preview: 5 }],
  ['a preview that is 0', { preview: 0 }],
  ['a preview that is a list', { preview: [] }],
  ['a preview that is true', { preview: true }],
  ['a preview that is false', { preview: false }],
  ['a preview that is not a URL', { preview: 'not a url' }],
  ['a preview without a host', { preview: 'https://' }],
  ['a javascript: preview', { preview: 'javascript:alert(1)' }],
  ['no artist', { artist: undefined }],
  ['a null artist', { artist: null }],
  ['an artist that is text', { artist: 'Artist' }],
  ['an artist that is a list', { artist: [{ name: 'Artist' }] }],
  ['an artist name that is not text', { artist: { name: 5 } }],
  ['an empty artist name', { artist: { name: '' } }],
  ['an artist name with a NUL character', { artist: { name: 'a\u0000' } }],
  ['an artist name of 501 characters', { artist: { name: 'x'.repeat(501) } }],
  ['an album that is text', { album: 'Album' }],
  ['an album that is a number', { album: 5 }],
  ['an album that is a list', { album: [] }],
  ['an album that is true', { album: true }],
  ['a cover that is an object', { album: { cover_medium: {} } }],
  ['a cover that is a number', { album: { cover_medium: 5 } }],
  ['a cover that is a list', { album: { cover_medium: [] } }],
  ['a cover that is not a URL', { album: { cover_medium: 'not a url' } }],
  ['a javascript: cover', { album: { cover_medium: 'javascript:alert(1)' } }],
];

describe('DeezerProvider', () => {
  let provider: DeezerProvider;
  let fetchMock: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    provider = new DeezerProvider();
    fetchMock = jest.spyOn(global, 'fetch');
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined); // failures below are expected
  });
  afterEach(() => jest.restoreAllMocks());

  describe('normalizeId', () => {
    it.each([['67238732', '67238732'], ['067238732', '67238732'], ['0067238732', '67238732'], ['0', '0'], ['000', '0']])(
      'gives %j the canonical form %j', (input, expected) => {
        expect(provider.normalizeId(input)).toBe(expected);
      });

    it.each(['', ' ', 'abc', '12a', ' 12', '12 ', '-1', '1.5', '1e3', '１２', '1\u0000', '../search'])(
      'refuses %j, which cannot be a Deezer id', (input) => {
        expect(provider.normalizeId(input)).toBeNull();
      });
  });

  describe('getTrack', () => {
    it('does not call Deezer for an id that cannot be valid', async () => {
      await expect(provider.getTrack('../search?q=x')).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('requests the canonical id and maps the answer to our shape', async () => {
      fetchMock.mockResolvedValue(answer(track(67238732)));

      await expect(provider.getTrack('067238732')).resolves.toEqual({
        externalId: '67238732', title: 'Track 67238732', artist: 'Artist', durationSec: 200,
        link: 'https://www.deezer.com/track/67238732',
        coverUrl: 'https://cdn.example/cover.jpg', previewUrl: 'https://cdn.example/preview.mp3',
      });
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.deezer.com/track/67238732');
    });

    it.each([
      ['an empty preview', { preview: '' }, { previewUrl: null }],
      ['a null preview', { preview: null }, { previewUrl: null }],
      ['no preview', { preview: undefined }, { previewUrl: null }],
      ['no album', { album: undefined }, { coverUrl: null }],
      ['a null album', { album: null }, { coverUrl: null }],
      ['an album without a cover', { album: {} }, { coverUrl: null }],
      ['a null cover', { album: { cover_medium: null } }, { coverUrl: null }],
      ['an empty cover', { album: { cover_medium: '' } }, { coverUrl: null }],
    ])('accepts %s as "no value" and gives null', async (_label, fields, expected) => {
      fetchMock.mockResolvedValue(answer(track(1, fields)));
      await expect(provider.getTrack('1')).resolves.toMatchObject({ externalId: '1', ...expected });
    });

    it('accepts the largest values a real track can have', async () => {
      const largest = {
        id: Number.MAX_SAFE_INTEGER, title: 'x'.repeat(500), duration: 2 ** 31 - 1, artist: { name: 'y'.repeat(500) },
        link: `http://cdn.example/${'x'.repeat(2029)}`, // 2048 characters, plain http
      };
      fetchMock.mockResolvedValue(answer(track(1, largest)));

      await expect(provider.getTrack('1')).resolves.toMatchObject({
        externalId: String(Number.MAX_SAFE_INTEGER), title: largest.title, durationSec: largest.duration,
        artist: largest.artist.name, link: largest.link,
      });
    });

    it('accepts a duration of 0', async () => {
      fetchMock.mockResolvedValue(answer(track(1, { duration: 0 })));
      await expect(provider.getTrack('1')).resolves.toMatchObject({ durationSec: 0 });
    });

    it('returns null when Deezer has no such track (error 800 with HTTP 200)', async () => {
      fetchMock.mockResolvedValue(answer(notFound));
      await expect(provider.getTrack('999')).resolves.toBeNull();
    });

    it.each([
      ['another Deezer error (quota)', () => answer({ error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } })],
      ['an HTTP error status', () => answer({}, 503)],
      ['a body that is not JSON', () => new Response('<html>oops</html>', { status: 200 })],
      ['an empty object', () => answer({})],
    ])('answers 502 on %s', async (_label, respond) => {
      fetchMock.mockResolvedValue(respond());
      await expect(provider.getTrack('1')).rejects.toBeInstanceOf(BadGatewayException);
    });

    it.each(malformedBodies)('answers 502 when the body is %s', async (_label, body) => {
      fetchMock.mockResolvedValue(answer(body));
      await expect(provider.getTrack('1')).rejects.toBeInstanceOf(BadGatewayException);
    });

    it.each(malformedFields)('answers 502 on a track with %s', async (_label, fields) => {
      fetchMock.mockResolvedValue(answer(track(1, fields)));
      await expect(provider.getTrack('1')).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('answers 502 when Deezer cannot be reached', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      await expect(provider.getTrack('1')).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('logs a Deezer error message on one line, shortened', async () => {
      fetchMock.mockResolvedValue(answer({ error: { type: 'Exception', code: 4, message: `Quota\nFAKE LOG LINE ${'x'.repeat(500)}` } }));

      await expect(provider.getTrack('1')).rejects.toBeInstanceOf(BadGatewayException);

      const logged = String(warn.mock.calls[0][0]);
      expect(logged).toContain('Deezer error 4 on /track/1: "Quota\\nFAKE LOG LINE');
      expect(logged).not.toContain('\n');
      expect(logged.length).toBeLessThan(300);
    });

    it('logs nothing of an error it cannot read', async () => {
      fetchMock.mockResolvedValue(answer({ error: { code: 'x\nFAKE LOG LINE', message: 'no data' } }));

      await expect(provider.getTrack('1')).rejects.toBeInstanceOf(BadGatewayException);

      expect(warn.mock.calls).toEqual([['Deezer sent an unexpected error on /track/1']]);
    });
  });

  describe('search', () => {
    it('maps the results and encodes the query', async () => {
      fetchMock.mockResolvedValue(answer({ data: [track(1), track(2)], total: 42 }));

      const result = await provider.search('daft punk & co', 2, 4);

      expect(result.total).toBe(42);
      expect(result.items.map((item) => item.externalId)).toEqual(['1', '2']);
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.deezer.com/search?q=daft+punk+%26+co&limit=2&index=4');
    });

    it('keeps the well-formed tracks when one entry is malformed', async () => {
      fetchMock.mockResolvedValue(answer({ data: [track(1), { id: 2 }, null, 'x', track(3)], total: 5 }));
      const result = await provider.search('x', 5, 0);
      expect(result.items.map((item) => item.externalId)).toEqual(['1', '3']);
    });

    it.each(malformedFields)('leaves out a track with %s', async (_label, fields) => {
      fetchMock.mockResolvedValue(answer({ data: [track(1), track(2, fields), track(3)], total: 3 }));
      const result = await provider.search('x', 5, 0);
      expect(result.items.map((item) => item.externalId)).toEqual(['1', '3']);
    });

    it('never returns more tracks than asked for', async () => {
      fetchMock.mockResolvedValue(answer({ data: [track(1), track(2), track(3), track(4)], total: 4 }));
      const result = await provider.search('x', 2, 0);
      expect(result.items.map((item) => item.externalId)).toEqual(['1', '2']);
    });

    it.each([
      ['no total', undefined],
      ['a total that is text', '5'],
      ['a null total', null],
      ['a negative total', -1],
      ['a decimal total', 1.5],
      ['a total too large to be exact', 1e30],
      ['a total smaller than the page itself', 1],
    ])('falls back to the number of items when Deezer gives %s', async (_label, total) => {
      fetchMock.mockResolvedValue(answer({ data: [track(1), track(2)], total }));
      await expect(provider.search('x', 5, 0)).resolves.toMatchObject({ total: 2 });
    });

    it('returns an empty result when Deezer has no data', async () => {
      fetchMock.mockResolvedValue(answer(notFound));
      await expect(provider.search('x', 5, 0)).resolves.toEqual({ total: 0, items: [] });
    });

    it.each([
      ['no list of results', () => answer({ total: 3 })],
      ['a list of results that is not a list', () => answer({ data: 'oops', total: 3 })],
      ['a list of results that is null', () => answer({ data: null, total: 3 })],
      ['a Deezer parameter error', () => answer({ error: { type: 'ParameterException', message: 'Wrong parameter', code: 500 } })],
    ])('answers 502 on %s', async (_label, respond) => {
      fetchMock.mockResolvedValue(respond());
      await expect(provider.search('x', 5, 0)).rejects.toBeInstanceOf(BadGatewayException);
    });

    it.each(malformedBodies)('answers 502 when the body is %s', async (_label, body) => {
      fetchMock.mockResolvedValue(answer(body));
      await expect(provider.search('x', 5, 0)).rejects.toBeInstanceOf(BadGatewayException);
    });
  });
});
