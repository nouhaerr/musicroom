import { useEffect } from 'react';
import { setAudioModeAsync, useAudioPlayer, type AudioPlayer } from 'expo-audio';
import { ApiError, type ApiClient } from '../api/client';
import { songsApi } from '../api/songs';

export const EXTRACT_SECONDS = 30; // how long the catalog's extracts last

// The player of a page. It closes with the page, so leaving the page stops the sound. The silent switch does not mute
// it: the music is what the page is for.
export function useExtractPlayer() {
  const player = useAudioPlayer();
  useEffect(() => { void setAudioModeAsync({ playsInSilentMode: true }); }, []);
  return player;
}

// Plays the 30-second extract of a stored song from `fromSec`, with a fresh link. False when the song has none.
// `wanted` tells, once the link arrives, whether this song is still the one to play: it may have changed meanwhile.
export async function playExtract(player: AudioPlayer, client: ApiClient, songId: string, fromSec: number, wanted: () => boolean) {
  let url: string;
  try { url = await songsApi(client).preview(songId); }
  catch (e) {
    if (e instanceof ApiError && e.status === 404) return false;
    throw e;
  }
  if (!wanted()) return true;
  player.replace({ uri: url });
  player.play();
  if (fromSec > 0) await player.seekTo(fromSec);
  return true;
}

// Stops the sound. When the page itself is closing, its player may already be closed, and so silent
export function stopExtract(player: AudioPlayer) {
  try { player.pause(); } catch { /* already closed */ }
}
