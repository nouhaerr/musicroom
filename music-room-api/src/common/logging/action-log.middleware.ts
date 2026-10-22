import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicUser } from '../../users/user.mapper';

type LoggedRequest = Request & { user?: PublicUser };

// Headers describe the client; they never establish identity or device ownership.
function metadataHeader(request: Request, name: string, limit: number): string | undefined {
  const value = request.headers[name];
  if (typeof value !== 'string') return undefined;
  try {
    const decoded = Array.from(decodeURIComponent(value)).filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('').trim();
    return decoded.slice(0, limit) || undefined;
  } catch { return undefined; }
}

@Injectable()
export class ActionLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger('ActionLog');
  constructor(private readonly prisma: PrismaService) {}

  use(request: LoggedRequest, response: Response, next: NextFunction): void {
    response.once('finish', () => { void this.writeLog(request, response.statusCode); });
    next();
  }

  private async writeLog(request: LoggedRequest, statusCode: number): Promise<void> {
    try {
      const deviceId = metadataHeader(request, 'x-device-id', 100);
      const device = deviceId && request.user
        ? await this.prisma.device.findFirst({ where: { id: deviceId, userId: request.user.id } })
        : null;
      const platform = metadataHeader(request, 'x-device-platform', 20);
      const model = metadataHeader(request, 'x-device-model', 200);
      const version = metadataHeader(request, 'x-app-version', 50);
      // Only route templates: never bodies, query strings, tokens or error messages.
      const route = typeof request.route?.path === 'string' ? request.route.path : '[unmatched]';
      await this.prisma.actionLog.create({ data: {
        userId: request.user?.id,
        deviceId: device?.id,
        action: `${request.method} ${route}`,
        platform: platform === 'IOS' || platform === 'ANDROID' ? platform : device?.platform,
        appVersion: version ?? device?.appVersion,
        metadata: {
          statusCode,
          outcome: statusCode >= 400 ? 'error' : 'success',
          deviceModel: model ?? device?.model ?? null,
          deviceOwnershipVerified: Boolean(device),
          metadataSource: model || version || platform ? 'client_headers' : 'device_record',
        },
      } });
    } catch {
      // Do not leak database parameters or credentials through logging failures.
      this.logger.error('Unable to write action log');
    }
  }
}
