import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { SearchUsersDto } from './dto/search-users.dto';
import { Body, Controller, Get, Patch, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
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

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMe(@CurrentUser() user: PublicUser, @Body() dto: UpdateProfileDto) {
    const updated = await this.usersService.updateProfile(user.id, dto);
    return toPublicUser(updated);
  }
  @Get('search')
  search(@Query() query: SearchUsersDto) {
    return this.usersService.search(query);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  profile(@Param('id') id: string, @CurrentUser() user?: PublicUser) {
    return this.usersService.getProfile(id, user?.id);
  }
}
