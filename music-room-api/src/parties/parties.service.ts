import { InvitationsService, activeInvitation } from '../invitations/invitations.service';
import { PaginationDto, paginate } from '../common/pagination.dto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ResourceType, Visibility, VoteLicense, Party } from '../../generated/prisma';
import { distanceMeters } from '../common/geo';
import { literal } from '../common/literal';
import { CreatePartyDto } from './dto/create-party.dto';
import { ListPartiesDto } from './dto/list-parties.dto';
import { NextTrackDto, SuggestSongDto, VoteDto } from './dto/party-actions.dto';
import { SongsService } from '../songs/songs.service';
import { RealtimeService } from '../realtime/realtime.service';

// Play order of a queue: most votes first, earliest suggestion wins ties, then the id so that two
// reads always agree. Shared by GET /queue, "next" and the realtime snapshot, so they never differ.
const QUEUE_ORDER: Prisma.PartySongOrderByWithRelationInput[] = [
  { voteCount: 'desc' },
  { createdAt: 'asc' },
  { id: 'asc' },
];
// What each queue entry comes with, in GET /queue and in the realtime snapshot
const QUEUE_ENTRY = { song: true, _count: { select: { votes: true } } } satisfies Prisma.PartySongInclude;
// What each party comes with in the lists: who hosts it (id and name, nothing else) and what is playing
const PARTY_CARD = { owner: { select: { id: true, name: true } }, nowPlaying: true } satisfies Prisma.PartyInclude;

