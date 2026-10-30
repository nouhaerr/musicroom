import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SearchSongsDto } from './dto/search-songs.dto';
import { CatalogSearchResponse, PreviewResponse } from './dto/song.responses';
import { SongsService } from './songs.service';

@ApiTags('songs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('songs')
export class SongsController {
  constructor(private readonly songsService: SongsService) {}

  // Search the external music catalog (Deezer)
  @ApiOperation({ summary: 'Search the music catalog (Deezer)' })
  @ApiOkResponse({ type: CatalogSearchResponse })
  @Get('search')
  search(@Query() dto: SearchSongsDto): Promise<CatalogSearchResponse> {
    return this.songsService.search(dto);
  }

  // Fresh playable URL for a stored song: call it right before playing
  @ApiOperation({ summary: 'Get a fresh 30-second extract of a stored song, right before playing it' })
  @ApiOkResponse({ type: PreviewResponse })
  @Get(':id/preview')
  getPreview(@Param('id', ParseUUIDPipe) id: string): Promise<PreviewResponse> {
    return this.songsService.getPreviewUrl(id);
  }
}
