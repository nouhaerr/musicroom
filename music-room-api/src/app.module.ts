import { FriendsModule } from './friends/friends.module';
import { InvitationsModule } from './invitations/invitations.module';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { SongsModule } from './songs/songs.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.CONFIG_IGNORE_ENV_FILE === 'true',
      validate: validateEnvironment,
    }),
    // Each route: THROTTLE_LIMIT requests per minute from one IP (60 by default). The sensitive routes
    // (login, register...) keep their own stricter limit with @Throttle().
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [{ ttl: 60_000, limit: config.getOrThrow<number>('THROTTLE_LIMIT') }],
    }),
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
    SongsModule,
    RealtimeModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
