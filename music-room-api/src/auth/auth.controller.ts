import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
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
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.email, dto.password, dto.name);
  }

  @Get('verify-email')
  async verifyEmail(@Query('token') token: string) {
    await this.authService.verifyEmail(token);
    return { message: 'Email vérifié avec succès' };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('resend-verification')
  async resendVerification(@Body() dto: ResendVerificationDto) {
    await this.authService.resendVerification(dto.email);
    return { message: 'Si ce compte existe, un email a été envoyé' };
  }

  // LocalAuthGuard déclenche LocalStrategy.validate() -> authService.validateUserCredentials()
  // et attache le résultat à request.user, récupéré ici via @CurrentUser()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(LocalAuthGuard)
  @Post('login')
  login(@CurrentUser() user: PublicUser) {
    return this.authService.login(user);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    return { message: 'Si ce compte existe, un email a été envoyé' };
  }

  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Mot de passe mis à jour' };
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
}
