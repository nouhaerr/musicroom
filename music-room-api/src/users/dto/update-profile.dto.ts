import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { Prisma } from '../../../generated/prisma';;

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ description: 'Informations visibles par tous' })
  @IsOptional()
  @IsObject()
  publicInfo?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;

  @ApiPropertyOptional({ description: 'Informations visibles par les amis uniquement' })
  @IsOptional()
  @IsObject()
  friendsOnlyInfo?: Record<string, unknown>;

  @ApiPropertyOptional({ description: "Informations visibles par l'utilisateur uniquement" })
  @IsOptional()
  @IsObject()
  privateInfo?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Préférences musicales' })
  @IsOptional()
  @IsObject()
  musicPreferences?: Record<string, unknown>;
}
