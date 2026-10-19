import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { MAX_AVATAR_BASE64 } from '../avatar';

export class AvatarDto {
  @ApiProperty({ description: 'JPEG thumbnail data URI, at most 48 KB decoded. Publicly visible.' })
  @IsString()
  @MaxLength(MAX_AVATAR_BASE64 + 23)
  image!: string;
}
