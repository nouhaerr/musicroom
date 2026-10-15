import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

export const MAX_AVATAR_BASE64 = 64_000;

/** Decode and re-encode a bounded thumbnail; never retain EXIF or arbitrary file content. */
export async function normalizeAvatar(data: string): Promise<string> {
  const prefix = 'data:image/jpeg;base64,';
  if (!data.startsWith(prefix) || data.length > prefix.length + MAX_AVATAR_BASE64) {
    throw new BadRequestException('Choose a JPEG profile photo smaller than 48 KB.');
  }
  const encoded = data.slice(prefix.length);
  if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new BadRequestException('Invalid profile photo.');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new BadRequestException('Invalid JPEG profile photo.');
  try {
    const image = sharp(bytes, { limitInputPixels: 1_048_576, failOn: 'warning' });
    const metadata = await image.metadata();
    if (metadata.format !== 'jpeg') throw new Error('Not JPEG');
    const output = await image.rotate().resize(256, 256, { fit: 'cover' }).jpeg({ quality: 70 }).toBuffer();
    const base64 = output.toString('base64');
    if (base64.length > MAX_AVATAR_BASE64) throw new Error('Too large');
    return prefix + base64;
  } catch {
    throw new BadRequestException('Invalid profile photo. Choose a smaller image and try again.');
  }
}
