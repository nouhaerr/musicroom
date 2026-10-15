import { useEffect, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import type { ApiClient } from '../api/client';
import type { Party } from '../api/parties';
import type { Live } from '../realtime/live';
import { Action, styles } from '../components/ProfileUI';
import { PartyScreen } from './PartyScreen';
import { currentPosition } from '../location';

// TEMPORARY: the way into the party page until the Discover page and the tab bar exist.
type Listed = Party & { owner?: { name: string } };

export function LiveDebugScreen({ client, live }: { client: ApiClient; live: Live }) {
  const [parties, setParties] = useState<Listed[]>([]);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const fail = (error: unknown) => setStatus(error instanceof Error ? error.message : 'Something went wrong.');
  // The list is a plain request: it is not live
  const load = () => {
    client.request<Listed[]>('/parties?limit=20').then(setParties).catch(fail);
  };
  useEffect(load, [client]);

  // Back to the front: the connection may have died in the background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') live.resume(); });
    return () => subscription.remove();
  }, [live]);

  if (partyId) return <PartyScreen client={client} live={live} partyId={partyId} onBack={() => { setPartyId(null); load(); }} />;

  return <View style={styles.section}>
    <Text style={styles.title}>Parties (temporary list)</Text>
    {status ? <Text style={styles.error}>{status}</Text> : null}
    {parties.map((party) => <Action key={party.id} secondary onPress={() => { setStatus(''); setPartyId(party.id); }}
      title={`${party.name} · ${party.owner?.name ?? '?'} · ${party.visibility}`} />)}
    <Action title="Create a test party" onPress={() => {
      client.request('/parties', 'POST', { name: `Live test ${new Date().toLocaleTimeString()}` }).then(load).catch(fail);
    }} />
    {[['here', 0], ['100 km away', 1]].map(([place, shift]) => <Action key={place} title={`Create a place-and-time test party ${place}`} onPress={() => {
      setStatus('');
      currentPosition().then(({ latitude, longitude }) => client.request('/parties', 'POST', {
        name: `Votes ${place} ${new Date().toLocaleTimeString()}`, voteLicense: 'LOCATION_TIME', radiusMeters: 300,
        latitude: latitude + Number(shift), longitude,
        voteStartsAt: new Date(Date.now() - 3_600_000).toISOString(), voteEndsAt: new Date(Date.now() + 6 * 3_600_000).toISOString(),
      })).then(load).catch(fail);
    }} />)}
    <Action secondary title="Reload the list" onPress={load} />
  </View>;
}
