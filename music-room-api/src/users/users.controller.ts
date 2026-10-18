import { AvatarDto } from './dto/avatar.dto';
import { ProfileInputGuard } from './profile-input.guard';
import { SearchUsersDto } from './dto/search-users.dto';
import { Body, Controller, Delete, Put, Get, Patch, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PublicUser, toPublicUser } from './user.mapper';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: PublicUser) {
    return user;
  }

  @UseGuards(JwtAuthGuard, ProfileInputGuard)
  @Patch('me')
  async updateMe(@CurrentUser() user: PublicUser, @Body() dto: UpdateProfileDto) {
    const updated = await this.usersService.updateProfile(user.id, dto);
    return toPublicUser(updated);
  }
  @UseGuards(JwtAuthGuard)
  @Put('me/avatar')
  async setAvatar(@CurrentUser() user: PublicUser, @Body() dto: AvatarDto) {
    return toPublicUser(await this.usersService.setAvatar(user.id, dto.image));
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me/avatar')
  async removeAvatar(@CurrentUser() user: PublicUser) {
    return toPublicUser(await this.usersService.setAvatar(user.id, null));
  }

  @UseGuards(JwtAuthGuard)
  @ApiUnauthorizedResponse({ description: 'A valid session is required.' })
  @Get('search')
  search(@Query() query: SearchUsersDto) {
    return this.usersService.search(query);
  }

  @UseGuards(JwtAuthGuard)
  @ApiUnauthorizedResponse({ description: 'A valid session is required.' })
  @Get(':id')
  profile(@Param('id') id: string, @CurrentUser() user: PublicUser) {
    return this.usersService.getProfile(id, user.id);
  }
}
