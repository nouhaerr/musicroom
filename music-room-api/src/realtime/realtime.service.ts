import { Injectable } from '@nestjs/common';
import { SubscribeDto } from './dto/subscribe.dto';

// The services that change data announce it here; the gateway listens and sends the new state
// to whoever watches. This service depends on nothing, so PartiesService can use it without an
// import cycle (the gateway itself needs PartiesService to read that state).
@Injectable()
export class RealtimeService {
  private listener?: (target: SubscribeDto) => void;

  // Call these only after the change is committed: the state read next must already contain it
  partyChanged(partyId: string) {
    this.listener?.({ type: 'party', id: partyId });
  }

  playlistChanged(playlistId: string) {
    this.listener?.({ type: 'playlist', id: playlistId });
  }

  // The gateway registers itself here when it starts
  listen(listener: (target: SubscribeDto) => void) {
    this.listener = listener;
  }
}
