import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { RealtimeCoreModule } from '../realtime/realtime-core.module';

@Module({ imports: [RealtimeCoreModule], controllers: [InvitationsController], providers: [InvitationsService], exports: [InvitationsService] })
export class InvitationsModule {}
