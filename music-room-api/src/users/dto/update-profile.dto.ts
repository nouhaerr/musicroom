import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsObject, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ description: 'Informations visibles par tous' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  publicInfo?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Informations visibles par les amis uniquement' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  friendsOnlyInfo?: Record<string, unknown>;

  @ApiPropertyOptional({ description: "Informations visibles par l'utilisateur uniquement" })
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
