import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Platform } from '../../generated/prisma';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  // Un utilisateur peut avoir plusieurs appareils ; on enregistre une entrée
  // à chaque appel (le mobile appelle ça une fois au démarrage de l'app et
  // garde le device.id retourné pour les headers X-Device-Id suivants).
  register(userId: string, data: { platform: Platform; model: string; appVersion: string }) {
    return this.prisma.device.create({
      data: { userId, platform: data.platform, model: data.model, appVersion: data.appVersion },
    });
  }

  findById(id: string) {
    return this.prisma.device.findUnique({ where: { id } });
  }

  listForUser(userId: string) {
    return this.prisma.device.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }
}
