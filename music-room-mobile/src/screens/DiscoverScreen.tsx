import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faChevronRight, faLock, faMusic, faPlus } from '@fortawesome/free-solid-svg-icons';
import type { ApiClient } from '../api/client';
import { ROOMS_PAGE_SIZE, partiesApi, progress, type PartyCard, type RoomFilter } from '../api/parties';
import type { Live } from '../realtime/live';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { Action, styles } from '../components/ProfileUI';
import { CreatePartyScreen } from './CreatePartyScreen';
import { PartyScreen } from './PartyScreen';

const SEARCH_DELAY_MS = 400; // the search starts once the typing stops for this long
const CHIPS: { filter: RoomFilter; label: string; empty: string }[] = [
  { filter: 'public', label: 'Public', empty: 'No public rooms yet. Create the first one!' },
  { filter: 'private', label: 'Private', empty: 'No private rooms yet. The ones you create or are invited to show here.' },
  { filter: 'location', label: 'Location & time', empty: 'No location & time rooms yet.' },
];

// The Rooms tab: the rooms you may see, one chip at a time, found by name, and the way into one of them or into a new one
export function DiscoverScreen({ client, live }: { client: ApiClient; live: Live }) {
  const api = useMemo(() => partiesApi(client), [client]);
  const [filter, setFilter] = useState<RoomFilter>('public');
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const [rooms, setRooms] = useState<PartyCard[] | null>(null); // null until the first answer: never a false empty list
  const [receivedAt, setReceivedAt] = useState(0); // when the rooms arrived, on this phone's clock
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0); // counts the reloads asked for: back from a room, "Try again"
  const [partyId, setPartyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const query = text.trim();

  // Load a page of rooms. A new search waits for the typing to stop; a late answer is ignored.
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      void api.list(page, query, filter).then(found => {
        if (!active) return;
        const at = Date.now();
        setRooms(found); setReceivedAt(at); setNow(at);
      })
        .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load the rooms.'); })
        .finally(() => { if (active) setLoading(false); });
    }, query ? SEARCH_DELAY_MS : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [api, page, query, filter, reload]);

  // The cards follow the phone's clock, so a song turns to "Last played" when its time runs out
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (creating) return <CreatePartyScreen client={client} onCreated={id => { setCreating(false); setPartyId(id); }} onBack={() => setCreating(false)} />;
  if (partyId) return <PartyScreen client={client} live={live} partyId={partyId} onBack={() => { setPartyId(null); setReload(n => n + 1); }} />;

  const firstName = client.user?.name.trim().split(/\s+/)[0] ?? '';
  const chip = CHIPS.find(each => each.filter === filter)!;
  const card = (room: PartyCard) => {
    // The server's measure plus the time since the list arrived: a song whose time is over is the last one played
    const playing = progress({ party: room, playingForMs: room.playingForMs }, receivedAt, now);
    const over = playing !== null && playing.elapsedSec >= playing.durationSec;
    return <Pressable key={room.id} accessibilityRole="button" accessibilityLabel={`Open ${room.name}`} onPress={() => setPartyId(room.id)} style={d.card}>
      {room.nowPlaying?.thumbnailUrl ? <Image source={{ uri: room.nowPlaying.thumbnailUrl }} style={d.cover} />
        : <View style={[d.cover, d.blank]}><FontAwesomeIcon icon={room.visibility === 'PRIVATE' ? faLock : faMusic} color="#A9B6FF" size={20} /></View>}
      <View style={d.grow}>
        <Text style={d.name} numberOfLines={1}>{room.name}</Text>
        <Text style={styles.text} numberOfLines={1}>Hosted by {room.owner.id === client.user?.id ? 'you' : room.owner.name}</Text>
        <Text style={d.playing} numberOfLines={1}>{room.nowPlaying ? `${over ? 'Last played' : 'Now playing'} · ${room.nowPlaying.title} — ${room.nowPlaying.artist}` : 'Nothing playing yet'}</Text>
      </View>
      <FontAwesomeIcon icon={faChevronRight} color="#737D91" size={14} />
    </Pressable>;
  };

  return <View style={styles.section}>
    <View style={d.header}>
      <View style={d.grow}>
        <Text style={d.eyebrow}>TONIGHT IS YOURS{firstName ? `, ${firstName.toUpperCase()}` : ''}</Text>
        <Text style={d.title}>Discover</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Create a room" onPress={() => setCreating(true)} style={d.create}>
        <FontAwesomeIcon icon={faPlus} color="#F8F9FF" size={20} />
      </Pressable>
      {client.user ? <ProfileAvatar name={client.user.name} info={undefined} size={52} /> : null}
    </View>
    <TextInput accessibilityLabel="Search rooms" placeholder="Search rooms" placeholderTextColor="#737D91" value={text}
      onChangeText={value => { setText(value); setPage(1); }} maxLength={100} autoCorrect={false} autoCapitalize="none" returnKeyType="search" style={styles.input} />
    <View style={d.chips}>{CHIPS.map(each => <Pressable key={each.filter} accessibilityRole="tab" accessibilityState={{ selected: filter === each.filter }}
      onPress={() => { setFilter(each.filter); setPage(1); setRooms(null); }} style={[d.chip, filter === each.filter && d.chosen]}>
      <Text style={[d.chipText, filter === each.filter && d.chosenText]}>{each.label}</Text>
    </Pressable>)}</View>
    {error ? <View style={d.gap}>
      <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <Action title="Try again" secondary onPress={() => setReload(n => n + 1)} />
    </View> : null}
    {rooms === null ? (loading ? <ActivityIndicator color="#B7F576" accessibilityLabel="Loading the rooms" /> : null) : <>
      {rooms.length === 0 && !loading ? <Text style={styles.text}>{query ? 'No room matches this search.' : chip.empty}</Text> : null}
      {rooms.map(card)}
      {page > 1 || rooms.length === ROOMS_PAGE_SIZE ? <View style={d.pages}>
        <Action title="Previous" secondary disabled={page === 1 || loading} onPress={() => setPage(p => p - 1)} />
        <Action title="Next" secondary disabled={rooms.length < ROOMS_PAGE_SIZE || loading} onPress={() => setPage(p => p + 1)} />
      </View> : null}
    </>}
  </View>;
}

const d = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, gap: 3 },
  eyebrow: { color: '#A98BFF', fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  title: { color: '#F3F3E9', fontSize: 32, fontWeight: '800' },
  create: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#4961EE', alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#242D3E' },
  chosen: { backgroundColor: '#1E2A5C' },
  chipText: { color: '#B4BDCE', fontWeight: '600' },
  chosenText: { color: '#A9B6FF' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: '#171A25' },
  cover: { width: 56, height: 56, borderRadius: 10 },
  blank: { backgroundColor: '#242D3E', alignItems: 'center', justifyContent: 'center' },
  name: { color: '#F3F3E9', fontSize: 17, fontWeight: '700' },
  playing: { color: '#A9B6FF', fontSize: 13 },
  pages: { flexDirection: 'row', gap: 12 },
  gap: { gap: 8 },
});
