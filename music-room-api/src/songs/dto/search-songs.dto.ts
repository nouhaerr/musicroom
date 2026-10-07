import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

// Query parameters for GET /songs/search
export class SearchSongsDto {
  @ApiProperty({ example: 'daft punk' })
  // Trimmed before validation: a blank query is a client error (400), not something to send to the catalog
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  q!: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0, description: 'Offset for pagination (number of results to skip)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  index?: number;
}
