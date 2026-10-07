import { BadGatewayException, Logger } from '@nestjs/common';
import { DeezerProvider } from './deezer.provider';

const track = (id: number, extra: Record<string, unknown> = {}) => ({
  id, title: `Track ${id}`, duration: 200, link: `https://www.deezer.com/track/${id}`,
  preview: 'https://cdn.example/preview.mp3', artist: { name: 'Artist' },
  album: { cover_medium: 'https://cdn.example/cover.jpg' }, ...extra,
});
const answer = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const notFound = { error: { type: 'DataException', message: 'no data', code: 800 } };

describe('DeezerProvider', () => {
  let provider: DeezerProvider;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    provider = new DeezerProvider();
    fetchMock = jest.spyOn(global, 'fetch');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined); // failures below are expected
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

    it('turns a missing preview or cover into null', async () => {
      fetchMock.mockResolvedValue(answer(track(1, { preview: '', album: undefined })));
      await expect(provider.getTrack('1')).resolves.toMatchObject({ previewUrl: null, coverUrl: null });
    });

    it('returns null when Deezer has no such track (error 800 with HTTP 200)', async () => {
      fetchMock.mockResolvedValue(answer(notFound));
      await expect(provider.getTrack('999')).resolves.toBeNull();
    });

    it.each([
      ['another Deezer error (quota)', () => answer({ error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } })],
      ['an HTTP error status', () => answer({}, 503)],
      ['a body that is not JSON', () => new Response('<html>oops</html>', { status: 200 })],
      ['a track without an artist', () => answer(track(1, { artist: undefined }))],
      ['a track whose id is not a number', () => answer(track(1, { id: 'abc' }))],
      ['a track without a title', () => answer(track(1, { title: undefined }))],
      ['a list where a track was expected', () => answer([track(1)])],
    ])('answers 502 on %s', async (_label, respond) => {
      fetchMock.mockResolvedValue(respond());
      await expect(provider.getTrack('1')).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('answers 502 when Deezer cannot be reached', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      await expect(provider.getTrack('1')).rejects.toBeInstanceOf(BadGatewayException);
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

    it('falls back to the number of items when Deezer gives no total', async () => {
      fetchMock.mockResolvedValue(answer({ data: [track(1)] }));
      await expect(provider.search('x', 5, 0)).resolves.toMatchObject({ total: 1 });
    });

    it('returns an empty result when Deezer has no data', async () => {
      fetchMock.mockResolvedValue(answer(notFound));
      await expect(provider.search('x', 5, 0)).resolves.toEqual({ total: 0, items: [] });
    });

    it.each([
      ['no list of results', () => answer({ total: 3 })],
      ['a list of results that is not a list', () => answer({ data: 'oops', total: 3 })],
      ['a Deezer parameter error', () => answer({ error: { type: 'ParameterException', message: 'Wrong parameter', code: 500 } })],
    ])('answers 502 on %s', async (_label, respond) => {
      fetchMock.mockResolvedValue(respond());
      await expect(provider.search('x', 5, 0)).rejects.toBeInstanceOf(BadGatewayException);
    });
  });
});
