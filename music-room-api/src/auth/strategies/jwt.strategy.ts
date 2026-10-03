import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../token.types';
import { SessionsService } from '../sessions.service';
import { Request } from 'express';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService, private readonly sessions: SessionsService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET', 'dev_access_secret'),
      algorithms: ['HS256'],
      passReqToCallback: true,
    });
  }

  async validate(request: Request & { sessionId?: string }, payload: JwtPayload) {
    const user = await this.sessions.validateAccess(payload);
    request.sessionId = payload.sid;
    return user;
  }
}
