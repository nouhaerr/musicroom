import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchSongsDto } from './search-songs.dto';

// Same steps as the global ValidationPipe in main.ts: transform, then validate with a whitelist
async function check(query: Record<string, unknown>) {
  const dto = plainToInstance(SearchSongsDto, query);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, invalid: errors.map((error) => error.property) };
}

describe('SearchSongsDto', () => {
  it('accepts a query and converts the numbers sent as text in the URL', async () => {
    const { dto, invalid } = await check({ q: 'daft punk', limit: '10', index: '20' });
    expect(invalid).toEqual([]);
    expect(dto).toMatchObject({ q: 'daft punk', limit: 10, index: 20 });
  });

  it('trims the query', async () => {
    const { dto, invalid } = await check({ q: '  daft punk \t' });
    expect(invalid).toEqual([]);
    expect(dto.q).toBe('daft punk');
  });

  // Deezer answers "Wrong parameter" to these: they must be refused here (400), not become a 502
  it.each(['', ' ', '   ', '\t', '\n \t'])('refuses the blank query %j', async (q) => {
    expect((await check({ q })).invalid).toEqual(['q']);
  });

  it.each([
    ['a missing query', {}],
    ['a repeated query parameter', { q: ['a', 'b'] }],
    ['a query longer than 100 characters', { q: 'a'.repeat(101) }],
  ])('refuses %s', async (_label, query) => {
    expect((await check(query)).invalid).toEqual(['q']);
  });

  it('accepts a query of exactly 100 characters, spaces around it not counted', async () => {
    expect((await check({ q: ` ${'a'.repeat(100)} ` })).invalid).toEqual([]);
  });

  it.each(['0', '51', '-1', '1.5', 'abc', ''])('refuses limit=%j', async (limit) => {
    expect((await check({ q: 'x', limit })).invalid).toEqual(['limit']);
  });

  it.each(['-1', '1.5', 'abc'])('refuses index=%j', async (index) => {
    expect((await check({ q: 'x', index })).invalid).toEqual(['index']);
  });

  it('refuses an unknown parameter', async () => {
    expect((await check({ q: 'x', page: '2' })).invalid).toEqual(['page']);
  });
});
