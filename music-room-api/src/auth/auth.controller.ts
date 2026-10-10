import { BadRequestException, Body, Controller, Get, Header, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  FacebookLoginDto,
  ForgotPasswordDto,
  GoogleLoginDto,
  RefreshTokenDto,
  ResendVerificationDto,
  ResetPasswordDto,
} from './dto/misc.dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { PublicUser } from '../users/user.mapper';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.email, dto.password, dto.name);
  }

  @Get('verify-email')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async verifyEmail(@Query('token') token: string) {
    await this.authService.verifyEmail(token);
    return this.redirectPage('Adresse email confirmée', 'Votre adresse email a bien été confirmée. Vous pouvez maintenant vous connecter.', this.mobileLink('verified'));
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('resend-verification')
  async resendVerification(@Body() dto: ResendVerificationDto) {
    await this.authService.resendVerification(dto.email);
    return { message: 'Si ce compte est éligible, vous recevrez un email. Si rien n’arrive, réessayez plus tard.' };
  }

  // LocalAuthGuard déclenche LocalStrategy.validate() -> authService.validateUserCredentials()
  // et attache le résultat à request.user, récupéré ici via @CurrentUser()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @ApiBody({ type: LoginDto })
  login(@CurrentUser() user: PublicUser) {
    return this.authService.login(user);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(@CurrentUser() user: PublicUser, @Req() request: { sessionId: string }) {
    return this.authService.logout(user.id, request.sessionId);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    return { message: 'Si ce compte est éligible, vous recevrez un email. Si rien n’arrive, réessayez plus tard.' };
  }

  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Mot de passe mis à jour' };
  }

  @Get('reset-password')
  @Header('Content-Type', 'text/html; charset=utf-8')
  resetPasswordLink(@Query('token') token: string) {
    if (!token?.trim()) throw new BadRequestException('Token requis');
    return this.redirectPage('Réinitialisation du mot de passe', 'Ouvrez Sonora pour choisir votre nouveau mot de passe.', this.mobileLink('reset-password', token));
  }

  @Post('facebook')
  loginWithFacebook(@Body() dto: FacebookLoginDto) {
    return this.authService.loginWithFacebook(dto.accessToken);
  }

  @Post('google')
  loginWithGoogle(@Body() dto: GoogleLoginDto) {
    return this.authService.loginWithGoogle(dto.idToken);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('link/facebook')
  linkFacebook(@CurrentUser() user: PublicUser, @Body() dto: FacebookLoginDto) {
    return this.authService.linkFacebook(user.id, dto.accessToken);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('link/google')
  linkGoogle(@CurrentUser() user: PublicUser, @Body() dto: GoogleLoginDto) {
    return this.authService.linkGoogle(user.id, dto.idToken);
  }

  private mobileLink(path: string, token?: string): string {
    const base = this.config.get<string>('MOBILE_DEEP_LINK', 'sonora://auth').replace(/\/$/, '');
    const url = new URL(`${base}/${path}`);
    if (token) url.searchParams.set('token', token);
    return url.href;
  }

  private redirectPage(title: string, message: string, mobileUrl: string): string {
    const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const safeUrl = escape(mobileUrl);
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} - Sonora</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#10141e;color:#f3f3e9;font:16px system-ui,sans-serif}.box{width:min(90vw,460px);padding:32px;border:1px solid #2d3547;border-radius:20px;background:#1b2130;text-align:center}h1{font-size:26px}p{color:#b4bdce;line-height:1.5}a{display:inline-block;margin-top:16px;padding:14px 20px;border-radius:12px;background:#b7f576;color:#16240e;font-weight:700;text-decoration:none}</style></head><body><main class="box"><h1>${escape(title)}</h1><p>${escape(message)}</p><a href="${safeUrl}">Ouvrir Sonora</a></main></body></html>`;
  }
}
