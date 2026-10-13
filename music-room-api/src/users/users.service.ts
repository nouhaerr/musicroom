import { normalizeAvatar } from './avatar';
import { lockUsers } from '../common/locks';
import { publicProfileSelect, toPublicUser } from './user.mapper';
import { SearchUsersDto } from './dto/search-users.dto';
import { paginate } from '../common/pagination.dto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthProvider, Prisma } from '../../generated/prisma';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByFacebookId(facebookId: string) {
    return this.prisma.user.findUnique({ where: { facebookId } });
  }

  findByGoogleId(googleId: string) {
    return this.prisma.user.findUnique({ where: { googleId } });
  }

  createWithPassword(data: { email: string; name: string; passwordHash: string }) {
    return this.withUniqueConflict(() => this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        passwordHash: data.passwordHash,
        authProvider: AuthProvider.EMAIL,
      },
    }));
  }

  createFromSocial(data: {
    email: string;
    name: string;
    provider: typeof AuthProvider.FACEBOOK | typeof AuthProvider.GOOGLE;
    facebookId?: string;
    googleId?: string;
  }) {
    return this.withUniqueConflict(() => this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        authProvider: data.provider,
        facebookId: data.facebookId,
        googleId: data.googleId,
        // Un compte créé via un réseau social est considéré comme vérifié d'office
        emailVerifiedAt: new Date(),
      },
    }));
  }

  linkFacebookAccount(userId: string, facebookId: string) {
    return this.withUniqueConflict(() => this.prisma.user.update({ where: { id: userId }, data: { facebookId } }));
  }

  linkGoogleAccount(userId: string, googleId: string) {
    return this.withUniqueConflict(() => this.prisma.user.update({ where: { id: userId }, data: { googleId } }));
  }

  markEmailVerified(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  updatePassword(userId: string, passwordHash: string) {
    return this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  search(query: SearchUsersDto) {
    return this.prisma.user.findMany({
      where: {
        ...(query.q ? { OR: [{ name: { contains: query.q.trim(), mode: 'insensitive' as const } }, { username: { contains: query.q.trim().replace(/^@/, ''), mode: 'insensitive' as const } }] } : {}),
        ...(query.genre ? { musicPreferences: { has: query.genre } } : {}),
      },
      select: publicProfileSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...paginate(query),
    });
  }

  async getProfile(id: string, viewerId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (id === viewerId) return toPublicUser(user);
    const friend = viewerId ? await this.prisma.user.findFirst({
      where: { id, friends: { some: { id: viewerId } } }, select: { id: true },
    }) : null;
    return {
      id: user.id, name: user.name, username: user.username, publicInfo: user.publicInfo,
      musicPreferences: user.musicPreferences,
      ...(friend ? { friendsOnlyInfo: user.friendsOnlyInfo } : {}),
    };
  }

  updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: Prisma.UserUpdateInput = {
      ...dto,
      publicInfo: dto.publicInfo as Prisma.InputJsonValue | undefined,
      friendsOnlyInfo: dto.friendsOnlyInfo as Prisma.InputJsonValue | undefined,
      privateInfo: dto.privateInfo as Prisma.InputJsonValue | undefined,
      musicPreferences: dto.musicPreferences,
    };

    return this.withUniqueConflict(() => this.prisma.$transaction(async tx => {
      await lockUsers(tx, [userId]);
      if (dto.publicInfo) {
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const existing = user.publicInfo as Record<string, Prisma.InputJsonValue> | null;
        // Avatar mutations use the dedicated validation route, including removals.
        const info = { ...dto.publicInfo };
        delete info.avatar;
        delete info.username;
        if (existing?.avatar) info.avatar = existing.avatar;
        data.publicInfo = info as Prisma.InputJsonValue;
      }
      return tx.user.update({ where: { id: userId }, data });
    }));
  }

  async setAvatar(userId: string, input: string | null) {
    const avatar = input === null ? null : await normalizeAvatar(input);
    return this.prisma.$transaction(async tx => {
      await lockUsers(tx, [userId]);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const publicInfo = { ...(user.publicInfo as Record<string, Prisma.InputJsonValue> | null) };
      if (avatar === null) delete publicInfo.avatar;
      else publicInfo.avatar = avatar;
      return tx.user.update({ where: { id: userId }, data: { publicInfo } });
    });
  }

  private async withUniqueConflict<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        if (Array.isArray(error.meta?.target) && error.meta.target.includes('username')) {
          throw new ConflictException('This username is already taken. Choose another one.');
        }
        throw new ConflictException('This email or social account is already in use');
      }
      throw error;
    }
  }
}
