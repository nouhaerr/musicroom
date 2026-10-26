import * as Location from 'expo-location';
import type { Position } from './api/parties';

// Read where the phone is, each time it is needed: it takes a few seconds. Nothing is kept: a vote never sends an
// old position, and location turned off in the settings is seen at the very next reading.
export async function currentPosition(): Promise<Position> {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) throw new Error('This party only counts votes from people at its location. Allow location access to vote.');
  try {
    const { coords } = await Location.getCurrentPositionAsync();
    return { latitude: coords.latitude, longitude: coords.longitude };
  } catch {
    throw new Error('Your position could not be read. Turn on location and try again.');
  }
}
