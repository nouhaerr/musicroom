import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PartiesService } from './parties.service';
import { CreatePartyDto } from './dto/create-party.dto';
import { InviteUserDto, SuggestSongDto, VoteDto } from './dto/party-actions.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PublicUser } from '../users/user.mapper';

@ApiTags('parties')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('parties')
export class PartiesController {
  constructor(private readonly partiesService: PartiesService) {}

  @Post()
  create(@CurrentUser() user: PublicUser, @Body() dto: CreatePartyDto) {
    return this.partiesService.create(user.id, dto);
  }

  @Get()
  findPublic() {
    return this.partiesService.findPublic();
  }

  @Get('mine')
  findMine(@CurrentUser() user: PublicUser) {
    return this.partiesService.findMine(user.id);
  }

  @Get(':id')
  getDetail(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.partiesService.getDetail(id, user.id);
  }

  @Post(':id/invite')
  invite(@CurrentUser() user: PublicUser, @Param('id') id: string, @Body() dto: InviteUserDto) {
    return this.partiesService.invite(id, user.id, dto.userId);
  }

  @Post(':id/join')
  join(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.partiesService.join(id, user.id);
  }

  @Get(':id/queue')
  getQueue(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.partiesService.getQueue(id, user.id);
  }

  @Post(':id/songs')
  suggestSong(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Body() dto: SuggestSongDto,
  ) {
    return this.partiesService.suggestSong(id, user.id, dto);
  }

  @Post(':id/songs/:partySongId/vote')
  vote(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Param('partySongId') partySongId: string,
    @Body() dto: VoteDto,
  ) {
    return this.partiesService.vote(id, partySongId, user.id, dto);
  }

  @Delete(':id/songs/:partySongId/vote')
  removeVote(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Param('partySongId') partySongId: string,
  ) {
    return this.partiesService.removeVote(id, partySongId, user.id);
  }
}
