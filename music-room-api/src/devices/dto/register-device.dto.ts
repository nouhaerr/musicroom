import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString, MinLength, IsOptional, IsUUID, MaxLength } from 'class-validator';
import { Platform } from '../../../generated/prisma';

export class RegisterDeviceDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Stable app installation ID; registration is unique per user and installation.' })
  @IsOptional()
  @IsUUID()
  installationId?: string;

  @ApiProperty({ enum: Platform })
  @IsEnum(Platform)
  platform!: Platform;

  @ApiProperty({ example: 'iPhone 14, Samsung Galaxy S23...' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  model!: string;

  @ApiProperty({ example: '1.2.0' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  appVersion!: string;
}
