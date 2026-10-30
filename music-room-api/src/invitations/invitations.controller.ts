import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PublicUser } from '../users/user.mapper';
import { PaginationDto } from '../common/pagination.dto';
import { InvitationsService } from './invitations.service';
import { InvitationResponse, MyInvitationResponse } from './dto/invitation.responses';

@ApiTags('invitations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @ApiOperation({ summary: 'List your invitations to rooms and playlists, pending and accepted; newest first' })
  @ApiOkResponse({ type: [MyInvitationResponse] })
  @Get('me')
  list(@CurrentUser() user: PublicUser, @Query() query: PaginationDto): Promise<MyInvitationResponse[]> {
    return this.invitations.list(user.id, query);
  }

  @ApiOperation({ summary: 'Accept an invitation' })
  @ApiCreatedResponse({ type: InvitationResponse })
  @Post(':id/accept')
  accept(@CurrentUser() user: PublicUser, @Param('id') id: string): Promise<InvitationResponse> {
    return this.invitations.respond(user.id, id, true);
  }

  @ApiOperation({ summary: 'Decline an invitation' })
  @ApiCreatedResponse({ type: InvitationResponse })
  @Post(':id/decline')
  decline(@CurrentUser() user: PublicUser, @Param('id') id: string): Promise<InvitationResponse> {
    return this.invitations.respond(user.id, id, false);
  }
}
