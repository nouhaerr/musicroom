import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PublicUser } from '../users/user.mapper';
import { PaginationDto } from '../common/pagination.dto';
import { FriendsService } from './friends.service';
import { DeletedResponse } from '../common/responses';
import { ProfileResponse } from '../users/dto/user.responses';
import { FriendRequestDetailResponse, FriendRequestResponse } from './dto/friend.responses';

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

  @ApiOperation({ summary: 'List your friends' })
  @ApiOkResponse({ type: [ProfileResponse] })
  @Get()
  list(@CurrentUser() user: PublicUser, @Query() query: PaginationDto): Promise<ProfileResponse[]> {
    return this.friends.list(user.id, query);
  }

  @ApiOperation({ summary: 'List the pending friend requests you sent or received' })
  @ApiOkResponse({ type: [FriendRequestDetailResponse] })
  @Get('requests')
  pending(@CurrentUser() user: PublicUser, @Query() query: PaginationDto): Promise<FriendRequestDetailResponse[]> {
    return this.friends.pending(user.id, query);
  }

  @ApiOperation({ summary: 'Send a friend request; if they already sent you one, you become friends' })
  @ApiCreatedResponse({ type: FriendRequestResponse })
  @Post('requests')
  send(@CurrentUser() user: PublicUser, @Body() dto: FriendRequestDto): Promise<FriendRequestResponse> {
    return this.friends.send(user.id, dto.userId);
  }

  @ApiOperation({ summary: 'Accept a friend request you received' })
  @ApiCreatedResponse({ type: FriendRequestResponse })
  @Post('requests/:id/accept')
  accept(@CurrentUser() user: PublicUser, @Param('id') id: string): Promise<FriendRequestResponse | DeletedResponse> {
    return this.friends.respond(user.id, id, 'accept');
  }

  @ApiOperation({ summary: 'Decline a friend request you received' })
  @ApiCreatedResponse({ type: FriendRequestResponse })
  @Post('requests/:id/reject')
  reject(@CurrentUser() user: PublicUser, @Param('id') id: string): Promise<FriendRequestResponse | DeletedResponse> {
    return this.friends.respond(user.id, id, 'reject');
  }

  @ApiOperation({ summary: 'Cancel a friend request you sent' })
  @ApiOkResponse({ type: DeletedResponse })
  @Delete('requests/:id')
  cancel(@CurrentUser() user: PublicUser, @Param('id') id: string): Promise<FriendRequestResponse | DeletedResponse> {
    return this.friends.respond(user.id, id, 'cancel');
  }

  @ApiOperation({ summary: 'Remove a friend' })
  @ApiOkResponse({ type: DeletedResponse })
  @Delete(':id')
  remove(@CurrentUser() user: PublicUser, @Param('id') id: string): Promise<DeletedResponse> {
    return this.friends.remove(user.id, id);
  }
}
