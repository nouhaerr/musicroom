import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty()
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
  name!: string;
}
