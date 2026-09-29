import { Inject, Injectable } from '@nestjs/common';
import { SearchSongsDto } from './dto/search-songs.dto';
import { CatalogSearchResult, MUSIC_PROVIDER, MusicProvider } from './providers/music-provider';

const DEFAULT_LIMIT = 20;
const DEFAULT_INDEX = 0;

@Injectable()
export class SongsService {
  constructor(@Inject(MUSIC_PROVIDER) private readonly provider: MusicProvider) {}

  search(dto: SearchSongsDto): Promise<CatalogSearchResult> {
    return this.provider.search(dto.q, dto.limit ?? DEFAULT_LIMIT, dto.index ?? DEFAULT_INDEX);
  }
}
