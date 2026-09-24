import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlaylistsService } from './playlists.service';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { AddSongToPlaylistDto, InviteCollaboratorDto, MoveSongDto } from './dto/playlist-actions.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PublicUser } from '../users/user.mapper';

@ApiTags('playlists')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('playlists')
export class PlaylistsController {
  constructor(private readonly playlistsService: PlaylistsService) {}

  @Post()
  create(@CurrentUser() user: PublicUser, @Body() dto: CreatePlaylistDto) {
    return this.playlistsService.create(user.id, dto);
  }

  @Get()
  findPublic() {
    return this.playlistsService.findPublic();
  }

  @Get('mine')
  findMine(@CurrentUser() user: PublicUser) {
    return this.playlistsService.findMine(user.id);
  }

  @Get(':id')
  getDetail(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.playlistsService.getDetail(id, user.id);
  }

  @Post(':id/invite')
  invite(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Body() dto: InviteCollaboratorDto,
  ) {
    return this.playlistsService.invite(id, user.id, dto.userId);
  }

  @Get(':id/songs')
  getSongs(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.playlistsService.getSongs(id, user.id);
  }

  @Post(':id/songs')
  addSong(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Body() dto: AddSongToPlaylistDto,
  ) {
    return this.playlistsService.addSong(id, user.id, dto);
  }

  @Patch(':id/songs/:playlistSongId')
  moveSong(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Param('playlistSongId') playlistSongId: string,
    @Body() dto: MoveSongDto,
  ) {
    return this.playlistsService.moveSong(id, playlistSongId, user.id, dto);
  }

  @Delete(':id/songs/:playlistSongId')
  removeSong(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Param('playlistSongId') playlistSongId: string,
  ) {
    return this.playlistsService.removeSong(id, playlistSongId, user.id);
  }
}
