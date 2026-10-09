import { Module } from '@nestjs/common';
import { SongsController } from './songs.controller';
import { SongsService } from './songs.service';
import { DeezerProvider } from './providers/deezer.provider';
import { MUSIC_PROVIDER } from './providers/music-provider';

@Module({
  controllers: [SongsController],
  providers: [
    SongsService,
    // The music catalog in use: swap the class here to change provider
    { provide: MUSIC_PROVIDER, useClass: DeezerProvider },
  ],
  exports: [SongsService],
})
export class SongsModule {}
