import { InvitationsModule } from '../invitations/invitations.module';
import { Module } from '@nestjs/common';
import { PartiesService } from './parties.service';
import { PartiesController } from './parties.controller';
import { SongsModule } from '../songs/songs.module';
import { RealtimeCoreModule } from '../realtime/realtime-core.module';

@Module({
  imports: [InvitationsModule, SongsModule, RealtimeCoreModule],
  controllers: [PartiesController],
  providers: [PartiesService],
  exports: [PartiesService],
})

export class PartiesModule {}
