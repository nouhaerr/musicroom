import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuthProvider, Prisma } from '../../../generated/prisma';

// Profile fields made of free text fields chosen by the user
const TEXT_FIELDS = { type: 'object', additionalProperties: { type: 'string' }, nullable: true } as const;

// What anyone signed in may see of another user
export class ProfileResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: 'daft_fan' })
  username!: string | null;

  @ApiProperty({ ...TEXT_FIELDS, description: 'Visible to every signed-in user' })
  publicInfo!: Prisma.JsonValue;

  @ApiProperty({ type: [String], example: ['jazz', 'rock'] })
  musicPreferences!: string[];
}

// GET /users/:id for someone else: their friends also get friendsOnlyInfo
export class UserProfileResponse extends ProfileResponse {
  @ApiPropertyOptional({ ...TEXT_FIELDS, description: 'Only when you are friends' })
  friendsOnlyInfo?: Prisma.JsonValue;
}

// A search result: the profile, and where you stand with that person
export class UserSearchResultResponse extends ProfileResponse {
  @ApiProperty({ enum: ['NONE', 'FRIENDS', 'OUTGOING', 'INCOMING'], description: 'OUTGOING: you sent them a friend request; INCOMING: they sent you one' })
  relationship!: string;

  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'The pending friend request between you, if any' })
  friendRequestId!: string | null;
}

// Your own account: everything but the password
export class AccountResponse extends ProfileResponse {
  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ enum: AuthProvider, description: 'How the account was created' })
  authProvider!: AuthProvider;

  @ApiProperty({ type: String, nullable: true, description: 'Set when a Facebook account is linked' })
  facebookId!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Set when a Google account is linked' })
  googleId!: string | null;

  @ApiProperty({ type: Date, nullable: true, description: 'Null until the email address is confirmed' })
  emailVerifiedAt!: Date | null;

  @ApiProperty({ ...TEXT_FIELDS, description: 'Visible to your friends only' })
  friendsOnlyInfo!: Prisma.JsonValue;

  @ApiProperty({ ...TEXT_FIELDS, description: 'Visible to you only' })
  privateInfo!: Prisma.JsonValue;

  @ApiProperty({ description: 'False for an account created with Facebook or Google that has no password yet' })
  hasPassword!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
