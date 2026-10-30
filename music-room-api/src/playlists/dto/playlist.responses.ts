import { ApiProperty } from '@nestjs/swagger';
import { EditLicense, InvitationStatus, Visibility } from '../../../generated/prisma';
import { IdAndNameResponse } from '../../common/responses';
import { SongResponse } from '../../songs/dto/song.responses';
import { ProfileResponse } from '../../users/dto/user.responses';

// A playlist as stored
export class PlaylistResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ format: 'uuid' })
  ownerId!: string;

  @ApiProperty({ enum: Visibility, description: 'PRIVATE: only the owner and the invited people can find and open it' })
  visibility!: Visibility;

  @ApiProperty({ enum: EditLicense, description: 'Who may add, move and remove songs' })
  editLicense!: EditLicense;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

// A playlist in GET /playlists
export class PlaylistCardResponse extends PlaylistResponse {
  @ApiProperty({ type: IdAndNameResponse })
  owner!: IdAndNameResponse;

  @ApiProperty()
  songsCount!: number;

  @ApiProperty({ type: String, nullable: true, description: 'The cover of its first song' })
  cover!: string | null;
}

export class InvitationStateResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: InvitationStatus })
  status!: InvitationStatus;
}

// The playlist page: its songs come through the live connection (see the README)
export class PlaylistPageResponse extends PlaylistResponse {
  @ApiProperty({ type: IdAndNameResponse })
  owner!: IdAndNameResponse;

  @ApiProperty({ description: 'Whether you may add, move and remove songs' })
  canEdit!: boolean;

  @ApiProperty({ type: InvitationStateResponse, nullable: true, description: 'Your own invitation to it, if any' })
  invitation!: InvitationStateResponse | null;
}

// One person in GET /playlists/:id/invitations
export class PlaylistInvitationResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: InvitationStatus })
  status!: InvitationStatus;

  @ApiProperty({ format: 'uuid' })
  invitedUserId!: string;

  @ApiProperty({ type: ProfileResponse })
  invitedUser!: ProfileResponse;
}

// A song of a playlist, at its position
export class PlaylistSongResponse {
  @ApiProperty({ format: 'uuid', description: 'The entry id (playlistSongId)' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  playlistId!: string;

  @ApiProperty({ format: 'uuid' })
  songId!: string;

  @ApiProperty({ description: 'Songs are listed by increasing position; it can be a decimal, to move a song between two others' })
  position!: number;

  @ApiProperty({ format: 'uuid' })
  addedById!: string;

  @ApiProperty()
  addedAt!: Date;

  @ApiProperty({ type: SongResponse })
  song!: SongResponse;
}

// A song in GET /playlists/:id/songs, with who added it
export class PlaylistSongItemResponse extends PlaylistSongResponse {
  @ApiProperty({ type: IdAndNameResponse })
  addedBy!: IdAndNameResponse;
}
