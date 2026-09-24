import { Injectable } from '@nestjs/common';
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
    return this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        passwordHash: data.passwordHash,
        authProvider: AuthProvider.EMAIL,
      },
    });
  }

  createFromSocial(data: {
    email: string;
    name: string;
    provider: typeof AuthProvider.FACEBOOK | typeof AuthProvider.GOOGLE;
    facebookId?: string;
    googleId?: string;
  }) {
    return this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        authProvider: data.provider,
        facebookId: data.facebookId,
        googleId: data.googleId,
        // Un compte créé via un réseau social est considéré comme vérifié d'office
        emailVerifiedAt: new Date(),
      },
    });
  }

  linkFacebookAccount(userId: string, facebookId: string) {
    return this.prisma.user.update({ where: { id: userId }, data: { facebookId } });
  }

  linkGoogleAccount(userId: string, googleId: string) {
    return this.prisma.user.update({ where: { id: userId }, data: { googleId } });
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

  // updateProfile(userId: string, data: Prisma.UserUpdateInput) {
  //   return this.prisma.user.update({ where: { id: userId }, data });
  // }
  updateProfile(userId: string, dto: UpdateProfileDto) {
      const data: Prisma.UserUpdateInput = {
        ...dto,
        publicInfo: dto.publicInfo as Prisma.InputJsonValue | undefined,
        friendsOnlyInfo: dto.friendsOnlyInfo as Prisma.InputJsonValue | undefined,
        privateInfo: dto.privateInfo as Prisma.InputJsonValue | undefined,
        musicPreferences: dto.musicPreferences as Prisma.InputJsonValue | undefined,
      };

      return this.prisma.user.update({
        where: { id: userId },
        data,
      });
  }
}
