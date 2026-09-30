import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ResourceType, Visibility, VoteLicense, Party } from '../../generated/prisma';
import { distanceMeters } from '../common/geo';
import { CreatePartyDto } from './dto/create-party.dto';
import { SuggestSongDto, VoteDto } from './dto/party-actions.dto';
import { SongsService } from '../songs/songs.service';

@Injectable()
export class PartiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly songsService: SongsService
  ) {}

  // -----------------------------------------------------------------
  // Création / lecture
  // -----------------------------------------------------------------
  async create(ownerId: string, dto: CreatePartyDto) {
    if (dto.voteLicense === VoteLicense.LOCATION_TIME) {
      if (dto.latitude === undefined || dto.longitude === undefined || !dto.radiusMeters) {
        throw new BadRequestException(
          'latitude, longitude et radiusMeters sont requis pour une licence LOCATION_TIME',
        );
      }
    }

    // Un Party dépend d'un PartyPlaylist déjà existant (FK obligatoire) :
    // on crée donc la playlist vide en premier.
    const partyPlaylist = await this.prisma.partyPlaylist.create({ data: {} });

    return this.prisma.party.create({
      data: {
        ownerId,
        name: dto.name,
        visibility: dto.visibility ?? Visibility.PUBLIC,
        voteLicense: dto.voteLicense ?? VoteLicense.EVERYONE,
        voteStartsAt: dto.voteStartsAt ? new Date(dto.voteStartsAt) : undefined,
        voteEndsAt: dto.voteEndsAt ? new Date(dto.voteEndsAt) : undefined,
        latitude: dto.latitude,
        longitude: dto.longitude,
        radiusMeters: dto.radiusMeters,
        partyPlaylistId: partyPlaylist.id,
      },
    });
  }

  findPublic() {
    return this.prisma.party.findMany({
      where: { visibility: Visibility.PUBLIC },
      orderBy: { createdAt: 'desc' },
    });
  }

  findMine(userId: string) {
    return this.prisma.party.findMany({
      where: { OR: [{ ownerId: userId }, { members: { some: { id: userId } } }] },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByIdOrThrow(id: string): Promise<Party> {
    const party = await this.prisma.party.findUnique({ where: { id } });
    if (!party) {
      throw new NotFoundException('Événement introuvable');
    }
    return party;
  }

  async getDetail(id: string, userId: string) {
    const party = await this.findByIdOrThrow(id);
    await this.assertCanView(party, userId);
    return party;
  }

  // -----------------------------------------------------------------
  // Membres / invitations
  // -----------------------------------------------------------------
  async invite(partyId: string, inviterId: string, invitedUserId: string) {
    const party = await this.findByIdOrThrow(partyId);
    if (party.ownerId !== inviterId) {
      throw new ForbiddenException("Seul le créateur de l'événement peut inviter");
    }
    return this.prisma.invitation.upsert({
      where: { partyId_invitedUserId: { partyId, invitedUserId } },
      create: {
        resourceType: ResourceType.PARTY,
        partyId,
        invitedById: inviterId,
        invitedUserId,
      },
      update: {},
    });
  }

  async join(partyId: string, userId: string) {
    const party = await this.findByIdOrThrow(partyId);
    await this.assertCanView(party, userId);
    return this.prisma.party.update({
      where: { id: partyId },
      data: { members: { connect: { id: userId } } },
    });
  }

  // -----------------------------------------------------------------
  // Morceaux suggérés / file d'attente
  // -----------------------------------------------------------------
  async suggestSong(partyId: string, userId: string, dto: SuggestSongDto) {
    const party = await this.findByIdOrThrow(partyId);
    await this.assertCanView(party, userId);

    const song = await this.songsService.findOrCreateByExternalId(dto.externalId);

    try {
      return await this.prisma.partySong.create({
        data: { partyPlaylistId: party.partyPlaylistId, songId: song.id },
        include: { song: true },
      });
    } catch (e: unknown) {
      // Contrainte @@unique([partyPlaylistId, songId]) : le morceau a déjà été suggéré
      if (this.isUniqueConstraintError(e)) {
        throw new ConflictException('Ce morceau a déjà été suggéré pour cet événement');
      }
      throw e;
    }
  }

  async getQueue(partyId: string, userId: string) {
    const party = await this.findByIdOrThrow(partyId);
    await this.assertCanView(party, userId);

    return this.prisma.partySong.findMany({
      where: { partyPlaylistId: party.partyPlaylistId },
      include: { song: true, _count: { select: { votes: true } } },
      orderBy: [{ voteCount: 'desc' }, { createdAt: 'asc' }],
    });
  }

  // -----------------------------------------------------------------
  // Votes (le cœur de la gestion de concurrence demandée par le sujet)
  // -----------------------------------------------------------------
  async vote(partyId: string, partySongId: string, userId: string, dto: VoteDto) {
    const party = await this.findByIdOrThrow(partyId);
    await this.assertCanVote(party, userId, dto);

    const partySong = await this.prisma.partySong.findUnique({ where: { id: partySongId } });
    if (!partySong || partySong.partyPlaylistId !== party.partyPlaylistId) {
      throw new NotFoundException('Morceau introuvable dans cet événement');
    }

    try {
      // Transaction : la ligne de vote (source de vérité "qui a voté quoi",
      // protégée par @@unique([partySongId, userId]) contre le double-vote)
      // ET le compteur dénormalisé sont mis à jour atomiquement.
      return await this.prisma.$transaction(async (tx) => {
        await tx.vote.create({ data: { partySongId, userId } });
        return tx.partySong.update({
          where: { id: partySongId },
          data: { voteCount: { increment: 1 } },
          include: { song: true },
        });
      });
    } catch (e: unknown) {
      if (this.isUniqueConstraintError(e)) {
        throw new ConflictException('Vous avez déjà voté pour ce morceau');
      }
      throw e;
    }
  }

  async removeVote(partyId: string, partySongId: string, userId: string) {
    const party = await this.findByIdOrThrow(partyId);
    await this.assertCanView(party, userId);

    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.vote.deleteMany({ where: { partySongId, userId } });
      if (deleted.count === 0) {
        throw new NotFoundException("Vous n'avez pas voté pour ce morceau");
      }
      return tx.partySong.update({
        where: { id: partySongId },
        data: { voteCount: { decrement: 1 } },
      });
    });
  }

  // -----------------------------------------------------------------
  // Autorisations
  // -----------------------------------------------------------------
  private async assertCanView(party: Party, userId: string): Promise<void> {
    if (party.visibility === Visibility.PUBLIC) return;
    if (party.ownerId === userId) return;
    if (await this.isMemberOrInvited(party.id, userId)) return;
    throw new ForbiddenException('Cet événement est privé');
  }

  private async assertCanVote(party: Party, userId: string, dto: VoteDto): Promise<void> {
    await this.assertCanView(party, userId);

    switch (party.voteLicense) {
      case VoteLicense.EVERYONE:
        return;

      case VoteLicense.INVITED_ONLY:
        if (party.ownerId === userId) return;
        if (await this.isMemberOrInvited(party.id, userId)) return;
        throw new ForbiddenException('Seuls les invités peuvent voter pour cet événement');

      case VoteLicense.LOCATION_TIME: {
        const now = new Date();
        if (party.voteStartsAt && now < party.voteStartsAt) {
          throw new ForbiddenException("Le vote n'a pas encore commencé");
        }
        if (party.voteEndsAt && now > party.voteEndsAt) {
          throw new ForbiddenException('Le vote est terminé');
        }
        if (
          party.latitude === null ||
          party.longitude === null ||
          party.radiusMeters === null
        ) {
          throw new ForbiddenException("Zone de vote non configurée pour cet événement");
        }
        if (dto.latitude === undefined || dto.longitude === undefined) {
          throw new BadRequestException('Votre position (latitude/longitude) est requise pour voter');
        }
        const distance = distanceMeters(party.latitude, party.longitude, dto.latitude, dto.longitude);
        if (distance > party.radiusMeters) {
          throw new ForbiddenException("Vous n'êtes pas dans la zone autorisée pour voter");
        }
        return;
      }
    }
  }

  private async isMemberOrInvited(partyId: string, userId: string): Promise<boolean> {
    const [member, invitation] = await Promise.all([
      this.prisma.party.findFirst({ where: { id: partyId, members: { some: { id: userId } } } }),
      this.prisma.invitation.findUnique({
        where: { partyId_invitedUserId: { partyId, invitedUserId: userId } },
      }),
    ]);
    return Boolean(member || invitation);
  }

  private isUniqueConstraintError(e: unknown): boolean {
    return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
  }
}
