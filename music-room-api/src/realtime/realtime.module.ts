import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PartiesModule } from '../parties/parties.module';
import { RealtimeCoreModule } from './realtime-core.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule, PartiesModule, RealtimeCoreModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
