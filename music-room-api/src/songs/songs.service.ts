import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Song } from '../../generated/prisma';
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
    // The same track can be written several ways (e.g. leading zeros): look it up by its canonical id
    const id = this.provider.normalizeId(externalId);
    if (!id) throw new NotFoundException('Track not found in the music catalog');

    const existing = await this.prisma.song.findUnique({ where: { externalId: id } });
    if (existing) return existing;

    const track = await this.provider.getTrack(id);
    if (!track) throw new NotFoundException('Track not found in the music catalog');

    try {
      return await this.prisma.song.create({
        data: {
          externalId: track.externalId,
          title: track.title,
          artist: track.artist,
          durationSec: track.durationSec,
          sourceUri: track.link,
          thumbnailUrl: track.coverUrl,
        },
      });
    } catch (e) {
      // Another request imported the same track between our lookup and our insert:
      // the unique externalId rejected ours, so return the row it created
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return this.prisma.song.findUniqueOrThrow({ where: { externalId: track.externalId } });
      }
      throw e;
    }
  }

  // Fresh playable URL for a stored song: catalog preview URLs expire, so they're never stored
  async getPreviewUrl(songId: string): Promise<{ songId: string; previewUrl: string }> {
    const song = await this.prisma.song.findUnique({ where: { id: songId } });
    if (!song) throw new NotFoundException('Song not found');
    if (!song.externalId) throw new NotFoundException('This song has no catalog source');

    const track = await this.provider.getTrack(song.externalId);
    if (!track?.previewUrl) throw new NotFoundException('No preview available for this song');

    return { songId: song.id, previewUrl: track.previewUrl };
  }
}
