import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Visibility, VoteLicense } from '../../../generated/prisma';
import { IdAndNameResponse } from '../../common/responses';
import { SongResponse } from '../../songs/dto/song.responses';

// A room (party) as stored
export class PartyResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ format: 'uuid' })
  ownerId!: string;

  @ApiProperty({ enum: Visibility, description: 'PRIVATE: only the owner and the invited people can find and open it' })
  visibility!: Visibility;

  @ApiProperty({ enum: VoteLicense, description: 'Who may vote: everyone, the invited people only, or the people at the place during the hours' })
  voteLicense!: VoteLicense;

  @ApiProperty({ type: Date, nullable: true, description: 'LOCATION_TIME only: when voting opens' })
  voteStartsAt!: Date | null;

  @ApiProperty({ type: Date, nullable: true, description: 'LOCATION_TIME only: when voting closes' })
  voteEndsAt!: Date | null;

  @ApiProperty({ type: Number, nullable: true, description: 'LOCATION_TIME only: the place' })
  latitude!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'LOCATION_TIME only: the place' })
  longitude!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'LOCATION_TIME only: how far from the place a vote still counts' })
  radiusMeters!: number | null;

  @ApiProperty({ format: 'uuid', description: 'The room queue' })
  partyPlaylistId!: string;

  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'The song playing now' })
  nowPlayingSongId!: string | null;

  @ApiProperty({ type: Date, nullable: true })
  nowPlayingStartedAt!: Date | null;

  @ApiProperty({ description: 'Goes up at every playback change: send it back to POST /parties/:id/next' })
  playbackVersion!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class PartyDetailResponse extends PartyResponse {
  @ApiProperty({ type: SongResponse, nullable: true })
  nowPlaying!: SongResponse | null;
}

// A room in a list
export class PartyCardResponse extends PartyDetailResponse {
  @ApiProperty({ type: IdAndNameResponse })
  owner!: IdAndNameResponse;

  @ApiPropertyOptional({
    type: Number, nullable: true,
    description: 'GET /parties only: how long the current song has been playing, measured by the server clock',
  })
  playingForMs?: number | null;
}

// A song in a room queue, as stored
export class PartySongResponse {
  @ApiProperty({ format: 'uuid', description: 'The queue entry id (partySongId)' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  partyPlaylistId!: string;

  @ApiProperty({ format: 'uuid' })
  songId!: string;

  @ApiProperty()
  voteCount!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class PartySongDetailResponse extends PartySongResponse {
  @ApiProperty({ type: SongResponse })
  song!: SongResponse;
}

export class VoteCountResponse {
  @ApiProperty()
  votes!: number;
}

// A song in the queue list, in play order: most votes first
export class QueueEntryResponse extends PartySongDetailResponse {
  @ApiProperty({ type: VoteCountResponse })
  _count!: VoteCountResponse;
}
