import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SearchSongsDto } from './dto/search-songs.dto';
import { SongsService } from './songs.service';

@ApiTags('songs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('songs')
export class SongsController {
  constructor(private readonly songsService: SongsService) {}

  // Search the external music catalog (Deezer)
  @Get('search')
  search(@Query() dto: SearchSongsDto) {
    return this.songsService.search(dto);
  }
}
