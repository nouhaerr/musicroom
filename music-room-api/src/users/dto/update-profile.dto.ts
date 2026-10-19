import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsObject, IsString, MaxLength, Matches, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateProfileDto {
  @ApiPropertyOptional({ nullable: true, description: 'Unique lowercase username, 3–30 letters, digits or underscores. Null clears it.' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @Matches(/^[a-z0-9_]{3,30}$/, { message: 'Username must contain 3–30 letters, numbers or underscores.' })
  username?: string | null;

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Visible to authenticated users. Up to 20 text fields, keys up to 50 characters, values up to 500.' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  publicInfo?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Friends only. Up to 20 text fields, keys up to 50 characters, values up to 500.' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  friendsOnlyInfo?: Record<string, unknown>;

  @ApiPropertyOptional({ description: "Only you. Up to 20 text fields, keys up to 50 characters, values up to 500." })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  privateInfo?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String], example: ['jazz', 'rock'] })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => Array.isArray(value) ? value.map(v => typeof v === 'string' ? v.trim().toLowerCase() : v) : value)
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(50, { each: true })
  musicPreferences?: string[];
}
