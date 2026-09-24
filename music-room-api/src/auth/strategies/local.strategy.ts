import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({ usernameField: 'email', passwordField: 'password' });
  }

  async validate(email: string, password: string) {
    // Toute erreur ici (mauvais mdp, email non vérifié...) devient un 401/403
    // géré par Passport -> voir AuthService.validateUserCredentials
    return this.authService.validateUserCredentials(email, password);
  }
}
