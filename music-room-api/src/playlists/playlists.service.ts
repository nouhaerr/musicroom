import { InvitationsService, activeInvitation } from '../invitations/invitations.service';
import { PaginationDto, paginate } from '../common/pagination.dto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SongsService } from '../songs/songs.service';
import { EditLicense, Playlist, Prisma, ResourceType, Visibility } from '../../generated/prisma';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { AddSongToPlaylistDto, MoveSongDto } from './dto/playlist-actions.dto';

@Injectable()
export class PlaylistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationsService,
    private readonly songsService: SongsService,
  ) {}

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

  findPublic(userId: string, query: PaginationDto) {
    return this.prisma.playlist.findMany({
      where: { OR: [
        { visibility: Visibility.PUBLIC }, { ownerId: userId },
        { invitations: { some: { invitedUserId: userId, ...activeInvitation } } },
      ] },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...paginate(query),
    });
  }

  findMine(userId: string, query: PaginationDto) {
    return this.prisma.playlist.findMany({
      where: { OR: [{ ownerId: userId }, { collaborators: { some: { id: userId } } }],
        AND: [{ OR: [{ visibility: Visibility.PUBLIC }, { ownerId: userId },
          { invitations: { some: { invitedUserId: userId, ...activeInvitation } } },
        ] }],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...paginate(query),
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

  // Une invitation rend la playlist visible ; son acceptation ajoute le collaborateur.
  invite(playlistId: string, inviterId: string, invitedUserId: string) {
    return this.invitations.invite(ResourceType.PLAYLIST, playlistId, inviterId, invitedUserId);
  }

  removeInvite(id: string, ownerId: string, userId: string) {
    return this.invitations.remove(ResourceType.PLAYLIST, id, ownerId, userId);
  }

  // -----------------------------------------------------------------
  // Morceaux
  // -----------------------------------------------------------------
  async getSongs(playlistId: string, userId: string, query: PaginationDto) {
    const playlist = await this.findByIdOrThrow(playlistId);
    await this.assertCanView(playlist, userId);

    return this.prisma.playlistSong.findMany({
      where: { playlistId },
      include: { song: true, addedBy: { select: { id: true, name: true } } },
      orderBy: [{ position: 'asc' }, { id: 'asc' }], ...paginate(query),
    });
  }

  async addSong(playlistId: string, userId: string, dto: AddSongToPlaylistDto) {
    const playlist = await this.findByIdOrThrow(playlistId);
    await this.assertCanEdit(playlist, userId);

    const song = await this.songsService.findOrCreateByExternalId(dto.externalId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const position = dto.position ?? (await this.nextPosition(tx, playlistId));
        return tx.playlistSong.create({
          data: { playlistId, songId: song.id, position, addedById: userId },
          include: { song: true },
        });
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

    return this.prisma.$transaction(async (tx) => {
      // The position the client saw is checked by the same statement that moves the song: of
      // several simultaneous moves of one song, the database lets exactly one find it there
      const { count } = await tx.playlistSong.updateMany({
        where: { id: playlistSongId, playlistId, position: dto.expectedPosition },
        data: { position: dto.position },
      });
      // After a move the row stays locked until the transaction ends, so it cannot be removed
      // before it is read here. Without a move, this read tells "gone" from "moved by someone else".
      const current = await tx.playlistSong.findFirst({ where: { id: playlistSongId, playlistId }, include: { song: true } });
      if (!current) throw new NotFoundException('Morceau introuvable dans cette playlist');
      if (count === 0) {
        throw new ConflictException(
          'Ce morceau a été déplacé entre-temps par quelqu\'un d\'autre : rafraîchissez la playlist',
        );
      }
      return current;
    });
  }

  async removeSong(playlistId: string, playlistSongId: string, userId: string) {
    const playlist = await this.findByIdOrThrow(playlistId);
    await this.assertCanEdit(playlist, userId);

    // One statement: of several simultaneous removals, one deletes the song and the others find nothing
    const { count } = await this.prisma.playlistSong.deleteMany({ where: { id: playlistSongId, playlistId } });
    if (count === 0) throw new NotFoundException('Morceau introuvable dans cette playlist');
    return { deleted: true };
  }

  // -----------------------------------------------------------------
  // Autorisations
  // -----------------------------------------------------------------
  private async assertCanView(playlist: Playlist, userId: string): Promise<void> {
    if (playlist.visibility === Visibility.PUBLIC) return;
    if (playlist.ownerId === userId) return;
    if (await this.prisma.invitation.findFirst({
      where: { playlistId: playlist.id, invitedUserId: userId, ...activeInvitation },
    })) return;
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

  // The position after the last song. It locks the playlist until the transaction ends: a second
  // addition "at the end" waits here, then reads the song the first one inserted. Without the
  // lock, simultaneous additions all read the same last position.
  private async nextPosition(tx: Prisma.TransactionClient, playlistId: string): Promise<number> {
    await tx.$queryRaw`SELECT id FROM "Playlist" WHERE id = ${playlistId} FOR UPDATE`;
    const last = await tx.playlistSong.findFirst({
      where: { playlistId },
      orderBy: { position: 'desc' },
    });
    return (last?.position ?? 0) + 1;
  }

  private isUniqueConstraintError(e: unknown): boolean {
    return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
  }
}
