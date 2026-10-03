import { InvitationsModule } from '../invitations/invitations.module';
import { Module } from '@nestjs/common';
import { PlaylistsService } from './playlists.service';
import { PlaylistsController } from './playlists.controller';
import { SongsModule } from '../songs/songs.module';

@Module({
  imports: [InvitationsModule, SongsModule],
  controllers: [PlaylistsController],
  providers: [PlaylistsService],
  exports: [PlaylistsService],
})
export class PlaylistsModule {}
