import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MinLength } from 'class-validator';
import { Platform } from '../../../generated/prisma';

export class RegisterDeviceDto {
  @ApiProperty({ enum: Platform })
  @IsEnum(Platform)
  platform!: Platform;

  @ApiProperty({ example: 'iPhone 14, Samsung Galaxy S23...' })
  @IsString()
  @MinLength(1)
  model!: string;

  @ApiProperty({ example: '1.2.0' })
  @IsString()
  @MinLength(1)
  appVersion!: string;
}
