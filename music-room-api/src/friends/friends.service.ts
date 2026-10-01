import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma';
import { lockUsers } from '../common/locks';
import { paginate, PaginationDto } from '../common/pagination.dto';
import { publicProfileSelect } from '../users/user.mapper';

@Injectable()
export class FriendsService {
  constructor(private readonly prisma: PrismaService) {}

  private async connect(tx: Prisma.TransactionClient, a: string, b: string) {
    await tx.user.update({ where: { id: a }, data: { friends: { connect: { id: b } } } });
    await tx.user.update({ where: { id: b }, data: { friends: { connect: { id: a } } } });
  }

  async send(senderId: string, receiverId: string) {
    if (senderId === receiverId) throw new BadRequestException('Impossible de vous inviter vous-même');
    return this.prisma.$transaction(async tx => {
      await lockUsers(tx, [senderId, receiverId]);
      if (!await tx.user.findUnique({ where: { id: receiverId }, select: { id: true } })) {
        throw new NotFoundException('Utilisateur introuvable');
      }
      const existing = await tx.friendRequest.findMany({ where: { OR: [
        { senderId, receiverId }, { senderId: receiverId, receiverId: senderId },
      ] } });
      if (existing.some(r => r.status === 'ACCEPTED')) throw new ConflictException('Vous êtes déjà amis');
      const reverse = existing.find(r => r.senderId === receiverId && r.status === 'PENDING');
      if (reverse) {
        const accepted = await tx.friendRequest.update({ where: { id: reverse.id }, data: { status: 'ACCEPTED' } });
        await this.connect(tx, senderId, receiverId);
        return accepted;
      }
      if (existing.some(r => r.senderId === senderId && r.status === 'PENDING')) {
        throw new ConflictException('Demande déjà envoyée');
      }
      return tx.friendRequest.upsert({
        where: { senderId_receiverId: { senderId, receiverId } },
        create: { senderId, receiverId }, update: { status: 'PENDING', createdAt: new Date() },
      });
    });
  }

  async respond(userId: string, id: string, action: 'accept' | 'reject' | 'cancel') {
    const request = await this.prisma.friendRequest.findUnique({ where: { id } });
    if (!request || (action === 'cancel' ? request.senderId : request.receiverId) !== userId) {
      throw new NotFoundException('Demande introuvable');
    }
    return this.prisma.$transaction(async tx => {
      await lockUsers(tx, [request.senderId, request.receiverId]);
      const current = await tx.friendRequest.findUnique({ where: { id } });
      if (!current || current.status !== 'PENDING') throw new ConflictException('Demande déjà traitée');
      if (action === 'cancel') {
        await tx.friendRequest.delete({ where: { id } });
        return { deleted: true };
      }
      const result = await tx.friendRequest.update({ where: { id }, data: { status: action === 'accept' ? 'ACCEPTED' : 'DECLINED' } });
      if (action === 'accept') await this.connect(tx, current.senderId, current.receiverId);
      return result;
    });
  }

  list(userId: string, query: PaginationDto) {
    return this.prisma.user.findMany({
      where: { friends: { some: { id: userId } } }, select: publicProfileSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }], ...paginate(query),
    });
  }

  pending(userId: string, query: PaginationDto) {
    return this.prisma.friendRequest.findMany({
      where: { status: 'PENDING', OR: [{ senderId: userId }, { receiverId: userId }] },
      include: { sender: { select: publicProfileSelect }, receiver: { select: publicProfileSelect } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...paginate(query),
    });
  }

  async remove(userId: string, friendId: string) {
    return this.prisma.$transaction(async tx => {
      await lockUsers(tx, [userId, friendId]);
      const friend = await tx.user.findFirst({ where: { id: friendId, friends: { some: { id: userId } } } });
      if (!friend) throw new NotFoundException('Ami introuvable');
      await tx.user.update({ where: { id: userId }, data: { friends: { disconnect: { id: friendId } } } });
      await tx.user.update({ where: { id: friendId }, data: { friends: { disconnect: { id: userId } } } });
      await tx.friendRequest.deleteMany({ where: { OR: [
        { senderId: userId, receiverId: friendId }, { senderId: friendId, receiverId: userId },
      ] } });
      return { deleted: true };
    });
  }
}
