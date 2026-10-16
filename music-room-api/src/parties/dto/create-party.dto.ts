import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Visibility, VoteLicense } from '../../../generated/prisma';

export class CreatePartyDto {
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

  @ApiPropertyOptional({ enum: VoteLicense, default: VoteLicense.EVERYONE })
  @IsOptional()
  @IsEnum(VoteLicense)
  voteLicense?: VoteLicense;

  @ApiPropertyOptional({ description: 'Required when voteLicense is LOCATION_TIME' })
  @IsOptional()
  @IsDateString()
  voteStartsAt?: string;

  @ApiPropertyOptional({ description: 'Required when voteLicense is LOCATION_TIME; after voteStartsAt and in the future' })
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

  @ApiPropertyOptional({ description: 'Voting radius in meters around latitude/longitude', minimum: 50, maximum: 5000 })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(5000)
  radiusMeters?: number;
}
