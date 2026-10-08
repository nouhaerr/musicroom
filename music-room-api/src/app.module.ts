import { FriendsModule } from './friends/friends.module';
import { InvitationsModule } from './invitations/invitations.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MailModule } from './mail/mail.module';
import { DevicesModule } from './devices/devices.module';
import { LoggingModule } from './common/logging/logging.module';
import { PartiesModule } from './parties/parties.module';
import { PlaylistsModule } from './playlists/playlists.module';
import { validateEnvironment } from './config/environment';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    // Limite par défaut appliquée à toutes les routes : 60 requêtes / minute
    // par IP. Des limites plus strictes sont posées via @Throttle() sur les
    // routes sensibles (login, register...).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    PrismaModule,
    LoggingModule,
    MailModule,
    UsersModule,
    DevicesModule,
    AuthModule,
    FriendsModule,
    InvitationsModule,
    PartiesModule,
    PlaylistsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
