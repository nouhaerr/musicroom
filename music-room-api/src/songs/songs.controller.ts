import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
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

  // Fresh playable URL for a stored song: call it right before playing
  @Get(':id/preview')
  getPreview(@Param('id', ParseUUIDPipe) id: string) {
    return this.songsService.getPreviewUrl(id);
  }
}
