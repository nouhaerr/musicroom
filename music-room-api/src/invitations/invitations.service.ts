import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationStatus, Prisma, ResourceType } from '../../generated/prisma';
import { paginate, PaginationDto } from '../common/pagination.dto';

export const activeInvitation = { status: { in: [InvitationStatus.PENDING, InvitationStatus.ACCEPTED] } };

@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async resource(tx: Prisma.TransactionClient, type: ResourceType, id: string) {
    const rows = type === 'PARTY'
      ? await tx.$queryRaw<{ ownerId: string }[]>`SELECT "ownerId" FROM "Party" WHERE id = ${id} FOR UPDATE`
      : await tx.$queryRaw<{ ownerId: string }[]>`SELECT "ownerId" FROM "Playlist" WHERE id = ${id} FOR UPDATE`;
    if (!rows[0]) throw new NotFoundException('Ressource introuvable');
    return rows[0];
  }

  async invite(type: ResourceType, resourceId: string, ownerId: string, invitedUserId: string) {
    if (ownerId === invitedUserId) throw new BadRequestException('Vous êtes déjà propriétaire');
    return this.prisma.$transaction(async tx => {
      const resource = await this.resource(tx, type, resourceId);
      if (resource.ownerId !== ownerId) throw new ForbiddenException('Propriétaire requis');
      if (!await tx.user.findUnique({ where: { id: invitedUserId }, select: { id: true } })) throw new NotFoundException('Utilisateur introuvable');
      const where = type === 'PARTY' ? { partyId: resourceId, invitedUserId } : { playlistId: resourceId, invitedUserId };
      const existing = await tx.invitation.findFirst({ where });
      if (existing && ['PENDING', 'ACCEPTED'].includes(existing.status)) return existing;
      if (existing) return tx.invitation.update({ where: { id: existing.id }, data: { status: 'PENDING', createdAt: new Date(), invitedById: ownerId } });
      return tx.invitation.create({ data: { ...where, resourceType: type, invitedById: ownerId } });
    });
  }

  list(userId: string, query: PaginationDto) {
    return this.prisma.invitation.findMany({
      where: { invitedUserId: userId, ...activeInvitation },
      include: { party: { select: { id: true, name: true } }, playlist: { select: { id: true, name: true } }, invitedBy: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...paginate(query),
    });
  }

  async respond(userId: string, id: string, accept: boolean) {
    const invitation = await this.prisma.invitation.findUnique({ where: { id } });
    if (!invitation || invitation.invitedUserId !== userId) throw new NotFoundException('Invitation introuvable');
    return this.prisma.$transaction(async tx => {
      const resourceId = invitation.partyId ?? invitation.playlistId!;
      await this.resource(tx, invitation.resourceType, resourceId);
      const current = await tx.invitation.findUnique({ where: { id } });
      if (!current || current.status !== 'PENDING') throw new ConflictException('Invitation déjà traitée');
      const result = await tx.invitation.update({ where: { id }, data: { status: accept ? 'ACCEPTED' : 'DECLINED' } });
      if (accept) {
        if (invitation.resourceType === 'PARTY') {
          await tx.party.update({ where: { id: resourceId }, data: { members: { connect: { id: userId } } } });
        } else {
          await tx.playlist.update({ where: { id: resourceId }, data: { collaborators: { connect: { id: userId } } } });
        }
      }
      return result;
    });
  }

  async remove(type: ResourceType, id: string, ownerId: string, userId: string) {
    if (ownerId === userId) throw new BadRequestException('Impossible de retirer le propriétaire');
    return this.prisma.$transaction(async tx => {
      const resource = await this.resource(tx, type, id);
      if (resource.ownerId !== ownerId) throw new ForbiddenException('Propriétaire requis');
      await tx.invitation.updateMany({
        where: { invitedUserId: userId, ...(type === 'PARTY' ? { partyId: id } : { playlistId: id }) },
        data: { status: 'REVOKED' },
      });
      if (type === 'PARTY') {
        await tx.party.update({ where: { id }, data: { members: { disconnect: { id: userId } } } });
      } else {
        await tx.playlist.update({ where: { id }, data: { collaborators: { disconnect: { id: userId } } } });
      }
      return { deleted: true };
    });
  }

  async joinParty(id: string, userId: string) {
    return this.prisma.$transaction(async tx => {
      await this.resource(tx, 'PARTY', id);
      const party = await tx.party.findUniqueOrThrow({ where: { id } });
      const invitation = await tx.invitation.findFirst({ where: { partyId: id, invitedUserId: userId, ...activeInvitation } });
      if (party.visibility === 'PRIVATE' && party.ownerId !== userId && !invitation) throw new ForbiddenException('Invitation requise');
      if (invitation?.status === 'PENDING') await tx.invitation.update({ where: { id: invitation.id }, data: { status: 'ACCEPTED' } });
      return tx.party.update({ where: { id }, data: { members: { connect: { id: userId } } } });
    });
  }
}
