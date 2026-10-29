import { Transform } from 'class-transformer';
import { normalizeEmail } from '../../common/email';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}

export class ResendVerificationDto {
  @ApiProperty()
  @Transform(({ value }) => typeof value === 'string' ? normalizeEmail(value) : value)
  @IsEmail()
  email!: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @Transform(({ value }) => typeof value === 'string' ? normalizeEmail(value) : value)
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  token!: string;

  @ApiProperty({ minLength: 8, pattern: '[0-9]', description: 'At least 8 characters including one number (0–9).' })
  @IsString()
  @MinLength(8)
  @Matches(/[0-9]/, { message: 'Password must contain at least one number (0–9).' })
  newPassword!: string;
}

export class FacebookLoginDto {
  @ApiProperty({ description: 'Facebook access token (Android) or Limited Login authentication token (iOS)', minLength: 1, maxLength: 16384 })
  @IsString()
  @MinLength(1)
  @MaxLength(16384)
  accessToken!: string;

  @ApiPropertyOptional({ description: 'Required for iOS Limited Login; nonce passed to the Facebook SDK.' })
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  nonce?: string;
}

export class GoogleLoginDto {
  @ApiProperty({ description: 'ID token Google du SDK mobile, émis pour le client Web GOOGLE_CLIENT_ID (pas un access token Google)', minLength: 1, maxLength: 16384 })
  @IsString()
  @MinLength(1)
  @MaxLength(16384)
  idToken!: string;
}
