import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { Visibility, VoteLicense } from '../../../generated/prisma';

export class CreatePartyDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ enum: Visibility, default: Visibility.PUBLIC })
  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  @ApiPropertyOptional({ enum: VoteLicense, default: VoteLicense.EVERYONE })
  @IsOptional()
  @IsEnum(VoteLicense)
  voteLicense?: VoteLicense;

  @ApiPropertyOptional({ description: 'Requis si voteLicense = LOCATION_TIME' })
  @IsOptional()
  @IsDateString()
  voteStartsAt?: string;

  @ApiPropertyOptional({ description: 'Requis si voteLicense = LOCATION_TIME' })
  @IsOptional()
  @IsDateString()
  voteEndsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ description: 'Rayon en mètres autour de latitude/longitude' })
  @IsOptional()
  @IsInt()
  radiusMeters?: number;
}
