import { IsIn, IsUUID } from 'class-validator';

// What a client can watch. Each kind has its own access rule in the gateway.
export const SUBSCRIBABLE = ['party', 'playlist'] as const;

// Payload of the `subscribe` and `unsubscribe` messages
export class SubscribeDto {
  @IsIn(SUBSCRIBABLE)
  type!: (typeof SUBSCRIBABLE)[number];

  @IsUUID()
  id!: string;
}
