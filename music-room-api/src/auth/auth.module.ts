import { SessionsService } from './sessions.service';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { FacebookProvider } from './social/facebook.provider';
import { GoogleProvider } from './social/google.provider';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    UsersModule,
    MailModule,
    PassportModule,
    // Pas de secret par défaut ici : AuthService fournit explicitement le bon
    // secret (access vs refresh vs purpose) à chaque sign()/verify().
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [SessionsService, AuthService, LocalStrategy, JwtStrategy, FacebookProvider, GoogleProvider],
  exports: [AuthService, SessionsService],
})
export class AuthModule {}
