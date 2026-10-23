import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { EditLicense, Visibility } from '../../../generated/prisma';

export class CreatePlaylistDto {
  @ApiProperty({ maxLength: 100 })
  // Trimmed before validation: a name made only of spaces is refused
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ enum: Visibility, default: Visibility.PUBLIC })
  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  @ApiPropertyOptional({ enum: EditLicense, default: EditLicense.EVERYONE })
  @IsOptional()
  @IsEnum(EditLicense)
  editLicense?: EditLicense;
}
