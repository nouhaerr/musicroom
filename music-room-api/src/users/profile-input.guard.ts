import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

/** Runs before ValidationPipe: deeply nested JSON must never reach class-transformer. */
@Injectable()
export class ProfileInputGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const body = context.switchToHttp().getRequest<{ body?: Record<string, unknown> }>().body;
    for (const section of ['publicInfo', 'friendsOnlyInfo', 'privateInfo']) {
      const info = body?.[section];
      if (info === undefined) continue;
      if (!info || typeof info !== 'object' || Array.isArray(info)) {
        throw new BadRequestException(`${section} must contain short text fields.`);
      }
      // Older clients echo the photo. Ignore it, as updateProfile already does;
      // only the dedicated avatar endpoint can modify a photo.
      if (section === 'publicInfo') delete (info as Record<string, unknown>).avatar;
      const entries = Object.entries(info);
      if (entries.length > 20 || entries.some(([key, value]) =>
        key.length > 50 || typeof value !== 'string' || value.length > 500,
      )) {
        throw new BadRequestException(`${section} allows at most 20 text fields, with keys up to 50 characters and values up to 500 characters.`);
      }
    }
    return true;
  }
}
