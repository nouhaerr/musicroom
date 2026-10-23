import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto';
import { Visibility } from '../../../generated/prisma';

// Query of GET /playlists: the page, an optional part of the playlist name, and an optional filter
export class ListPlaylistsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Part of the playlist name, in any case', maxLength: 100 })
  // Trimmed before validation: a search made only of spaces lists every playlist
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: Visibility, description: 'Only the public playlists, or only the private ones this user may see' })
  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;
}
