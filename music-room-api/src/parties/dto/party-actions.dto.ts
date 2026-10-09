import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

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

// Body of POST /parties/:id/next: the playback version the client last saw (optimistic lock)
export class NextTrackDto {
  @ApiProperty({ example: 0, description: "The party's playbackVersion as last seen by the client (0 before the first song)" })
  @IsInt()
  @Min(0)
  @Max(2147483647) // the column is a 32-bit integer: a larger value must be a 400, not a database error
  expectedPlaybackVersion!: number;
}
