import sharp from 'sharp';
import { normalizeAvatar } from './avatar';

const jpeg = async (width = 300, height = 200) => sharp({ create: { width, height, channels: 3, background: '#7055aa' } }).jpeg().toBuffer();
describe('Public profile photo validation', () => {
  it('makes a 256px JPEG and strips metadata', async () => {
    const input = await sharp(await jpeg()).withMetadata({ exif: { IFD0: { Artist: 'Private metadata' } } }).jpeg().toBuffer();
    const result = await normalizeAvatar(`data:image/jpeg;base64,${input.toString('base64')}`);
    const info = await sharp(Buffer.from(result.split(',')[1], 'base64')).metadata();
    expect(info).toMatchObject({ format: 'jpeg', width: 256, height: 256 });
    expect(info.exif).toBeUndefined();
  });
  it.each(['https://example.com/image.jpg', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,aGVsbG8=', 'data:image/jpeg;base64,////bad!', `data:image/jpeg;base64,${'a'.repeat(64_004)}`])('rejects non-photo or oversized input', async value => {
    await expect(normalizeAvatar(value)).rejects.toThrow();
  });
  it('rejects excessive decoded dimensions even with a small compressed file', async () => {
    const image = await jpeg(1100, 1100);
    await expect(normalizeAvatar(`data:image/jpeg;base64,${image.toString('base64')}`)).rejects.toThrow();
  });
});
