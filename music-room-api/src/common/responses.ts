import { ApiProperty } from '@nestjs/swagger';

// Answer shapes shared by several modules, for the Swagger documentation (V.4)

// Who or what something points to: a room's owner, the person who added a song, an invitation's room...
export class IdAndNameResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

// What a route that deletes or removes something answers
export class DeletedResponse {
  @ApiProperty({ example: true })
  deleted!: boolean;
}

// What a route answers when there is nothing to give back but a sentence for the user
export class MessageResponse {
  @ApiProperty()
  message!: string;
}
