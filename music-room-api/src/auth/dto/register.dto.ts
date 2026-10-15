import { Transform } from 'class-transformer';
import { normalizeEmail } from '../../common/email';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty()
  @Transform(({ value }) => typeof value === 'string' ? normalizeEmail(value) : value)
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8, pattern: '[0-9]', description: 'At least 8 characters including one number (0–9).' })
  @IsString()
  @MinLength(8)
  @Matches(/[0-9]/, { message: 'Password must contain at least one number (0–9).' })
  password!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}
