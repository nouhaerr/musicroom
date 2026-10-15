import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCheck, faChevronUp } from '@fortawesome/free-solid-svg-icons';
import { useAutoDismiss } from '../hooks/useAutoDismiss';
import { ApiError, type ApiClient } from '../api/client';
import { clock, partiesApi, progress, type PartySnapshot, type QueueEntry } from '../api/parties';
import type { GoneReason, Live } from '../realtime/live';
import { currentPosition, recentPosition } from '../location';
import { Action, styles } from '../components/ProfileUI';
import { SuggestScreen } from './SuggestScreen';

// Why the page can no longer show the party, in words for the user
const GONE: Record<GoneReason, string> = {
  FORBIDDEN: 'You no longer have access to this party.',
  NOT_FOUND: 'This party no longer exists.',
  TOO_MANY_CONNECTIONS: 'Your account is open on too many devices.',
  UNAUTHORIZED: 'The server refused the live connection. Please log in again.',
  SIGNED_OUT: 'You are logged out.',
  BAD_REQUEST: 'Live updates are unavailable for this party.',
  TOO_MANY: 'Too many pages are open at once.',
};
const REFRESH_MS = 60_000; // in a party that counts votes by location, how often the page reads the position again

export function PartyScreen({ client, live, partyId, onBack }: {
  client: ApiClient; live: Live; partyId: string; onBack: () => void;
}) {
  const api = useMemo(() => partiesApi(client), [client]);
  const [snapshot, setSnapshot] = useState<PartySnapshot | null>(null);
  const [gone, setGone] = useState<GoneReason | null>(null);
  const [voted, setVoted] = useState(new Set<string>());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receivedAt, setReceivedAt] = useState(0); // when the last snapshot arrived, on this phone's clock
  const [now, setNow] = useState(Date.now());
  const [suggesting, setSuggesting] = useState(false); // the Suggest page is open, drawn in place of this one
  const [locating, setLocating] = useState<string | null>(null); // who waits for a position reading: the party (page just opened) or the song being voted
  useAutoDismiss(error, setError);
  const alive = useRef(false);
  const working = useRef(false);
  const disabled = loading || busy || locating !== null;
  const byLocation = snapshot?.party.voteLicense === 'LOCATION_TIME';

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Watch the party while the page is open: each snapshot replaces what is shown
  useEffect(() => live.watchParty(partyId, {
    onSnapshot: received => {
      const at = Date.now();
      setSnapshot(received); setReceivedAt(at); setNow(at);
    },
    onGone: setGone,
  }), [live, partyId]);

  // Load which songs I voted for. The snapshot cannot tell: it is the same message for everyone.
  useEffect(() => {
    let active = true;
    setLoading(true);
    void api.myVotes(partyId).then(ids => { if (active) setVoted(ids); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load your votes.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, partyId]);

  // In a party that counts votes by location, read the position when the page opens and then every minute,
  // so that a vote finds a recent one and sends it at once
  useEffect(() => {
    if (!byLocation) return;
    const quietly = () => void currentPosition(true).catch(() => {}); // asks nothing: if it fails, the vote reads and tells
    if (recentPosition()) quietly();
    else void locate(partyId).catch(e => { if (alive.current) setError(e instanceof Error ? e.message : 'Unable to read your position.'); });
    const timer = setInterval(quietly, REFRESH_MS);
    return () => clearInterval(timer);
  }, [byLocation, partyId]);

  // The progress bar follows the phone's clock
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function action(operation: () => Promise<unknown>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await operation(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Unable to complete this action.'); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  // A position reading someone waits for: the vote buttons wait, with the line "Finding your position…"
  async function locate(who: string) {
    setLocating(who);
    try { return await currentPosition(); }
    finally { if (alive.current) setLocating(null); }
  }
  function toggleVote(entry: QueueEntry) {
    const had = voted.has(entry.id);
    void action(async () => {
      try {
        if (had) await api.unvote(partyId, entry.id);
        else await api.vote(partyId, entry.id, byLocation ? recentPosition() ?? await locate(entry.id) : undefined);
      } catch (e) {
        // The server is already where we wanted to go (voted from another device, or the vote is gone): only the mark was wrong
        if (!(e instanceof ApiError && e.status === (had ? 404 : 409))) throw e;
      }
      if (!alive.current) return;
      setVoted(current => {
        const updated = new Set(current);
        if (had) updated.delete(entry.id);
        else updated.add(entry.id);
        return updated;
      });
    });
  }

  if (gone) {
    return <View style={styles.section}>
      <Text accessibilityRole="alert" style={styles.error}>{GONE[gone]}</Text>
      <Action title="Back" secondary onPress={onBack} />
    </View>;
  }
  if (!snapshot) {
    return <View style={styles.section}>
      <Action title="← Back" secondary onPress={onBack} />
      <ActivityIndicator color="#B7F576" accessibilityLabel="Connecting to the party" />
      <Text style={styles.text}>Connecting…</Text>
    </View>;
  }
  if (suggesting) return <SuggestScreen client={client} partyId={partyId} queue={snapshot.queue} onBack={() => setSuggesting(false)} />;

  const { party, queue, queueLength } = snapshot;
  const playing = progress(snapshot, receivedAt, now);
  return <View style={styles.section}>
    <Action title="← Back" secondary disabled={busy} onPress={onBack} />
    <Text style={styles.title}>{party.name}</Text>
    <Text style={styles.label}>{party.visibility === 'PUBLIC' ? 'Public' : 'Private'}</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

    <View style={p.card}>
      <Text style={styles.label}>NOW PLAYING</Text>
      {party.nowPlaying ? <View style={p.row}>
        {party.nowPlaying.thumbnailUrl ? <Image source={{ uri: party.nowPlaying.thumbnailUrl }} style={p.cover} /> : null}
        <View style={p.grow}>
          <Text style={styles.title} numberOfLines={1}>{party.nowPlaying.title}</Text>
          <Text style={styles.text} numberOfLines={1}>{party.nowPlaying.artist}</Text>
        </View>
      </View> : <Text style={styles.text}>Nothing is playing yet.</Text>}
      {playing ? <>
        <View style={p.track}>
          <View style={[p.bar, { flex: playing.elapsedSec }]} />
          <View style={{ flex: playing.durationSec - playing.elapsedSec }} />
        </View>
        <View style={p.between}>
          <Text style={styles.text}>{clock(playing.elapsedSec)}</Text>
          <Text style={styles.text}>{clock(playing.durationSec)}</Text>
        </View>
      </> : null}
      {client.user?.id === party.ownerId ?
        <Action title="Next song" disabled={busy} onPress={() => void action(() => api.next(partyId, party.playbackVersion))} /> : null}
    </View>

    <View style={p.between}>
      <Text style={styles.title}>Up next</Text>
      <Text style={styles.label}>{queueLength} {queueLength === 1 ? 'track' : 'tracks'}</Text>
    </View>
    {locating ? <View style={p.row}>
      <ActivityIndicator color="#B7F576" />
      <Text style={styles.text}>Finding your position…</Text>
    </View> : null}
    {queue.length === 0 ? <Text style={styles.text}>No song is waiting.</Text> : null}
    {queue.map((entry, index) => {
      const mine = voted.has(entry.id);
      const waiting = locating === entry.id;
      return <View key={entry.id} style={p.entry}>
        <Text style={p.rank}>{String(index + 1).padStart(2, '0')}</Text>
        {entry.song.thumbnailUrl ? <Image source={{ uri: entry.song.thumbnailUrl }} style={p.thumb} /> : null}
        <View style={p.grow}>
          <Text style={p.song} numberOfLines={1}>{entry.song.title}</Text>
          <Text style={styles.text} numberOfLines={1}>{entry.song.artist}</Text>
          {mine ? <Text style={p.voted}>You voted</Text> : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`${mine ? 'Remove your vote for' : 'Vote for'} ${entry.song.title}`}
          accessibilityState={{ disabled, selected: mine, busy: waiting }} disabled={disabled} onPress={() => toggleVote(entry)}
          style={[p.vote, mine && p.voteOn, disabled && p.dim]}>
          {waiting ? <ActivityIndicator color="#F3F3E9" /> : <FontAwesomeIcon icon={mine ? faCheck : faChevronUp} color="#F3F3E9" size={14} />}
          <Text style={p.count}>{entry.voteCount}</Text>
        </Pressable>
      </View>;
    })}
    <Action title="+ Suggest a track" onPress={() => setSuggesting(true)} />
  </View>;
}

const p = StyleSheet.create({
  card: { backgroundColor: '#171A25', borderRadius: 16, padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, gap: 2 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  cover: { width: 64, height: 64, borderRadius: 12, backgroundColor: '#242D3E' },
  track: { flexDirection: 'row', height: 4, borderRadius: 2, backgroundColor: '#242D3E', overflow: 'hidden' },
  bar: { backgroundColor: '#A98BFF' },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomColor: '#3B4355', borderBottomWidth: 1 },
  rank: { color: '#737D91', width: 24, fontSize: 14 },
  thumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: '#242D3E' },
  song: { color: '#F3F3E9', fontSize: 16, fontWeight: '700' },
  voted: { color: '#A9B6FF', fontSize: 13 },
  vote: { width: 52, minHeight: 52, borderRadius: 12, backgroundColor: '#242D3E', alignItems: 'center', justifyContent: 'center', gap: 3 },
  voteOn: { backgroundColor: '#4961EE' },
  dim: { opacity: 0.5 },
  count: { color: '#F3F3E9', fontSize: 14, fontWeight: '700' },
});
