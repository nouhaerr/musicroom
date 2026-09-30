import { Module } from '@nestjs/common';
import { PartiesService } from './parties.service';
import { PartiesController } from './parties.controller';
import { SongsModule } from '../songs/songs.module';

@Module({
  imports: [SongsModule],
  controllers: [PartiesController],
  providers: [PartiesService],
  exports: [PartiesService],
})

export class PartiesModule {}
