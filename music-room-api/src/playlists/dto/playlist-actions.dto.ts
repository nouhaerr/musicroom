import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class AddSongToPlaylistDto {
  @ApiProperty({ example: '67238732', description: 'Track id in the music catalog (from GET /songs/search)' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  externalId!: string;

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
