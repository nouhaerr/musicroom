import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { toPublicUser, PublicUser } from '../users/user.mapper';
import { AuthProvider, User } from '../../generated/prisma';
import { JwtPayload, TokenType } from './token.types';
import { FacebookProvider } from './social/facebook.provider';
import { GoogleProvider } from './social/google.provider';

const SALT_ROUNDS = 12;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly facebookProvider: FacebookProvider,
    private readonly googleProvider: GoogleProvider,
  ) {}

  // ---------------------------------------------------------------------
  // Inscription email / mot de passe
  // ---------------------------------------------------------------------
  async register(email: string, password: string, name: string): Promise<PublicUser> {
    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      throw new ConflictException('Un compte existe déjà avec cet email');
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await this.usersService.createWithPassword({ email, name, passwordHash });

    await this.sendVerificationEmail(user);

    return toPublicUser(user);
  }

  async sendVerificationEmail(user: User): Promise<void> {
    const token = this.signPurposeToken(user, 'email-verification', '24h');
    await this.mailService.sendVerificationEmail(user.email, token);
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    // On ne révèle jamais si l'email existe ou non (anti-énumération de comptes)
    if (user && !user.emailVerifiedAt) {
      await this.sendVerificationEmail(user);
    }
  }

  async verifyEmail(token: string): Promise<void> {
    const payload = this.verifyPurposeToken(token, 'email-verification');
    await this.usersService.markEmailVerified(payload.sub);
  }

  // ---------------------------------------------------------------------
  // Login email / mot de passe (appelé par LocalStrategy)
  // ---------------------------------------------------------------------
  async validateUserCredentials(email: string, password: string): Promise<PublicUser> {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Email ou mot de passe invalide');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Email ou mot de passe invalide');
    }

    if (!user.emailVerifiedAt) {
      throw new ForbiddenException(
        "Email non vérifié : consultez votre boîte mail pour valider votre compte",
      );
    }

    return toPublicUser(user);
  }

  login(user: PublicUser): AuthTokens & { user: PublicUser } {
    return { ...this.issueTokens(user.id, user.email), user };
  }

  // ---------------------------------------------------------------------
  // Rafraîchissement de token
  // ---------------------------------------------------------------------
  async refreshTokens(refreshToken: string): Promise<AuthTokens & { user: PublicUser }> {
    const payload = this.verifyPurposeToken(refreshToken, 'refresh');
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable');
    }
    return { ...this.issueTokens(user.id, user.email), user: toPublicUser(user) };
  }

  // ---------------------------------------------------------------------
  // Mot de passe oublié
  // ---------------------------------------------------------------------
  async forgotPassword(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (user && user.passwordHash) {
      const token = this.signPurposeToken(user, 'password-reset', '30m');
      await this.mailService.sendPasswordResetEmail(user.email, token);
    }
    // Réponse générique quoi qu'il arrive côté contrôleur (anti-énumération)
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const payload = this.verifyPurposeToken(token, 'password-reset');
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.usersService.updatePassword(payload.sub, passwordHash);
  }

  // ---------------------------------------------------------------------
  // OAuth Facebook / Google (token vérifié, envoyé par le SDK mobile)
  // ---------------------------------------------------------------------
  async loginWithFacebook(accessToken: string): Promise<AuthTokens & { user: PublicUser }> {
    const profile = await this.facebookProvider.verify(accessToken);
    let user = await this.usersService.findByFacebookId(profile.providerId);

    if (!user) {
      user = await this.usersService.findByEmail(profile.email);
      if (user) {
        user = await this.usersService.linkFacebookAccount(user.id, profile.providerId);
      } else {
        user = await this.usersService.createFromSocial({
          email: profile.email,
          name: profile.name,
          provider: AuthProvider.FACEBOOK,
          facebookId: profile.providerId,
        });
      }
    }

    return { ...this.issueTokens(user.id, user.email), user: toPublicUser(user) };
  }

  async loginWithGoogle(idToken: string): Promise<AuthTokens & { user: PublicUser }> {
    const profile = await this.googleProvider.verify(idToken);
    let user = await this.usersService.findByGoogleId(profile.providerId);

    if (!user) {
      user = await this.usersService.findByEmail(profile.email);
      if (user) {
        user = await this.usersService.linkGoogleAccount(user.id, profile.providerId);
      } else {
        user = await this.usersService.createFromSocial({
          email: profile.email,
          name: profile.name,
          provider: AuthProvider.GOOGLE,
          googleId: profile.providerId,
        });
      }
    }

    return { ...this.issueTokens(user.id, user.email), user: toPublicUser(user) };
  }

  // Lier un compte réseau social à un compte déjà authentifié (V.1 : "the
  // application must allow them to link their network account")
  async linkFacebook(userId: string, accessToken: string): Promise<PublicUser> {
    const profile = await this.facebookProvider.verify(accessToken);
    const owner = await this.usersService.findByFacebookId(profile.providerId);
    if (owner && owner.id !== userId) {
      throw new ConflictException('Ce compte Facebook est déjà lié à un autre utilisateur');
    }
    const user = await this.usersService.linkFacebookAccount(userId, profile.providerId);
    return toPublicUser(user);
  }

  async linkGoogle(userId: string, idToken: string): Promise<PublicUser> {
    const profile = await this.googleProvider.verify(idToken);
    const owner = await this.usersService.findByGoogleId(profile.providerId);
    if (owner && owner.id !== userId) {
      throw new ConflictException('Ce compte Google est déjà lié à un autre utilisateur');
    }
    const user = await this.usersService.linkGoogleAccount(userId, profile.providerId);
    return toPublicUser(user);
  }

  // ---------------------------------------------------------------------
  // Helpers JWT
  // ---------------------------------------------------------------------
  private issueTokens(userId: string, email: string): AuthTokens {
    const accessToken = this.signToken(
      { sub: userId, email, type: 'access' },
      this.config.get<string>('JWT_ACCESS_SECRET', 'dev_access_secret'),
      this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
    );
    const refreshToken = this.signToken(
      { sub: userId, email, type: 'refresh' },
      this.config.get<string>('JWT_REFRESH_SECRET', 'dev_refresh_secret'),
      this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
    );
    return { accessToken, refreshToken };
  }

  private signPurposeToken(user: User, type: TokenType, expiresIn: string): string {
    const secret =
      type === 'refresh'
        ? this.config.get<string>('JWT_REFRESH_SECRET', 'dev_refresh_secret')
        : this.config.get<string>('JWT_ACCESS_SECRET', 'dev_access_secret');
    return this.signToken({ sub: user.id, email: user.email, type }, secret, expiresIn);
  }

  private signToken(payload: JwtPayload, secret: string, expiresIn: string): string {
    return this.jwtService.sign(payload, { secret, expiresIn });
  }

  private verifyPurposeToken(token: string, expectedType: TokenType): JwtPayload {
    const secret =
      expectedType === 'refresh'
        ? this.config.get<string>('JWT_REFRESH_SECRET', 'dev_refresh_secret')
        : this.config.get<string>('JWT_ACCESS_SECRET', 'dev_access_secret');

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token, { secret });
    } catch {
      throw new UnauthorizedException('Token invalide ou expiré');
    }

    if (payload.type !== expectedType) {
      throw new UnauthorizedException('Type de token invalide');
    }
    return payload;
  }
}
