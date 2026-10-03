import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PublicUser } from '../users/user.mapper';
import { PaginationDto } from '../common/pagination.dto';
import { FriendsService } from './friends.service';

export class FriendRequestDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;
}

@ApiTags('friends')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('friends')
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Get()
  list(@CurrentUser() user: PublicUser, @Query() query: PaginationDto) {
    return this.friends.list(user.id, query);
  }

  @Get('requests')
  pending(@CurrentUser() user: PublicUser, @Query() query: PaginationDto) {
    return this.friends.pending(user.id, query);
  }

  @Post('requests')
  send(@CurrentUser() user: PublicUser, @Body() dto: FriendRequestDto) {
    return this.friends.send(user.id, dto.userId);
  }

  @Post('requests/:id/accept')
  accept(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.friends.respond(user.id, id, 'accept');
  }

  @Post('requests/:id/reject')
  reject(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.friends.respond(user.id, id, 'reject');
  }

  @Delete('requests/:id')
  cancel(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.friends.respond(user.id, id, 'cancel');
  }

  @Delete(':id')
  remove(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.friends.remove(user.id, id);
  }
}
