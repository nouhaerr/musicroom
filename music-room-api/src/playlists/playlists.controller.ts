import { UpdateAccessDto } from './dto/update-access.dto';
import { PaginationDto } from '../common/pagination.dto';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiBearerAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags,
} from '@nestjs/swagger';
import { PlaylistsService } from './playlists.service';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { ListPlaylistsDto } from './dto/list-playlists.dto';
import { AddSongToPlaylistDto, InviteCollaboratorDto, MoveSongDto } from './dto/playlist-actions.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PublicUser } from '../users/user.mapper';
import { DeletedResponse } from '../common/responses';
import { InvitationResponse } from '../invitations/dto/invitation.responses';
import {
  PlaylistCardResponse, PlaylistInvitationResponse, PlaylistPageResponse, PlaylistResponse, PlaylistSongItemResponse,
  PlaylistSongResponse,
} from './dto/playlist.responses';

@ApiTags('playlists')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('playlists')
export class PlaylistsController {
  constructor(private readonly playlistsService: PlaylistsService) {}

  @ApiOperation({ summary: 'Create a playlist: you are its owner' })
  @ApiCreatedResponse({ type: PlaylistResponse })
  @Post()
  create(@CurrentUser() user: PublicUser, @Body() dto: CreatePlaylistDto): Promise<PlaylistResponse> {
    return this.playlistsService.create(user.id, dto);
  }

  @ApiOperation({ summary: 'List the playlists you can see: the public ones, yours and those you are invited to; newest first' })
  @ApiOkResponse({ type: [PlaylistCardResponse] })
  @Get()
  findPublic(@CurrentUser() user: PublicUser, @Query() query: ListPlaylistsDto): Promise<PlaylistCardResponse[]> {
    return this.playlistsService.findPublic(user.id, query);
  }

  @ApiOperation({ summary: 'List the playlists you own or edit with others; newest first' })
  @ApiOkResponse({ type: [PlaylistResponse] })
  @Get('mine')
  findMine(@CurrentUser() user: PublicUser, @Query() query: PaginationDto): Promise<PlaylistResponse[]> {
    return this.playlistsService.findMine(user.id, query);
  }

  @ApiOperation({ summary: 'Get a playlist page: its owner, whether you may edit it, and your invitation' })
  @ApiOkResponse({ type: PlaylistPageResponse })
  @Get(':id')
  getDetail(@CurrentUser() user: PublicUser, @Param('id') id: string): Promise<PlaylistPageResponse> {
    return this.playlistsService.getDetail(id, user.id);
  }

  @ApiOperation({ summary: 'Update playlist visibility and editing permissions (owner only)' })
  @ApiForbiddenResponse({ description: 'Owner access required' })
  @ApiBadRequestResponse({ description: 'Invalid visibility or edit license' })
  @ApiOkResponse({ type: PlaylistResponse })
  @Patch(':id/access')
  updateAccess(@CurrentUser() user: PublicUser, @Param('id') id: string, @Body() dto: UpdateAccessDto): Promise<PlaylistResponse> {
    return this.playlistsService.updateAccess(id, user.id, dto);
  }

  @ApiOperation({ summary: 'List pending and accepted invitations (owner only, paginated)' })
  @ApiForbiddenResponse({ description: 'Owner access required' })
  @ApiOkResponse({ type: [PlaylistInvitationResponse] })
  @Get(':id/invitations')
  invitations(@CurrentUser() user: PublicUser, @Param('id') id: string, @Query() query: PaginationDto): Promise<PlaylistInvitationResponse[]> {
    return this.playlistsService.listInvitations(id, user.id, query);
  }

  @ApiOperation({ summary: 'Invite someone to edit a playlist (owner only)' })
  @ApiCreatedResponse({ type: InvitationResponse })
  @Post(':id/invite')
  invite(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Body() dto: InviteCollaboratorDto,
  ): Promise<InvitationResponse> {
    return this.playlistsService.invite(id, user.id, dto.userId);
  }

  @ApiOperation({ summary: 'List the songs of a playlist in order' })
  @ApiOkResponse({ type: [PlaylistSongItemResponse] })
  @Get(':id/songs')
  getSongs(@CurrentUser() user: PublicUser, @Param('id') id: string, @Query() query: PaginationDto): Promise<PlaylistSongItemResponse[]> {
    return this.playlistsService.getSongs(id, user.id, query);
  }

  @ApiOperation({ summary: 'Add a catalog track: at the end, or at the position given' })
  @ApiCreatedResponse({ type: PlaylistSongResponse })
  @Post(':id/songs')
  addSong(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Body() dto: AddSongToPlaylistDto,
  ): Promise<PlaylistSongResponse> {
    return this.playlistsService.addSong(id, user.id, dto);
  }

  @ApiOperation({ summary: 'Move a song: send the position you last saw, refused (409) if it changed meanwhile' })
  @ApiOkResponse({ type: PlaylistSongResponse })
  @Patch(':id/songs/:playlistSongId')
  moveSong(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Param('playlistSongId') playlistSongId: string,
    @Body() dto: MoveSongDto,
  ): Promise<PlaylistSongResponse> {
    return this.playlistsService.moveSong(id, playlistSongId, user.id, dto);
  }

  @ApiOperation({ summary: 'Remove a song from a playlist' })
  @ApiOkResponse({ type: DeletedResponse })
  @Delete(':id/songs/:playlistSongId')
  removeSong(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Param('playlistSongId') playlistSongId: string,
  ): Promise<DeletedResponse> {
    return this.playlistsService.removeSong(id, playlistSongId, user.id);
  }
  @ApiOperation({ summary: 'Remove someone from a playlist: their invitation and editing rights (owner only)' })
  @ApiOkResponse({ type: DeletedResponse })
  @Delete(':id/invitations/:userId')
  removeInvite(@CurrentUser() user: PublicUser, @Param('id') id: string, @Param('userId') userId: string): Promise<DeletedResponse> {
    return this.playlistsService.removeInvite(id, user.id, userId);
  }
}
