import { ApiProperty } from '@nestjs/swagger';
import { InvitationStatus, ResourceType } from '../../../generated/prisma';
import { IdAndNameResponse } from '../../common/responses';

// An invitation to a room or a playlist, as stored
export class InvitationResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: InvitationStatus })
  status!: InvitationStatus;

  @ApiProperty({ enum: ResourceType, description: 'Whether it opens a room (PARTY) or a playlist' })
  resourceType!: ResourceType;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  playlistId!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  partyId!: string | null;

  @ApiProperty({ format: 'uuid' })
  invitedById!: string;

  @ApiProperty({ format: 'uuid' })
  invitedUserId!: string;

  @ApiProperty()
  createdAt!: Date;
}

// One of my invitations, with the names to show
export class MyInvitationResponse extends InvitationResponse {
  @ApiProperty({ type: IdAndNameResponse, nullable: true })
  party!: IdAndNameResponse | null;

  @ApiProperty({ type: IdAndNameResponse, nullable: true })
  playlist!: IdAndNameResponse | null;

  @ApiProperty({ type: IdAndNameResponse })
  invitedBy!: IdAndNameResponse;
}
