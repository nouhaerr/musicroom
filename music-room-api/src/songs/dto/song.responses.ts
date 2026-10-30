import { ApiProperty } from '@nestjs/swagger';

// A song stored in our database, as a room's queue or a playlist holds it
export class SongResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Its id in the music catalog (Deezer)', example: '3135556' })
  externalId!: string | null;

  @ApiProperty({ example: 'Harder, Better, Faster, Stronger' })
  title!: string;

  @ApiProperty({ example: 'Daft Punk' })
  artist!: string;

  @ApiProperty({ example: 224 })
  durationSec!: number;

  @ApiProperty({ description: 'Permanent page of the track in the catalog', example: 'https://www.deezer.com/track/3135556' })
  sourceUri!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Cover picture' })
  thumbnailUrl!: string | null;

  @ApiProperty()
  createdAt!: Date;
}

// A track found in the catalog, not stored yet: suggest it to a room or add it to a playlist with its externalId
export class CatalogTrackResponse {
  @ApiProperty({ example: '3135556' })
  externalId!: string;

  @ApiProperty({ example: 'Harder, Better, Faster, Stronger' })
  title!: string;

  @ApiProperty({ example: 'Daft Punk' })
  artist!: string;

  @ApiProperty({ example: 224 })
  durationSec!: number;

  @ApiProperty({ description: 'Permanent page of the track in the catalog', example: 'https://www.deezer.com/track/3135556' })
  link!: string;

  @ApiProperty({ type: String, nullable: true })
  coverUrl!: string | null;

  @ApiProperty({ type: String, nullable: true, description: '30-second extract. It expires: never store it' })
  previewUrl!: string | null;
}

export class CatalogSearchResponse {
  @ApiProperty({ description: 'How many tracks match in the whole catalog' })
  total!: number;

  @ApiProperty({ type: [CatalogTrackResponse] })
  items!: CatalogTrackResponse[];
}

export class PreviewResponse {
  @ApiProperty({ format: 'uuid' })
  songId!: string;

  @ApiProperty({ description: '30-second extract, playable for a short time: ask again right before each play' })
  previewUrl!: string;
}
