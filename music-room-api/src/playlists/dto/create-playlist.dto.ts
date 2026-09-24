import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { EditLicense, Visibility } from '../../../generated/prisma';

export class CreatePlaylistDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
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
