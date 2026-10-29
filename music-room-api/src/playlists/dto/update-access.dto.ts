import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { EditLicense, Visibility } from '../../../generated/prisma';

export class UpdateAccessDto {
  @ApiProperty({ enum: Visibility })
  @IsEnum(Visibility)
  visibility!: Visibility;

  @ApiProperty({ enum: EditLicense })
  @IsEnum(EditLicense)
  editLicense!: EditLicense;
}
