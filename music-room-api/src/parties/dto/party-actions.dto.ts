import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

export class SuggestSongDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  artist!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  durationSec!: number;

  @ApiProperty({ description: 'URL/URI de lecture du morceau (catalogue externe ou fichier)' })
  @IsString()
  @MinLength(1)
  sourceUri!: string;

  @ApiPropertyOptional({ description: "Identifiant dans le catalogue externe (SDK musique)" })
  @IsOptional()
  @IsString()
  externalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;
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
