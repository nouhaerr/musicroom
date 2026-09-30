import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class SuggestSongDto {
  @ApiProperty({ example: '67238732', description: 'Track id in the music catalog (from GET /songs/search)' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  externalId!: string;
}

// Position GPS envoyée uniquement si la party a une licence LOCATION_TIME
export class VoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLongitude()
  longitude?: number;
}

export class InviteUserDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;
}
