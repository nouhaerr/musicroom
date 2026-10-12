import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PartiesModule } from '../parties/parties.module';
import { PlaylistsModule } from '../playlists/playlists.module';
import { RealtimeCoreModule } from './realtime-core.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule, PartiesModule, PlaylistsModule, RealtimeCoreModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
