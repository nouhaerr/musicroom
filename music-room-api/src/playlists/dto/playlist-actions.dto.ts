import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

export class AddSongToPlaylistDto {
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

  @ApiProperty()
  @IsString()
  @MinLength(1)
  sourceUri!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiPropertyOptional({ description: 'Position cible (fractional indexing). Par défaut : à la fin.' })
  @IsOptional()
  @IsNumber()
  position?: number;
}

// Déplacement d'un morceau dans la playlist, avec verrou optimiste : le
// client doit renvoyer la position qu'il a vue en dernier (expectedPosition)
// pour détecter si quelqu'un d'autre a déplacé le morceau entre-temps.
export class MoveSongDto {
  @ApiProperty({ description: 'Nouvelle position (fractional indexing)' })
  @IsNumber()
  position!: number;

  @ApiProperty({ description: 'Dernière position connue côté client' })
  @IsNumber()
  expectedPosition!: number;
}

export class InviteCollaboratorDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;
}
