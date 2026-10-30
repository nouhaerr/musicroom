import { PaginationDto } from '../common/pagination.dto';
import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PartiesService } from './parties.service';
import { CreatePartyDto } from './dto/create-party.dto';
import { ListPartiesDto } from './dto/list-parties.dto';
import { InviteUserDto, NextTrackDto, SuggestSongDto, VoteDto } from './dto/party-actions.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PublicUser } from '../users/user.mapper';
import { DeletedResponse } from '../common/responses';
import { InvitationResponse } from '../invitations/dto/invitation.responses';
import {
  PartyCardResponse, PartyDetailResponse, PartyResponse, PartySongDetailResponse, PartySongResponse, QueueEntryResponse,
} from './dto/party.responses';

@ApiTags('parties')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('parties')
export class PartiesController {
  constructor(private readonly partiesService: PartiesService) {}

  @ApiOperation({ summary: 'Create a room: you are its owner' })
  @ApiCreatedResponse({ type: PartyResponse })
  @Post()
  create(@CurrentUser() user: PublicUser, @Body() dto: CreatePartyDto): Promise<PartyResponse> {
    return this.partiesService.create(user.id, dto);
  }

  @ApiOperation({ summary: 'List the rooms you can see: the public ones, yours and those you are invited to; newest first' })
  @ApiOkResponse({ type: [PartyCardResponse] })
  @Get()
  findPublic(@CurrentUser() user: PublicUser, @Query() query: ListPartiesDto): Promise<PartyCardResponse[]> {
    return this.partiesService.findPublic(user.id, query);
  }

  @ApiOperation({ summary: 'List the rooms you own or joined; newest first' })
  @ApiOkResponse({ type: [PartyCardResponse] })
  @Get('mine')
  findMine(@CurrentUser() user: PublicUser, @Query() query: PaginationDto): Promise<PartyCardResponse[]> {
    return this.partiesService.findMine(user.id, query);
  }

  @ApiOperation({ summary: 'Get a room, with the song playing now' })
  @ApiOkResponse({ type: PartyDetailResponse })
  @Get(':id')
  getDetail(@CurrentUser() user: PublicUser, @Param('id') id: string): Promise<PartyDetailResponse | null> {
    return this.partiesService.getDetail(id, user.id);
  }

  @ApiOperation({ summary: 'Invite someone to a room (owner only)' })
  @ApiCreatedResponse({ type: InvitationResponse })
  @Post(':id/invite')
  invite(@CurrentUser() user: PublicUser, @Param('id') id: string, @Body() dto: InviteUserDto): Promise<InvitationResponse> {
    return this.partiesService.invite(id, user.id, dto.userId);
  }

  @ApiOperation({ summary: 'Join a room: a private one needs an invitation, which this accepts' })
  @ApiCreatedResponse({ type: PartyResponse })
  @Post(':id/join')
  join(@CurrentUser() user: PublicUser, @Param('id') id: string): Promise<PartyResponse> {
    return this.partiesService.join(id, user.id);
  }

  @ApiOperation({ summary: 'List the queue in play order: most votes first' })
  @ApiOkResponse({ type: [QueueEntryResponse] })
  @Get(':id/queue')
  getQueue(@CurrentUser() user: PublicUser, @Param('id') id: string, @Query() query: PaginationDto): Promise<QueueEntryResponse[]> {
    return this.partiesService.getQueue(id, user.id, query);
  }

  @ApiOperation({ summary: 'Play the next song, the top of the queue (owner only)' })
  @ApiCreatedResponse({ type: PartyDetailResponse })
  @Post(':id/next')
  playNext(@CurrentUser() user: PublicUser, @Param('id') id: string, @Body() dto: NextTrackDto): Promise<PartyDetailResponse> {
    return this.partiesService.playNext(id, user.id, dto);
  }

  @ApiOperation({ summary: 'Suggest a catalog track for the queue' })
  @ApiCreatedResponse({ type: PartySongDetailResponse })
  @Post(':id/songs')
  suggestSong(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Body() dto: SuggestSongDto,
  ): Promise<PartySongDetailResponse> {
    return this.partiesService.suggestSong(id, user.id, dto);
  }

  @ApiOperation({ summary: 'Vote for a song of the queue, once per song' })
  @ApiCreatedResponse({ type: PartySongDetailResponse })
  @Post(':id/songs/:partySongId/vote')
  vote(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Param('partySongId') partySongId: string,
    @Body() dto: VoteDto,
  ): Promise<PartySongDetailResponse> {
    return this.partiesService.vote(id, partySongId, user.id, dto);
  }

  @ApiOperation({ summary: 'Take back your vote for a song' })
  @ApiOkResponse({ type: PartySongResponse })
  @Delete(':id/songs/:partySongId/vote')
  removeVote(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Param('partySongId') partySongId: string,
  ): Promise<PartySongResponse> {
    return this.partiesService.removeVote(id, partySongId, user.id);
  }

  @ApiOperation({ summary: 'List the queue entries you voted for' })
  @Get(':id/votes/mine')
  @ApiOkResponse({
    description: 'Ids of the queue entries (partySongId) the caller has voted for in this party, oldest vote first',
    schema: { type: 'array', items: { type: 'string', format: 'uuid' } },
  })
  myVotes(@CurrentUser() user: PublicUser, @Param('id') id: string, @Query() query: PaginationDto): Promise<string[]> {
    return this.partiesService.myVotes(id, user.id, query);
  }

  @ApiOperation({ summary: 'Remove someone from a room: their invitation and membership (owner only)' })
  @ApiOkResponse({ type: DeletedResponse })
  @Delete(':id/invitations/:userId')
  removeInvite(@CurrentUser() user: PublicUser, @Param('id') id: string, @Param('userId') userId: string): Promise<DeletedResponse> {
    return this.partiesService.removeInvite(id, user.id, userId);
  }
}
