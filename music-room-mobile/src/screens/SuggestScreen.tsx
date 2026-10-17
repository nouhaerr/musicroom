import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCheck, faPlus } from '@fortawesome/free-solid-svg-icons';
import { useAutoDismiss } from '../hooks/useAutoDismiss';
import type { ApiClient } from '../api/client';
import { partiesApi, type QueueEntry } from '../api/parties';
import { songsApi, type CatalogTrack } from '../api/songs';
import { Button } from '../components/FormControls';
import { styles } from '../components/ProfileUI';

const SEARCH_DELAY_MS = 400; // the search starts once the typing stops for this long

// Find songs in the catalog and add them to the party's queue. Drawn by the party page, which hands it the live queue.
export function SuggestScreen({ client, partyId, queue, onBack }: {
  client: ApiClient; partyId: string; queue: QueueEntry[]; onBack: () => void;
}) {
  const parties = useMemo(() => partiesApi(client), [client]);
  const songs = useMemo(() => songsApi(client), [client]);
  const [text, setText] = useState('');
  const [results, setResults] = useState<CatalogTrack[] | null>(null); // the last search's answer; null while the box is empty
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useAutoDismiss(error, setError);
  const alive = useRef(false);
  const working = useRef(false);
  const query = text.trim();
  const queued = new Map(queue.map(entry => [entry.song.externalId, entry])); // the songs already in the queue, by catalog id

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Search once the typing stops. A new text, or closing the page, cancels the waiting search and ignores a late answer.
  useEffect(() => {
    if (!query) { setResults(null); return; }
    let active = true;
    const timer = setTimeout(() => {
      void songs.search(query).then(found => { if (active) setResults(found); })
        .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to search.'); });
    }, SEARCH_DELAY_MS);
    return () => { active = false; clearTimeout(timer); };
  }, [songs, query]);

  async function action(operation: () => Promise<unknown>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await operation(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Unable to complete this action.'); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }

  return <View style={styles.section}>
    <Button title="← Back" secondary onPress={onBack} />
    <Text style={styles.title}>Suggest a track</Text>
    <TextInput accessibilityLabel="Search songs" placeholder="Search songs" placeholderTextColor="#737D91" value={text} onChangeText={setText}
      maxLength={100} autoFocus autoCorrect={false} autoCapitalize="none" returnKeyType="search" style={styles.input} />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {results?.length === 0 ? <Text style={styles.text}>No song found.</Text> : null}
    {results?.map(track => {
      const entry = queued.get(track.externalId);
      return <View key={track.externalId} style={s.track}>
        {track.coverUrl ? <Image source={{ uri: track.coverUrl }} style={s.thumb} /> : null}
        <View style={s.grow}>
          <Text style={s.song} numberOfLines={1}>{track.title}</Text>
          <Text style={styles.text} numberOfLines={1}>{track.artist}</Text>
          {entry ? <Text style={s.queued}>Already in queue · {entry.voteCount} {entry.voteCount === 1 ? 'vote' : 'votes'}</Text> : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={entry ? `${track.title} is in the queue` : `Add ${track.title} to the queue`}
          accessibilityState={{ disabled: busy || !!entry }} disabled={busy || !!entry}
          onPress={() => void action(() => parties.suggest(partyId, track.externalId))}
          style={[s.add, entry && s.added, busy && !entry && s.dim]}>
          <FontAwesomeIcon icon={entry ? faCheck : faPlus} color="#F3F3E9" size={14} />
        </Pressable>
      </View>;
    })}
  </View>;
}

const s = StyleSheet.create({
  track: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomColor: '#3B4355', borderBottomWidth: 1 },
  thumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: '#242D3E' },
  grow: { flex: 1, gap: 2 },
  song: { color: '#F3F3E9', fontSize: 16, fontWeight: '700' },
  queued: { color: '#A9B6FF', fontSize: 13 },
  add: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#242D3E', alignItems: 'center', justifyContent: 'center' },
  added: { backgroundColor: '#4961EE' },
  dim: { opacity: 0.5 },
});
