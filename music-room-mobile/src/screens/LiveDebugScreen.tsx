import { useEffect, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import type { ApiClient } from '../api/client';
import type { Party, PartySnapshot } from '../api/parties';
import type { Live } from '../realtime/live';
import { Action, styles } from '../components/ProfileUI';

// TEMPORARY: shows the live connection working on a real phone. The party page replaces it.
type Listed = Party & { owner?: { name: string } };
const TEST_SONG = '3135556'; // a Deezer track id

export function LiveDebugScreen({ client, live }: { client: ApiClient; live: Live }) {
  const [parties, setParties] = useState<Listed[]>([]);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<PartySnapshot | null>(null);
  const [received, setReceived] = useState(0);
  const [status, setStatus] = useState('');

  const fail = (error: unknown) => setStatus(error instanceof Error ? error.message : 'Something went wrong.');
  // The list is a plain request: it is not live
  const load = () => {
    client.request<Listed[]>('/parties?limit=20').then(setParties).catch(fail);
  };
  useEffect(load, [client]);

  // What a screen does with the module: watch while it is open, stop when it closes
  useEffect(() => {
    if (!partyId) return;
    setSnapshot(null);
    setReceived(0);
    return live.watchParty(partyId, {
      onSnapshot: (next) => { setSnapshot(next); setReceived((count) => count + 1); },
      onGone: (reason) => { setPartyId(null); setStatus(`Watching ended: ${reason}`); },
    });
  }, [live, partyId]);

  // Back to the front: the connection may have died in the background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') live.resume(); });
    return () => subscription.remove();
  }, [live]);

  // Changes go through the API like any other; the screen only changes when the snapshot comes back
  const send = (path: string, body: unknown) => {
    setStatus('');
    client.request(path, 'POST', body).catch(fail);
  };

  if (!partyId) {
    return <View style={styles.section}>
      <Text style={styles.title}>Live check (temporary)</Text>
      {status ? <Text style={styles.error}>{status}</Text> : null}
      {parties.map((party) => <Action key={party.id} secondary onPress={() => { setStatus(''); setPartyId(party.id); }}
        title={`${party.name} · ${party.owner?.name ?? '?'} · ${party.visibility}`} />)}
      <Action title="Create a test party" onPress={() => {
        client.request('/parties', 'POST', { name: `Live test ${new Date().toLocaleTimeString()}` }).then(load).catch(fail);
      }} />
      <Action secondary title="Reload the list" onPress={load} />
    </View>;
  }

  return <View style={styles.section}>
    <Action secondary title="← Back to the list" onPress={() => setPartyId(null)} />
    {status ? <Text style={styles.error}>{status}</Text> : null}
    {!snapshot ? <Text style={styles.text}>Connecting…</Text> : <>
      <Text style={styles.title}>{snapshot.party.name}</Text>
      <Text style={styles.label}>Snapshots received: {received}</Text>
      <Text style={styles.text}>
        Now playing: {snapshot.party.nowPlaying ? `${snapshot.party.nowPlaying.title} — ${snapshot.party.nowPlaying.artist}` : 'nothing'}
      </Text>
      <Text style={styles.text}>Queue: {snapshot.queueLength} song(s). Tap one to vote for it.</Text>
      {snapshot.queue.map((entry) => <Action key={entry.id} secondary
        title={`${entry.song.title} · ${entry.voteCount} vote(s)`}
        onPress={() => send(`/parties/${partyId}/songs/${entry.id}/vote`, {})} />)}
      <Action title="Suggest a test song" onPress={() => send(`/parties/${partyId}/songs`, { externalId: TEST_SONG })} />
      <Action title="Next song (owner only)"
        onPress={() => send(`/parties/${partyId}/next`, { expectedPlaybackVersion: snapshot.party.playbackVersion })} />
    </>}
  </View>;
}
