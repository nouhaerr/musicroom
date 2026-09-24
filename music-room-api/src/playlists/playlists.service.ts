import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EditLicense, Playlist, ResourceType, Visibility } from '../../generated/prisma';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { AddSongToPlaylistDto, MoveSongDto } from './dto/playlist-actions.dto';

@Injectable()
export class PlaylistsService {
  constructor(private readonly prisma: PrismaService) {}

  create(ownerId: string, dto: CreatePlaylistDto) {
    return this.prisma.playlist.create({
      data: {
        ownerId,
        name: dto.name,
        visibility: dto.visibility ?? Visibility.PUBLIC,
        editLicense: dto.editLicense ?? EditLicense.EVERYONE,
      },
    });
  }

  findPublic() {
    return this.prisma.playlist.findMany({
      where: { visibility: Visibility.PUBLIC },
      orderBy: { createdAt: 'desc' },
    });
  }

  findMine(userId: string) {
    return this.prisma.playlist.findMany({
      where: { OR: [{ ownerId: userId }, { collaborators: { some: { id: userId } } }] },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByIdOrThrow(id: string): Promise<Playlist> {
    const playlist = await this.prisma.playlist.findUnique({ where: { id } });
    if (!playlist) {
      throw new NotFoundException('Playlist introuvable');
    }
    return playlist;
  }

  async getDetail(id: string, userId: string) {
    const playlist = await this.findByIdOrThrow(id);
    await this.assertCanView(playlist, userId);
    return playlist;
  }

  // Inviter quelqu'un rend la playlist visible ET éditable pour lui : pas de
  // distinction fine ici, contrairement aux Party (voir note du service).
  async invite(playlistId: string, inviterId: string, invitedUserId: string) {
    const playlist = await this.findByIdOrThrow(playlistId);
    if (playlist.ownerId !== inviterId) {
      throw new ForbiddenException('Seul le propriétaire peut inviter des collaborateurs');
    }

    await this.prisma.invitation.upsert({
      where: { playlistId_invitedUserId: { playlistId, invitedUserId } },
      create: {
        resourceType: ResourceType.PLAYLIST,
        playlistId,
        invitedById: inviterId,
        invitedUserId,
      },
      update: {},
    });

    return this.prisma.playlist.update({
      where: { id: playlistId },
      data: { collaborators: { connect: { id: invitedUserId } } },
    });
  }

  // -----------------------------------------------------------------
  // Morceaux
  // -----------------------------------------------------------------
  async getSongs(playlistId: string, userId: string) {
    const playlist = await this.findByIdOrThrow(playlistId);
    await this.assertCanView(playlist, userId);

    return this.prisma.playlistSong.findMany({
      where: { playlistId },
      include: { song: true, addedBy: { select: { id: true, name: true } } },
      orderBy: { position: 'asc' },
    });
  }

  async addSong(playlistId: string, userId: string, dto: AddSongToPlaylistDto) {
    const playlist = await this.findByIdOrThrow(playlistId);
    await this.assertCanEdit(playlist, userId);

    const song = await this.findOrCreateSong(dto);
    const position = dto.position ?? (await this.nextPosition(playlistId));

    try {
      return await this.prisma.playlistSong.create({
        data: { playlistId, songId: song.id, position, addedById: userId },
        include: { song: true },
      });
    } catch (e: unknown) {
      if (this.isUniqueConstraintError(e)) {
        throw new ConflictException('Ce morceau est déjà dans la playlist');
      }
      throw e;
    }
  }

  // Déplacement avec verrou optimiste : si la position n'est plus celle que
  // le client pensait (quelqu'un d'autre a bougé le morceau entre-temps), on
  // renvoie un 409 pour que le client rafraîchisse avant de réessayer, plutôt
  // que d'écraser silencieusement le changement concurrent.
  async moveSong(playlistId: string, playlistSongId: string, userId: string, dto: MoveSongDto) {
    const playlist = await this.findByIdOrThrow(playlistId);
    await this.assertCanEdit(playlist, userId);

    const current = await this.prisma.playlistSong.findUnique({ where: { id: playlistSongId } });
    if (!current || current.playlistId !== playlistId) {
      throw new NotFoundException('Morceau introuvable dans cette playlist');
    }
    if (current.position !== dto.expectedPosition) {
      throw new ConflictException(
        'Ce morceau a été déplacé entre-temps par quelqu\'un d\'autre : rafraîchissez la playlist',
      );
    }

    return this.prisma.playlistSong.update({
      where: { id: playlistSongId },
      data: { position: dto.position },
      include: { song: true },
    });
  }

  async removeSong(playlistId: string, playlistSongId: string, userId: string) {
    const playlist = await this.findByIdOrThrow(playlistId);
    await this.assertCanEdit(playlist, userId);

    const current = await this.prisma.playlistSong.findUnique({ where: { id: playlistSongId } });
    if (!current || current.playlistId !== playlistId) {
      throw new NotFoundException('Morceau introuvable dans cette playlist');
    }

    await this.prisma.playlistSong.delete({ where: { id: playlistSongId } });
    return { deleted: true };
  }

  // -----------------------------------------------------------------
  // Autorisations
  // -----------------------------------------------------------------
  private async assertCanView(playlist: Playlist, userId: string): Promise<void> {
    if (playlist.visibility === Visibility.PUBLIC) return;
    if (playlist.ownerId === userId) return;
    if (await this.isCollaborator(playlist.id, userId)) return;
    throw new ForbiddenException('Cette playlist est privée');
  }

  private async assertCanEdit(playlist: Playlist, userId: string): Promise<void> {
    await this.assertCanView(playlist, userId);

    if (playlist.editLicense === EditLicense.EVERYONE) return;
    if (playlist.ownerId === userId) return;
    if (await this.isCollaborator(playlist.id, userId)) return;
    throw new ForbiddenException('Seuls les collaborateurs invités peuvent éditer cette playlist');
  }

  private async isCollaborator(playlistId: string, userId: string): Promise<boolean> {
    const match = await this.prisma.playlist.findFirst({
      where: { id: playlistId, collaborators: { some: { id: userId } } },
    });
    return Boolean(match);
  }

  private async nextPosition(playlistId: string): Promise<number> {
    const last = await this.prisma.playlistSong.findFirst({
      where: { playlistId },
      orderBy: { position: 'desc' },
    });
    return (last?.position ?? 0) + 1;
  }

  private async findOrCreateSong(dto: AddSongToPlaylistDto) {
    if (dto.externalId) {
      const existing = await this.prisma.song.findUnique({ where: { externalId: dto.externalId } });
      if (existing) return existing;
    }
    return this.prisma.song.create({
      data: {
        externalId: dto.externalId,
        title: dto.title,
        artist: dto.artist,
        durationSec: dto.durationSec,
        sourceUri: dto.sourceUri,
        thumbnailUrl: dto.thumbnailUrl,
      },
    });
  }

  private isUniqueConstraintError(e: unknown): boolean {
    return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
  }
}