@Injectable()
export class PartiesService {
  private readonly maxSongs: number; // how many songs a queue may hold, and so how many a snapshot carries (MAX_PARTY_SONGS)

  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationsService,
    private readonly songsService: SongsService,
    private readonly realtime: RealtimeService,
    config: ConfigService,
  ) {
    this.maxSongs = config.getOrThrow<number>('MAX_PARTY_SONGS');
  }

  // -----------------------------------------------------------------
  // Création / lecture
  // -----------------------------------------------------------------
  async create(ownerId: string, dto: CreatePartyDto) {
    if (dto.voteLicense === VoteLicense.LOCATION_TIME) {
      if (dto.latitude === undefined || dto.longitude === undefined || !dto.radiusMeters) {
        throw new BadRequestException(
          'latitude, longitude and radiusMeters are required for a LOCATION_TIME license',
        );
      }
      if (!dto.voteStartsAt || !dto.voteEndsAt) {
        throw new BadRequestException('voteStartsAt and voteEndsAt are required for a LOCATION_TIME license');
      }
      const endsAt = new Date(dto.voteEndsAt);
      if (endsAt <= new Date(dto.voteStartsAt)) throw new BadRequestException('voteEndsAt must be after voteStartsAt');
      if (endsAt <= new Date()) throw new BadRequestException('The voting window is already over');
    }

    // The party and its empty queue are written together: a failure leaves neither behind
    return this.prisma.party.create({
      data: {
        owner: { connect: { id: ownerId } },
        name: dto.name,
        visibility: dto.visibility ?? Visibility.PUBLIC,
        voteLicense: dto.voteLicense ?? VoteLicense.EVERYONE,
        voteStartsAt: dto.voteStartsAt ? new Date(dto.voteStartsAt) : undefined,
        voteEndsAt: dto.voteEndsAt ? new Date(dto.voteEndsAt) : undefined,
        latitude: dto.latitude,
        longitude: dto.longitude,
        radiusMeters: dto.radiusMeters,
        partyPlaylist: { create: {} },
      },
    });
  }

  async findPublic(userId: string, query: ListPartiesDto) {
    const rooms = await this.prisma.party.findMany({
      where: {
        OR: [
          { visibility: Visibility.PUBLIC }, { ownerId: userId },
          { invitations: { some: { invitedUserId: userId, ...activeInvitation } } },
        ],
        // A search keeps the rule above: only among the rooms this user may see
        name: query.q ? { contains: literal(query.q), mode: 'insensitive' as const } : undefined,
        // The filters of the Discover page; a public room with the location & time rule matches both
        visibility: query.visibility,
        voteLicense: query.voteLicense,
      },
      include: PARTY_CARD,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...paginate(query),
    });
    // How long each current song has been playing, measured here like in the snapshot: a phone never compares clocks
    const now = Date.now();
    return rooms.map((room) => ({ ...room, playingForMs: room.nowPlayingStartedAt ? now - room.nowPlayingStartedAt.getTime() : null }));
  }

  findMine(userId: string, query: PaginationDto) {
    return this.prisma.party.findMany({
      where: { OR: [{ ownerId: userId }, { members: { some: { id: userId } } }],
        AND: [{ OR: [{ visibility: Visibility.PUBLIC }, { ownerId: userId },
          { invitations: { some: { invitedUserId: userId, ...activeInvitation } } },
        ] }],
      },
      include: PARTY_CARD,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...paginate(query),
    });
  }

  async findByIdOrThrow(id: string): Promise<Party> {
    const party = await this.prisma.party.findUnique({ where: { id } });
    if (!party) {
      throw new NotFoundException('Party not found');
    }
    return party;
  }

  async getDetail(id: string, userId: string) {
    const party = await this.findByIdOrThrow(id);
    await this.assertCanView(party, userId);
    return this.prisma.party.findUnique({ where: { id }, include: { nowPlaying: true } });
  }

  // Everything a client shows for a party (the same data as GET /parties/:id and GET /queue), read
  // as one consistent state: a change committed between two of the reads below cannot show up in
  // only some of them. The realtime gateway sends it to everyone watching the party.
  snapshot(partyId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const party = await tx.party.findUniqueOrThrow({ where: { id: partyId }, include: { nowPlaying: true } });
        const where = { partyPlaylistId: party.partyPlaylistId };
        const queue = await tx.partySong.findMany({ where, include: QUEUE_ENTRY, orderBy: QUEUE_ORDER, take: this.maxSongs });
        const queueLength = await tx.partySong.count({ where });
        // How long the current song has been playing, measured with this server's clock alone:
        // a phone must not compare its own clock with nowPlayingStartedAt, the two may differ
        const playingForMs = party.nowPlayingStartedAt ? Date.now() - party.nowPlayingStartedAt.getTime() : null;
        return { party, queue, queueLength, playingForMs };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  // -----------------------------------------------------------------
  // Membres / invitations
  // -----------------------------------------------------------------
  invite(partyId: string, inviterId: string, invitedUserId: string) {
    return this.invitations.invite(ResourceType.PARTY, partyId, inviterId, invitedUserId);
  }

  removeInvite(id: string, ownerId: string, userId: string) {
    return this.invitations.remove(ResourceType.PARTY, id, ownerId, userId);
  }

  join(partyId: string, userId: string) {
    return this.invitations.joinParty(partyId, userId);
  }

  // -----------------------------------------------------------------
  // Morceaux suggérés / file d'attente
  // -----------------------------------------------------------------
  async suggestSong(partyId: string, userId: string, dto: SuggestSongDto) {
    const party = await this.findByIdOrThrow(partyId);
    await this.assertCanView(party, userId);

    const song = await this.songsService.findOrCreateByExternalId(dto.externalId);

    try {
      const partySong = await this.prisma.$transaction(async (tx) => {
        // A queue holds at most what one snapshot holds, so everyone always sees all of it. The party stays
        // locked until the song is added: of two suggestions for the last place, the second finds the queue full.
        await tx.$queryRaw`SELECT id FROM "Party" WHERE id = ${party.id} FOR UPDATE`;
        if (await tx.partySong.count({ where: { partyPlaylistId: party.partyPlaylistId } }) >= this.maxSongs) {
          throw new ConflictException(`The queue is full (${this.maxSongs} songs). Vote for a song already in it.`);
        }
        return tx.partySong.create({
          data: { partyPlaylistId: party.partyPlaylistId, songId: song.id },
          include: { song: true },
        });
      });
      this.realtime.partyChanged(party.id);
      return partySong;
    } catch (e: unknown) {
      // Contrainte @@unique([partyPlaylistId, songId]) : le morceau a déjà été suggéré
      if (this.isUniqueConstraintError(e)) {
        throw new ConflictException('This track has already been suggested for this party');
      }
      throw e;
    }
  }

  async getQueue(partyId: string, userId: string, query: PaginationDto) {
    const party = await this.findByIdOrThrow(partyId);
    await this.assertCanView(party, userId);

    return this.prisma.partySong.findMany({
      where: { partyPlaylistId: party.partyPlaylistId },
      include: QUEUE_ENTRY,
      orderBy: QUEUE_ORDER, ...paginate(query),
    });
  }

  // Owner moves the party to the next track: the top of the queue starts playing and leaves it.
  // Optimistic lock: the client sends the playbackVersion it last saw. Every playback change
  // increments it, so a request based on an older state is refused (409) even if the same
  // song is playing again.
  async playNext(partyId: string, userId: string, dto: NextTrackDto) {
    const party = await this.findByIdOrThrow(partyId);
    if (party.ownerId !== userId) {
      throw new ForbiddenException('Only the party owner can change the track');
    }

    const playback = await this.prisma.$transaction(async (tx) => {
      // Check the version and take the next one in a single atomic statement. It also locks
      // the party row: a concurrent "next" waits here, then fails this same check.
      const { count } = await tx.party.updateMany({
        where: { id: partyId, playbackVersion: dto.expectedPlaybackVersion },
        data: { playbackVersion: { increment: 1 } },
      });
      if (count === 0) {
        throw new ConflictException('Playback has already changed: refresh the party');
      }

      const next = await tx.partySong.findFirst({
        where: { partyPlaylistId: party.partyPlaylistId },
        orderBy: QUEUE_ORDER,
      });
      if (!next) {
        // Nothing left to play: stop playback, so nobody keeps seeing a finished song as playing.
        // Read the current song inside the transaction (the row is locked by the update above),
        // not from the copy fetched before it.
        const { nowPlayingSongId } = await tx.party.findUniqueOrThrow({
          where: { id: partyId },
          select: { nowPlayingSongId: true },
        });
        if (!nowPlayingSongId) throw new ConflictException('The queue is empty');
        return tx.party.update({
          where: { id: partyId },
          data: { nowPlayingSongId: null, nowPlayingStartedAt: null },
          include: { nowPlaying: true },
        });
      }

      // Votes first, then the queue entry: the same lock order as removeVote (vote row, then
      // song row). Letting the cascade delete the votes would lock them in the opposite order
      // and can deadlock with a concurrent vote removal.
      await tx.vote.deleteMany({ where: { partySongId: next.id } });
      await tx.partySong.delete({ where: { id: next.id } });
      return tx.party.update({
        where: { id: partyId },
        data: { nowPlayingSongId: next.songId, nowPlayingStartedAt: new Date() },
        include: { nowPlaying: true },
      });
    });
    this.realtime.partyChanged(party.id);
    return playback;
  }

  // -----------------------------------------------------------------
  // Votes (le cœur de la gestion de concurrence demandée par le sujet)
  // -----------------------------------------------------------------
  async vote(partyId: string, partySongId: string, userId: string, dto: VoteDto) {
    const party = await this.findByIdOrThrow(partyId);
    await this.assertCanVote(party, userId, dto);

    const partySong = await this.prisma.partySong.findUnique({ where: { id: partySongId } });
    if (!partySong || partySong.partyPlaylistId !== party.partyPlaylistId) {
      throw new NotFoundException('Track not found in this party');
    }

    try {
      // Transaction : la ligne de vote (source de vérité "qui a voté quoi",
      // protégée par @@unique([partySongId, userId]) contre le double-vote)
      // ET le compteur dénormalisé sont mis à jour atomiquement.
      const voted = await this.prisma.$transaction(async (tx) => {
        await tx.vote.create({ data: { partySongId, userId } });
        return tx.partySong.update({
          where: { id: partySongId },
          data: { voteCount: { increment: 1 } },
          include: { song: true },
        });
      });
      this.realtime.partyChanged(party.id);
      return voted;
    } catch (e: unknown) {
      if (this.isUniqueConstraintError(e)) {
        throw new ConflictException('You have already voted for this track');
      }
      // The song left the queue (it just started playing) between the check above and this write
      if (this.isMissingRowError(e)) {
        throw new NotFoundException('Track not found in this party');
      }
      throw e;
    }
  }

  async removeVote(partyId: string, partySongId: string, userId: string) {
    const party = await this.findByIdOrThrow(partyId);
    await this.assertCanView(party, userId);

    const unvoted = await this.prisma.$transaction(async (tx) => {
      // Only a song of this party's queue: through another party's URL, the vote is not found
      const deleted = await tx.vote.deleteMany({
        where: { partySongId, userId, partySong: { partyPlaylistId: party.partyPlaylistId } },
      });
      if (deleted.count === 0) {
        throw new NotFoundException("You have not voted for this track");
      }
      return tx.partySong.update({
        where: { id: partySongId },
        data: { voteCount: { decrement: 1 } },
      });
    });
    this.realtime.partyChanged(party.id);
    return unvoted;
  }

  // The queue entries of this party the user has voted for: what the app marks as "you voted".
  // It is per user, so it cannot be in the realtime snapshot, which is the same for everyone.
  async myVotes(partyId: string, userId: string, query: PaginationDto) {
    const party = await this.findByIdOrThrow(partyId);
    await this.assertCanView(party, userId);

    const votes = await this.prisma.vote.findMany({
      where: { userId, partySong: { partyPlaylistId: party.partyPlaylistId } },
      select: { partySongId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], ...paginate(query),
    });
    return votes.map((vote) => vote.partySongId);
  }

  // -----------------------------------------------------------------
  // Autorisations
  // -----------------------------------------------------------------
  private async assertCanView(party: Party, userId: string): Promise<void> {
    if ((await this.viewers(party, [userId])).has(userId)) return;
    throw new ForbiddenException('This party is private');
  }

  // Which of these users may see the party: everyone if it is public, otherwise its owner and
  // the users with a pending or accepted invitation. The single place where this rule is written:
  // GET /parties/:id uses it for one user, the realtime gateway for everyone about to receive a snapshot.
  async viewers(party: Pick<Party, 'id' | 'ownerId' | 'visibility'>, userIds: string[]): Promise<Set<string>> {
    if (party.visibility === Visibility.PUBLIC) return new Set(userIds);
    const allowed = new Set(userIds.filter((id) => id === party.ownerId));
    const others = userIds.filter((id) => id !== party.ownerId);
    if (others.length > 0) {
      const invitations = await this.prisma.invitation.findMany({
        where: { partyId: party.id, invitedUserId: { in: others }, ...activeInvitation },
        select: { invitedUserId: true },
      });
      for (const { invitedUserId } of invitations) allowed.add(invitedUserId);
    }
    return allowed;
  }

  private async assertCanVote(party: Party, userId: string, dto: VoteDto): Promise<void> {
    await this.assertCanView(party, userId);

    switch (party.voteLicense) {
      case VoteLicense.EVERYONE:
        return;

      case VoteLicense.INVITED_ONLY:
        if (party.ownerId === userId) return;
        if (await this.isMemberOrInvited(party.id, userId)) return;
        throw new ForbiddenException('Only invited users can vote in this party');

      case VoteLicense.LOCATION_TIME: {
        const now = new Date();
        if (party.voteStartsAt && now < party.voteStartsAt) {
          throw new ForbiddenException("Voting has not started yet");
        }
        if (party.voteEndsAt && now > party.voteEndsAt) {
          throw new ForbiddenException('Voting has ended');
        }
        if (
          party.latitude === null ||
          party.longitude === null ||
          party.radiusMeters === null
        ) {
          throw new ForbiddenException("Voting area is not configured for this party");
        }
        if (dto.latitude === undefined || dto.longitude === undefined) {
          throw new BadRequestException('Your location (latitude/longitude) is required to vote');
        }
        const distance = distanceMeters(party.latitude, party.longitude, dto.latitude, dto.longitude);
        if (distance > party.radiusMeters) {
          throw new ForbiddenException("You are outside the permitted voting area");
        }
        return;
      }
    }
  }

  private async isMemberOrInvited(partyId: string, userId: string): Promise<boolean> {
    const invitation = await this.prisma.invitation.findFirst({
      where: { partyId, invitedUserId: userId, ...activeInvitation },
    });
    return Boolean(invitation);
  }

  private isUniqueConstraintError(e: unknown): boolean {
    return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
  }

  // P2003: a foreign key points to a row that no longer exists; P2025: the row to update is gone
  private isMissingRowError(e: unknown): boolean {
    const code = typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
    return code === 'P2003' || code === 'P2025';
  }
}
