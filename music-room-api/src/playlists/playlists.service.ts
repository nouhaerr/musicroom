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
import { RealtimeService } from '../realtime/realtime.service';

// Order of the songs of a playlist: by position, then the id so that two reads always agree.
// Shared by GET /songs and the realtime snapshot, so they never differ.
const SONG_ORDER: Prisma.PlaylistSongOrderByWithRelationInput[] = [{ position: 'asc' }, { id: 'asc' }];
// What each song of a playlist comes with, in GET /songs and in the realtime snapshot
const SONG_ENTRY = { song: true, addedBy: { select: { id: true, name: true } } } satisfies Prisma.PlaylistSongInclude;
const SNAPSHOT_SONGS_SIZE = 100; // a realtime snapshot holds as many songs as GET /songs' largest page

@Injectable()
export class PlaylistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationsService,
    private readonly songsService: SongsService,
    private readonly realtime: RealtimeService,
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

  // Everything a client shows for a playlist (the same data as GET /playlists/:id and GET /songs),
  // read as one consistent state. The realtime gateway sends it to everyone watching the playlist.
  snapshot(playlistId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const playlist = await tx.playlist.findUniqueOrThrow({ where: { id: playlistId } });
        const songs = await tx.playlistSong.findMany({ where: { playlistId }, include: SONG_ENTRY, orderBy: SONG_ORDER, take: SNAPSHOT_SONGS_SIZE });
        const songsLength = await tx.playlistSong.count({ where: { playlistId } });
        return { playlist, songs, songsLength };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
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
      include: SONG_ENTRY,
      orderBy: SONG_ORDER, ...paginate(query),
    });
  }

  async addSong(playlistId: string, userId: string, dto: AddSongToPlaylistDto) {
    const playlist = await this.findByIdOrThrow(playlistId);
    await this.assertCanEdit(playlist, userId);

    const song = await this.songsService.findOrCreateByExternalId(dto.externalId);

    try {
      const added = await this.prisma.$transaction(async (tx) => {
        const position = dto.position ?? (await this.nextPosition(tx, playlistId));
        return tx.playlistSong.create({
          data: { playlistId, songId: song.id, position, addedById: userId },
          include: { song: true },
        });
      });
      this.realtime.playlistChanged(playlistId);
      return added;
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

    const moved = await this.prisma.$transaction(async (tx) => {
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
    this.realtime.playlistChanged(playlistId);
    return moved;
  }

  async removeSong(playlistId: string, playlistSongId: string, userId: string) {
    const playlist = await this.findByIdOrThrow(playlistId);
    await this.assertCanEdit(playlist, userId);

    // One statement: of several simultaneous removals, one deletes the song and the others find nothing
    const { count } = await this.prisma.playlistSong.deleteMany({ where: { id: playlistSongId, playlistId } });
    if (count === 0) throw new NotFoundException('Morceau introuvable dans cette playlist');
    this.realtime.playlistChanged(playlistId);
    return { deleted: true };
  }

  // -----------------------------------------------------------------
  // Autorisations
  // -----------------------------------------------------------------
  private async assertCanView(playlist: Playlist, userId: string): Promise<void> {
    if ((await this.viewers(playlist, [userId])).has(userId)) return;
    throw new ForbiddenException('Cette playlist est privée');
  }

  // Which of these users may see the playlist: everyone if it is public, otherwise its owner and
  // the users with a pending or accepted invitation. The single place where this rule is written:
  // GET /playlists/:id uses it for one user, the realtime gateway for everyone about to receive a snapshot.
  async viewers(playlist: Pick<Playlist, 'id' | 'ownerId' | 'visibility'>, userIds: string[]): Promise<Set<string>> {
    if (playlist.visibility === Visibility.PUBLIC) return new Set(userIds);
    const allowed = new Set(userIds.filter((id) => id === playlist.ownerId));
    const others = userIds.filter((id) => id !== playlist.ownerId);
    if (others.length > 0) {
      const invitations = await this.prisma.invitation.findMany({
        where: { playlistId: playlist.id, invitedUserId: { in: others }, ...activeInvitation },
        select: { invitedUserId: true },
      });
      for (const { invitedUserId } of invitations) allowed.add(invitedUserId);
    }
    return allowed;
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
