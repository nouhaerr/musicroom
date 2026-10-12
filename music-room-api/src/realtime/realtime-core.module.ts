import { Module } from '@nestjs/common';
import { RealtimeService } from './realtime.service';

// Imported by the modules that announce changes, and by RealtimeModule which delivers them
@Module({
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeCoreModule {}
