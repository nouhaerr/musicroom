import { AvatarDto } from './dto/avatar.dto';
import { ProfileInputGuard } from './profile-input.guard';
import { SearchUsersDto } from './dto/search-users.dto';
import { Body, Controller, Delete, Put, Get, Patch, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PublicUser, toPublicUser } from './user.mapper';
import { AccountResponse, UserProfileResponse, UserSearchResultResponse } from './dto/user.responses';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get your own account' })
  @ApiOkResponse({ type: AccountResponse })
  @Get('me')
  me(@CurrentUser() user: PublicUser): AccountResponse {
    return user;
  }

  @UseGuards(JwtAuthGuard, ProfileInputGuard)
  @ApiOperation({ summary: 'Update your profile' })
  @ApiOkResponse({ type: AccountResponse })
  @Patch('me')
  async updateMe(@CurrentUser() user: PublicUser, @Body() dto: UpdateProfileDto): Promise<AccountResponse> {
    const updated = await this.usersService.updateProfile(user.id, dto);
    return toPublicUser(updated);
  }
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Set your profile picture' })
  @ApiOkResponse({ type: AccountResponse })
  @Put('me/avatar')
  async setAvatar(@CurrentUser() user: PublicUser, @Body() dto: AvatarDto): Promise<AccountResponse> {
    return toPublicUser(await this.usersService.setAvatar(user.id, dto.image));
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Remove your profile picture' })
  @ApiOkResponse({ type: AccountResponse })
  @Delete('me/avatar')
  async removeAvatar(@CurrentUser() user: PublicUser): Promise<AccountResponse> {
    return toPublicUser(await this.usersService.setAvatar(user.id, null));
  }

  @UseGuards(JwtAuthGuard)
  @ApiUnauthorizedResponse({ description: 'A valid session is required.' })
  @ApiOperation({ summary: 'Search people by name, @username or music genre, with where you stand with each' })
  @ApiOkResponse({ type: [UserSearchResultResponse] })
  @Get('search')
  search(@Query() query: SearchUsersDto, @CurrentUser() user: PublicUser): Promise<UserSearchResultResponse[]> {
    return this.usersService.search(query, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiUnauthorizedResponse({ description: 'A valid session is required.' })
  @ApiOperation({ summary: 'Get the profile of someone' })
  @ApiOkResponse({ type: UserProfileResponse, description: 'Your own id gives your full account, as GET /users/me' })
  @Get(':id')
  profile(@Param('id') id: string, @CurrentUser() user: PublicUser): Promise<AccountResponse | UserProfileResponse> {
    return this.usersService.getProfile(id, user.id);
  }
}
