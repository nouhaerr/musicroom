import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Song } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { SearchSongsDto } from './dto/search-songs.dto';
import { CatalogSearchResult, MUSIC_PROVIDER, MusicProvider } from './providers/music-provider';

const DEFAULT_LIMIT = 20;
const DEFAULT_INDEX = 0;

@Injectable()
export class SongsService {
  constructor(
    @Inject(MUSIC_PROVIDER) private readonly provider: MusicProvider,
    private readonly prisma: PrismaService,
  ) {}

  search(dto: SearchSongsDto): Promise<CatalogSearchResult> {
    return this.provider.search(dto.q, dto.limit ?? DEFAULT_LIMIT, dto.index ?? DEFAULT_INDEX);
  }

  // Returns the song from our database, importing it from the catalog on first use
  async findOrCreateByExternalId(externalId: string): Promise<Song> {
    const existing = await this.prisma.song.findUnique({ where: { externalId } });
    if (existing) return existing;

    const track = await this.provider.getTrack(externalId);
    if (!track) throw new NotFoundException('Track not found in the music catalog');

    // upsert, not create: two users adding the same new track at the same time
    // must not fail on the unique externalId constraint
    return this.prisma.song.upsert({
      where: { externalId },
      update: {},
      create: {
        externalId,
        title: track.title,
        artist: track.artist,
        durationSec: track.durationSec,
        sourceUri: track.link,
        thumbnailUrl: track.coverUrl,
      },
    });
  }
}
