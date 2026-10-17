import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto';
import { Visibility, VoteLicense } from '../../../generated/prisma';

// Query of GET /parties: the page, an optional part of the room name, and optional filters
export class ListPartiesDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Part of the room name, in any case', maxLength: 100 })
  // Trimmed before validation: a search made only of spaces lists every room
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: Visibility, description: 'Only the public rooms, or only the private ones this user may see' })
  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  @ApiPropertyOptional({ enum: VoteLicense, description: 'Only the rooms with this voting rule' })
  @IsOptional()
  @IsEnum(VoteLicense)
  voteLicense?: VoteLicense;
}
