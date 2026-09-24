import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicUser } from '../../users/user.mapper';

// Toute action de l'application mobile doit générer un log côté back-end,
// avec la plateforme, l'appareil et la version d'app (V.6). Le mobile doit
// envoyer le header `X-Device-Id` obtenu via POST /devices.
@Injectable()
export class ActionLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger('ActionLog');

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();

    return next.handle().pipe(
      tap(() => void this.writeLog(request, 'success')),
      catchError((err) => {
        void this.writeLog(request, 'error', err);
        throw err;
      }),
    );
  }

  private async writeLog(
    request: { method: string; url: string; route?: { path?: string }; headers: Record<string, string | string[] | undefined>; user?: PublicUser },
    outcome: 'success' | 'error',
    err?: Error,
  ): Promise<void> {
    try {
      const deviceIdHeader = request.headers['x-device-id'];
      const deviceId = Array.isArray(deviceIdHeader) ? deviceIdHeader[0] : deviceIdHeader;

      const device = deviceId
        ? await this.prisma.device.findUnique({ where: { id: deviceId } })
        : null;

      await this.prisma.actionLog.create({
        data: {
          userId: request.user?.id,
          deviceId: device?.id,
          action: `${request.method} ${request.route?.path ?? request.url}`,
          platform: device?.platform,
          appVersion: device?.appVersion,
          metadata: outcome === 'error' && err ? { error: err.message } : undefined,
        },
      });
    } catch (logError) {
      // Un problème de logging ne doit jamais faire échouer la requête utilisateur
      this.logger.error('Impossible d\'écrire le log d\'action', logError as Error);
    }
  }
}
