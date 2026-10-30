import { ApiProperty } from '@nestjs/swagger';
import { FriendRequestStatus } from '../../../generated/prisma';
import { ProfileResponse } from '../../users/dto/user.responses';

// A friend request as stored
export class FriendRequestResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  senderId!: string;

  @ApiProperty({ format: 'uuid' })
  receiverId!: string;

  @ApiProperty({ enum: FriendRequestStatus })
  status!: FriendRequestStatus;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

// A pending request in GET /friends/requests, with both profiles
export class FriendRequestDetailResponse extends FriendRequestResponse {
  @ApiProperty({ type: ProfileResponse })
  sender!: ProfileResponse;

  @ApiProperty({ type: ProfileResponse })
  receiver!: ProfileResponse;
}
