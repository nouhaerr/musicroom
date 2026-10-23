import * as Location from 'expo-location';
import type { Position } from './api/parties';

const RECENT_MS = 2 * 60_000; // a position stays usable 2 minutes: in that time nobody gets far from the venue
let latest: { position: Position; at: number } | null = null; // the last reading, and when it ended on this phone's clock

// The last reading if it is recent enough to tell where the phone is, otherwise null. Instant.
export function recentPosition(): Position | null {
  return latest && Date.now() - latest.at < RECENT_MS ? latest.position : null;
}

// Read where the phone is: it takes several seconds. Asked only by parties that accept votes from people at their location.
// A quiet reading asks the user nothing: no permission request, no window asking to turn on location.
export async function currentPosition(quiet = false): Promise<Position> {
  const { granted } = await (quiet ? Location.getForegroundPermissionsAsync() : Location.requestForegroundPermissionsAsync());
  if (!granted) throw new Error('This party only counts votes from people at its location. Allow location access to vote.');
  try {
    const { coords } = await Location.getCurrentPositionAsync({ mayShowUserSettingsDialog: !quiet });
    const position = { latitude: coords.latitude, longitude: coords.longitude };
    latest = { position, at: Date.now() };
    return position;
  } catch {
    throw new Error('Your position could not be read. Turn on location and try again.');
  }
}
