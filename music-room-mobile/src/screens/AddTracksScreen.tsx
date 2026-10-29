import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCheck, faPlus } from '@fortawesome/free-solid-svg-icons';
import { useAutoDismiss } from '../hooks/useAutoDismiss';
import { useScreenToast } from '../components/Toast';
import { ApiError, type ApiClient } from '../api/client';
import { playlistsApi, type PlaylistEntry } from '../api/playlists';
import { songsApi, type CatalogTrack } from '../api/songs';
import { BackLink } from '../components/BackLink';
import { styles } from '../components/ProfileUI';

const SEARCH_DELAY_MS = 400; // the search starts once the typing stops for this long

// Find songs in the catalog and add them at the end of the playlist. Drawn by the playlist page, which hands it the live songs.
export function AddTracksScreen({ client, playlistId, name, songs, onForbidden, onBack }: {
  client: ApiClient; playlistId: string; name: string; songs: PlaylistEntry[]; onForbidden: () => void; onBack: () => void;
}) {
  const playlists = useMemo(() => playlistsApi(client), [client]);
  const catalog = useMemo(() => songsApi(client), [client]);
  const [text, setText] = useState('');
  const [results, setResults] = useState<CatalogTrack[] | null>(null); // the last search's answer; null while the box is empty
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useAutoDismiss(error, setError);
  useScreenToast(error, ''); // shown at the bottom of the screen: a result can be far down the list
  const alive = useRef(false);
  const working = useRef(false);
  const query = text.trim();
  const inPlaylist = new Set(songs.map(entry => entry.song.externalId)); // the songs already in the playlist, by catalog id

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Search once the typing stops. A new text, or closing the page, cancels the waiting search and ignores a late answer.
  useEffect(() => {
    if (!query) { setResults(null); return; }
    let active = true;
    const timer = setTimeout(() => {
      void catalog.search(query).then(found => { if (active) setResults(found); })
        .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to search.'); });
    }, SEARCH_DELAY_MS);
    return () => { active = false; clearTimeout(timer); };
  }, [catalog, query]);

  async function action(operation: () => Promise<unknown>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await operation(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Unable to complete this action.'); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  function add(track: CatalogTrack) {
    void action(async () => {
      try { await playlists.add(playlistId, track.externalId); }
      catch (e) {
        if (e instanceof ApiError && e.status === 403) onForbidden(); // no longer allowed: the playlist page reloads what I may do
        throw e;
      }
    });
  }

  return <View style={styles.section}>
    <BackLink title={`Back to ${name}`} onPress={onBack} />
    <Text style={styles.title}>Add tracks</Text>
    <TextInput accessibilityLabel="Search songs" placeholder="Search songs" placeholderTextColor="#737D91" value={text} onChangeText={setText}
      maxLength={100} autoFocus autoCorrect={false} autoCapitalize="none" returnKeyType="search" style={styles.input} />
    {results?.length === 0 ? <Text style={styles.text}>No song found.</Text> : null}
    {results?.map(track => {
      const added = inPlaylist.has(track.externalId);
      return <View key={track.externalId} style={s.track}>
        {track.coverUrl ? <Image source={{ uri: track.coverUrl }} style={s.thumb} /> : <View style={s.thumb} />}
        <View style={s.grow}>
          <Text style={s.song} numberOfLines={1}>{track.title}</Text>
          <Text style={styles.text} numberOfLines={1}>{track.artist}</Text>
          {added ? <Text style={s.note}>In the playlist</Text> : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={added ? `${track.title} is in the playlist` : `Add ${track.title}`}
          accessibilityState={{ disabled: busy || added }} disabled={busy || added} onPress={() => add(track)}
          style={({ pressed }) => [s.add, (pressed || (busy && !added)) && s.dim]}>
          <FontAwesomeIcon icon={added ? faCheck : faPlus} color={added ? '#B4BDCE' : '#A9B6FF'} size={20} />
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
  note: { color: '#A9B6FF', fontSize: 13 },
  add: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, // only the icon, with a finger-sized area to tap
  dim: { opacity: 0.5 },
});
