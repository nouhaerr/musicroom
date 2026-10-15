import { BadRequestException, Body, Controller, Delete, Get, Header, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiBody, ApiTags, ApiOperation, ApiOkResponse, ApiConflictResponse } from '@nestjs/swagger';
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
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async verifyEmail(@Query('token') token: string, @Res({ passthrough: true }) response: Response) {
    try {
      await this.authService.verifyEmail(token);
    } catch (error) {
      if (!(error instanceof UnauthorizedException) && !(error instanceof BadRequestException)) throw error;
      response.status(error.getStatus());
      return this.redirectPage('Verification link unavailable', 'This link is invalid or expired. Open Sonora to request a new verification email.', this.mobileLink('login'), false);
    }
    return this.redirectPage('Email verified', 'Your email address has been confirmed. You can now log in.', this.mobileLink('verified'));
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('resend-verification')
  async resendVerification(@Body() dto: ResendVerificationDto) {
    await this.authService.resendVerification(dto.email);
    return { message: 'If this account is eligible, you will receive an email. If nothing arrives, try again later.' };
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
    return { message: 'If this account is eligible, you will receive an email. If nothing arrives, try again later.' };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Email a one-time password creation link to the signed-in social account' })
  @ApiConflictResponse({ description: 'A password is already set; use the password reset flow.' })
  @Post('password/setup')
  async requestPasswordSetup(@CurrentUser() user: PublicUser) {
    await this.authService.requestPasswordSetup(user.id);
    return { message: 'Check your email to create your password. The link expires in 30 minutes.' };
  }

  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password updated' };
  }

  @Get('reset-password')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  resetPasswordLink(@Query('token') token: string, @Res({ passthrough: true }) response: Response) {
    if (!token?.trim()) {
      response.status(400);
      return this.redirectPage('Reset link unavailable', 'Request a new password reset email from Sonora.', this.mobileLink('reset-password'), false);
    }
    return this.redirectPage('Reset your password', 'Open Sonora to choose a new password.', this.mobileLink('reset-password', token));
  }

  @Post('facebook')
  loginWithFacebook(@Body() dto: FacebookLoginDto) {
    return this.authService.loginWithFacebook(dto.accessToken, dto.nonce);
  }

  @Post('google')
  loginWithGoogle(@Body() dto: GoogleLoginDto) {
    return this.authService.loginWithGoogle(dto.idToken);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('link/facebook')
  linkFacebook(@CurrentUser() user: PublicUser, @Body() dto: FacebookLoginDto) {
    return this.authService.linkFacebook(user.id, dto.accessToken, dto.nonce);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('link/google')
  linkGoogle(@CurrentUser() user: PublicUser, @Body() dto: GoogleLoginDto) {
    return this.authService.linkGoogle(user.id, dto.idToken);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Unlink google while keeping another sign-in method' })
  @ApiOkResponse({ description: 'Updated own profile, without passwordHash. Existing sessions remain active.' })
  @ApiConflictResponse({ description: 'Cannot unlink the last usable sign-in method.' })
  @Delete('link/google')
  unlinkGoogle(@CurrentUser() user: PublicUser) {
    return this.authService.unlinkSocial(user.id, 'google');
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Unlink facebook while keeping another sign-in method' })
  @ApiOkResponse({ description: 'Updated own profile, without passwordHash. Existing sessions remain active.' })
  @ApiConflictResponse({ description: 'Cannot unlink the last usable sign-in method.' })
  @Delete('link/facebook')
  unlinkFacebook(@CurrentUser() user: PublicUser) {
    return this.authService.unlinkSocial(user.id, 'facebook');
  }

  private mobileLink(path: string, token?: string): string {
    const base = this.config.get<string>('MOBILE_DEEP_LINK', 'sonora://auth').replace(/\/$/, '');
    const url = new URL(`${base}/${path}`);
    if (token) url.searchParams.set('token', token);
    return url.href;
  }

  private redirectPage(title: string, message: string, mobileUrl: string, autoOpen = true): string {
    const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const safeUrl = escape(mobileUrl);
    const scriptUrl = JSON.stringify(mobileUrl).replace(/</g, '\\u003c');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} - Sonora</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#10141e;color:#f3f3e9;font:16px system-ui,sans-serif}.box{width:min(90vw,460px);padding:32px;border:1px solid #2d3547;border-radius:20px;background:#1b2130;text-align:center}h1{font-size:26px}p{color:#b4bdce;line-height:1.5}a{display:inline-block;margin-top:16px;padding:14px 20px;border-radius:12px;background:#b7f576;color:#16240e;font-weight:700;text-decoration:none}</style></head><body><main class="box"><h1>${escape(title)}</h1><p>${escape(message)}</p><a href="${safeUrl}">Open Sonora</a></main>${autoOpen ? `<script>window.setTimeout(function(){window.location.href=${scriptUrl};},120);</script>` : ''}</body></html>`;
  }
}
