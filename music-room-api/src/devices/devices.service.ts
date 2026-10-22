import { paginate, PaginationDto } from '../common/pagination.dto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Platform } from '../../generated/prisma';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  // One registration per account and installation; legacy clients without an
  // installation UUID retain the original create behavior.
  register(userId: string, data: { platform: Platform; model: string; appVersion: string; installationId?: string }) {
    if (data.installationId) {
      return this.prisma.device.upsert({
        where: { userId_installationId: { userId, installationId: data.installationId } },
        create: { userId, ...data },
        update: { platform: data.platform, model: data.model, appVersion: data.appVersion },
      });
    }
    return this.prisma.device.create({
      data: { userId, platform: data.platform, model: data.model, appVersion: data.appVersion },
    });
  }

  findById(id: string) {
    return this.prisma.device.findUnique({ where: { id } });
  }

  listForUser(userId: string, query: PaginationDto) {
    return this.prisma.device.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...paginate(query) });
  }
  async remove(userId: string, id: string) {
    const result = await this.prisma.device.deleteMany({ where: { id, userId } });
    if (!result.count) throw new NotFoundException('Device not found');
    return { deleted: true };
  }
}
