import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PublicUser } from '../users/user.mapper';
import { PaginationDto } from '../common/pagination.dto';
import { InvitationsService } from './invitations.service';

@ApiTags('invitations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get('me')
  list(@CurrentUser() user: PublicUser, @Query() query: PaginationDto) {
    return this.invitations.list(user.id, query);
  }

  @Post(':id/accept')
  accept(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.invitations.respond(user.id, id, true);
  }

  @Post(':id/decline')
  decline(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.invitations.respond(user.id, id, false);
  }
}
