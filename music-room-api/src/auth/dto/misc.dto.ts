import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}

export class ResendVerificationDto {
  @ApiProperty()
  @IsEmail()
  email!: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  token!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class FacebookLoginDto {
  @ApiProperty({ description: "Access token obtenu côté mobile via le SDK Facebook" })
  @IsString()
  accessToken!: string;
}

export class GoogleLoginDto {
  @ApiProperty({ description: "ID token obtenu côté mobile via le SDK Google" })
  @IsString()
  idToken!: string;
}
