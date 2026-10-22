import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faChevronRight, faLock, faMusic } from '@fortawesome/free-solid-svg-icons';
import type { ApiClient } from '../api/client';
import { PLAYLISTS_PAGE_SIZE, playlistsApi, type Playlist, type PlaylistCard } from '../api/playlists';
import type { Live } from '../realtime/live';
import { Action, styles } from '../components/ProfileUI';
import { PlaylistScreen } from './PlaylistScreen';

const SEARCH_DELAY_MS = 400; // the search starts once the typing stops for this long
const CHIPS: { visibility: Playlist['visibility']; label: string; empty: string }[] = [
  { visibility: 'PUBLIC', label: 'Public', empty: 'No public playlists yet.' },
  { visibility: 'PRIVATE', label: 'Private', empty: 'No private playlists yet. The ones you create or are invited to show here.' },
];

// The Playlists tab: the playlists you may see, one chip at a time, found by name, and the way into one of them
export function PlaylistsScreen({ client, live }: { client: ApiClient; live: Live }) {
  const api = useMemo(() => playlistsApi(client), [client]);
  const [visibility, setVisibility] = useState<Playlist['visibility']>('PUBLIC');
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const [playlists, setPlaylists] = useState<PlaylistCard[] | null>(null); // null until the first answer: never a false empty list
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0); // counts the reloads asked for: back from a playlist, "Try again"
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const query = text.trim();

  // Load a page of playlists. A new search waits for the typing to stop; a late answer is ignored.
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      void api.list(page, query, visibility).then(found => { if (active) setPlaylists(found); })
        .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load the playlists.'); })
        .finally(() => { if (active) setLoading(false); });
    }, query ? SEARCH_DELAY_MS : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [api, page, query, visibility, reload]);

  if (playlistId) return <PlaylistScreen client={client} live={live} playlistId={playlistId} onBack={() => { setPlaylistId(null); setReload(n => n + 1); }} />;

  const chip = CHIPS.find(each => each.visibility === visibility)!;
  const card = (playlist: PlaylistCard) => <Pressable key={playlist.id} accessibilityRole="button" accessibilityLabel={`Open ${playlist.name}`} onPress={() => setPlaylistId(playlist.id)} style={p.card}>
    {playlist.cover ? <Image source={{ uri: playlist.cover }} style={p.cover} />
      : <View style={[p.cover, p.blank]}><FontAwesomeIcon icon={playlist.visibility === 'PRIVATE' ? faLock : faMusic} color="#A9B6FF" size={20} /></View>}
    <View style={p.grow}>
      <Text style={p.name} numberOfLines={1}>{playlist.name}</Text>
      <Text style={styles.text} numberOfLines={1}>{playlist.songsCount} {playlist.songsCount === 1 ? 'track' : 'tracks'} · by {playlist.owner.id === client.user?.id ? 'you' : playlist.owner.name}</Text>
      <Text style={p.rule} numberOfLines={1}>{playlist.visibility === 'PUBLIC' ? 'Public' : 'Private'} · {playlist.editLicense === 'EVERYONE' ? 'Everyone edits' : 'Invitees edit'}</Text>
    </View>
    <FontAwesomeIcon icon={faChevronRight} color="#737D91" size={14} />
  </Pressable>;

  return <View style={styles.section}>
    <View style={p.heading}>
      <Text style={p.eyebrow}>YOUR PLAYLISTS</Text>
      <Text style={p.title}>Made together.</Text>
    </View>
    <TextInput accessibilityLabel="Search playlists" placeholder="Search playlists" placeholderTextColor="#737D91" value={text}
      onChangeText={value => { setText(value); setPage(1); }} maxLength={100} autoCorrect={false} autoCapitalize="none" returnKeyType="search" style={styles.input} />
    <View style={p.chips}>{CHIPS.map(each => <Pressable key={each.visibility} accessibilityRole="tab" accessibilityState={{ selected: visibility === each.visibility }}
      onPress={() => { setVisibility(each.visibility); setPage(1); setPlaylists(null); }} style={[p.chip, visibility === each.visibility && p.chosen]}>
      <Text style={[p.chipText, visibility === each.visibility && p.chosenText]}>{each.label}</Text>
    </Pressable>)}</View>
    {error ? <View style={p.gap}>
      <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <Action title="Try again" secondary onPress={() => setReload(n => n + 1)} />
    </View> : null}
    {playlists === null ? (loading ? <ActivityIndicator color="#B7F576" accessibilityLabel="Loading the playlists" /> : null) : <>
      {playlists.length === 0 && !loading ? <Text style={styles.text}>{query ? 'No playlist matches this search.' : chip.empty}</Text> : null}
      {playlists.map(card)}
      {page > 1 || playlists.length === PLAYLISTS_PAGE_SIZE ? <View style={p.pages}>
        <Action title="Previous" secondary disabled={page === 1 || loading} onPress={() => setPage(n => n - 1)} />
        <Action title="Next" secondary disabled={playlists.length < PLAYLISTS_PAGE_SIZE || loading} onPress={() => setPage(n => n + 1)} />
      </View> : null}
    </>}
  </View>;
}

const p = StyleSheet.create({
  heading: { gap: 3 },
  grow: { flex: 1, gap: 3 },
  eyebrow: { color: '#A98BFF', fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  title: { color: '#F3F3E9', fontSize: 32, fontWeight: '800' },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#242D3E' },
  chosen: { backgroundColor: '#1E2A5C' },
  chipText: { color: '#B4BDCE', fontWeight: '600' },
  chosenText: { color: '#A9B6FF' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: '#171A25' },
  cover: { width: 56, height: 56, borderRadius: 10 },
  blank: { backgroundColor: '#242D3E', alignItems: 'center', justifyContent: 'center' },
  name: { color: '#F3F3E9', fontSize: 17, fontWeight: '700' },
  rule: { color: '#A9B6FF', fontSize: 13 },
  pages: { flexDirection: 'row', gap: 12 },
  gap: { gap: 8 },
});
