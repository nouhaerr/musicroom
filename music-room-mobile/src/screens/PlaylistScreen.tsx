import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faGripVertical, faLock, faMusic, faPlay, faPlus, faStop, faTrashCan, faUsers } from '@fortawesome/free-solid-svg-icons';
import { useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import Sortable, { type SortableGridDragEndParams, type SortableGridRenderItem } from 'react-native-sortables';
import type { AnimatedRef } from 'react-native-reanimated';
import { useAutoDismiss } from '../hooks/useAutoDismiss';
import { useScreenToast } from '../components/Toast';
import { ApiError, type ApiClient } from '../api/client';
import { clock, songSeconds } from '../api/parties';
import { droppedPosition, playlistsApi, type PlaylistEntry, type PlaylistPage, type PlaylistSnapshot } from '../api/playlists';
import type { GoneReason, Live } from '../realtime/live';
import { EXTRACT_SECONDS, playExtract, stopExtract, useExtractPlayer } from '../audio/extract';
import { BackLink } from '../components/BackLink';
import { Button } from '../components/FormControls';
import { OutlineButton } from '../components/OutlineButton';
import { styles } from '../components/ProfileUI';
import { AccessPeopleScreen } from './AccessPeopleScreen';
import { AddTracksScreen } from './AddTracksScreen';

// Why the page can no longer show the playlist, in words for the user
const GONE: Record<GoneReason, string> = {
  FORBIDDEN: 'You no longer have access to this playlist.',
  NOT_FOUND: 'This playlist no longer exists.',
  TOO_MANY_CONNECTIONS: 'Your account is open on too many devices.',
  UNAUTHORIZED: 'The server refused the live connection. Please log in again.',
  SIGNED_OUT: 'You are logged out.',
  BAD_REQUEST: 'Live updates are unavailable for this playlist.',
  TOO_MANY: 'Too many pages are open at once.',
};

export function PlaylistScreen({ client, live, pageScroll, playlistId, onBack }: {
  client: ApiClient; live: Live; pageScroll: AnimatedRef; playlistId: string; onBack: () => void;
}) {
  const api = useMemo(() => playlistsApi(client), [client]);
  const [snapshot, setSnapshot] = useState<PlaylistSnapshot | null>(null);
  const [gone, setGone] = useState<GoneReason | null>(null);
  const [page, setPage] = useState<PlaylistPage | null>(null);
  const [pageError, setPageError] = useState('');
  const [reloadPage, setReloadPage] = useState(0); // counts the reloads of the page data: "Try again", an answer, a refusal
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false); // a move is on its way to the server: no other drag until it is answered
  const [adding, setAdding] = useState(false); // the Add tracks page is open, drawn in place of this one
  const [managing, setManaging] = useState(false); // the owner's Access & people page is open, drawn in place of this one
  const [error, setError] = useState('');
  useAutoDismiss(error, setError);
  useScreenToast(error, ''); // shown at the bottom of the screen: a bin can be far down the list
  const alive = useRef(false);
  const working = useRef(false);
  const declining = useRef(false); // a private playlist is being declined: losing access then means the decline worked
  const player = useExtractPlayer();
  const [listening, setListening] = useState<string | null>(null); // the song whose extract plays on this phone
  const [startedAt, setStartedAt] = useState<number | null>(null); // when its extract started, on this phone's clock
  const asked = useRef(0); // counts the songs asked for: the answer for an older one is dropped
  const listed = useRef<PlaylistEntry[]>([]); // the list as it is now, for the song that comes next
  listed.current = snapshot?.songs ?? [];

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Watch the playlist while the page is open: each snapshot replaces the songs shown
  useEffect(() => live.watchPlaylist(playlistId, {
    onSnapshot: setSnapshot,
    // Declining a private playlist ends the right to watch it, often before the answer to the decline arrives: leave at once
    onGone: reason => { if (declining.current) onBack(); else setGone(reason); },
  }), [live, playlistId]);

  // Load what the snapshot cannot tell, being the same message for everyone: the owner, whether I may edit, my invitation
  useEffect(() => {
    let active = true;
    setPageError('');
    void api.page(playlistId).then(found => { if (active) setPage(found); })
      .catch(e => { if (active) setPageError(e instanceof Error ? e.message : 'Unable to load the playlist.'); });
    return () => { active = false; };
  }, [api, playlistId, reloadPage]);

  // Plays this song on this phone, or stops when there is none. A song without an extract is skipped, like a radio would.
  const listen = useCallback((entry: PlaylistEntry | undefined) => {
    const ask = ++asked.current;
    stopExtract(player); // the last song stops at once, even while the link of the next one loads
    setStartedAt(null);
    if (!entry) { setListening(null); return; }
    setListening(entry.id);
    void playExtract(player, client, entry.song.id, 0, () => asked.current === ask)
      .then(found => {
        if (asked.current !== ask || !alive.current) return;
        if (found) setStartedAt(Date.now());
        else listen(after(listed.current, entry.id));
      })
      .catch(e => {
        if (asked.current !== ask || !alive.current) return;
        setListening(null); setError(e instanceof Error ? e.message : 'Unable to play this song.');
      });
  }, [player, client]);
  const toggle = useCallback((entry: PlaylistEntry) => listen(entry.id === listening ? undefined : entry), [listen, listening]);
  // Someone removed the song playing here: it stops
  useEffect(() => {
    if (listening && snapshot && !snapshot.songs.some(entry => entry.id === listening)) listen(undefined);
  }, [snapshot, listening, listen]);

  // Kept the same between drawings (it only uses refs and setters), and so is remove: the rows that receive it stay drawn
  const action = useCallback(async (operation: () => Promise<unknown>) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await operation(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Unable to complete this action.'); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }, []);
  const remove = useCallback((entry: PlaylistEntry) => {
    Alert.alert('Remove this song?', `${entry.song.title} will be removed from the playlist for everyone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void action(async () => {
        try { await api.remove(playlistId, entry.id); }
        catch (e) {
          if (e instanceof ApiError && e.status === 404) return; // someone removed it first: the song is gone, as wanted
          if (e instanceof ApiError && e.status === 403) setReloadPage(n => n + 1); // no longer allowed: the bins go away
          throw e;
        }
      }) },
    ]);
  }, [api, playlistId, action]);
  // A song dropped somewhere else: it alone gets a new place, shown at once so that a next drag counts with the right places.
  // Other drags wait for the server's answer; if it refuses, the list goes back to the order before the drop.
  function moved({ fromIndex, toIndex, data }: SortableGridDragEndParams<PlaylistEntry>) {
    if (fromIndex === toIndex || !snapshot) return;
    const entry = data[toIndex];
    const position = droppedPosition(data, toIndex);
    const before = snapshot.songs;
    const shown = data.map(item => item.id === entry.id ? { ...item, position } : item);
    setSnapshot(current => current && { ...current, songs: shown });
    setMoving(true);
    void api.move(playlistId, entry.id, position, entry.position)
      .catch(e => {
        if (!alive.current) return;
        // Back to the order before the drop, unless the server has sent a newer one meanwhile
        setSnapshot(current => current && current.songs === shown ? { ...current, songs: before } : current);
        if (e instanceof ApiError && e.status === 404) return; // someone removed the song: the live update takes it away
        if (e instanceof ApiError && e.status === 403) setReloadPage(n => n + 1); // no longer allowed: the dots and bins go away
        setError(e instanceof Error ? e.message : 'Unable to move this song.');
      })
      .finally(() => { if (alive.current) setMoving(false); });
  }
  function answer(accept: boolean) {
    const invitation = page?.invitation;
    if (!invitation) return;
    const leaves = !accept && snapshot?.playlist.visibility === 'PRIVATE'; // declining a private playlist ends the right to see it
    declining.current = leaves;
    void action(async () => {
      try { await api.answer(invitation.id, accept); }
      catch (e) {
        // Already answered, from another device: the page data tells what is true now
        if (e instanceof ApiError && e.status === 409) { if (alive.current) setReloadPage(n => n + 1); return; }
        throw e;
      }
      if (!alive.current) return; // already left: the end of access arrived first
      if (leaves) onBack();
      else setReloadPage(n => n + 1);
    }).finally(() => { declining.current = false; });
  }

  // How the drag list draws one song. Kept the same between drawings, like the rows themselves (SongRow)
  const canEdit = page?.canEdit ?? false;
  const userId = client.user?.id;
  const renderSong = useCallback<SortableGridRenderItem<PlaylistEntry>>(({ item }) =>
    <SongRow entry={item} addedBy={item.addedBy.id === userId ? 'you' : item.addedBy.name} canEdit={canEdit} disabled={busy}
      playing={item.id === listening} onPlay={toggle} onRemove={remove} />,
  [userId, canEdit, busy, listening, toggle, remove]);

  if (gone) {
    return <View style={styles.section}>
      <BackLink title="Back to playlists" onPress={onBack} />
      <Text accessibilityRole="alert" style={styles.error}>{GONE[gone]}</Text>
    </View>;
  }
  if (!snapshot || !page) {
    return <View style={styles.section}>
      <BackLink title="Back to playlists" onPress={onBack} />
      {pageError ? <>
        <Text accessibilityRole="alert" style={styles.error}>{pageError}</Text>
        <Button title="Try again" secondary onPress={() => setReloadPage(n => n + 1)} />
      </> : <>
        <ActivityIndicator color="#B7F576" accessibilityLabel="Connecting to the playlist" />
        <Text style={styles.text}>Connecting…</Text>
      </>}
    </View>;
  }

  if (adding) {
    return <AddTracksScreen client={client} playlistId={playlistId} name={snapshot.playlist.name} songs={snapshot.songs}
      onForbidden={() => setReloadPage(n => n + 1)} onBack={() => setAdding(false)} />;
  }
  // Back from it, the page data is read again: who may edit may have changed there
  if (managing) {
    return <AccessPeopleScreen client={client} playlistId={playlistId} onBack={() => { setManaging(false); setReloadPage(n => n + 1); }} />;
  }

  const { playlist, songs, songsLength } = snapshot;
  const cover = songs[0]?.song.thumbnailUrl;
  const owner = page.owner.id === userId ? 'you' : page.owner.name;
  return <View style={styles.section}>
    <View style={p.top}>
      <BackLink title="Back to playlists" disabled={busy} onPress={onBack} />
      <View style={p.icons}>
        {page.owner.id === userId ? <Pressable accessibilityRole="button" accessibilityLabel="Access & people" disabled={busy} onPress={() => setManaging(true)}
          style={({ pressed }) => [p.icon, (busy || pressed) && p.dim]}>
          <FontAwesomeIcon icon={faUsers} color="#A9B6FF" size={24} />
        </Pressable> : null}
        {canEdit ? <Pressable accessibilityRole="button" accessibilityLabel="Add tracks" disabled={busy} onPress={() => setAdding(true)}
          style={({ pressed }) => [p.icon, (busy || pressed) && p.dim]}>
          <FontAwesomeIcon icon={faPlus} color="#A9B6FF" size={24} />
        </Pressable> : null}
      </View>
    </View>
    <View style={p.header}>
      {cover ? <Image source={{ uri: cover }} style={p.cover} />
        : <View style={[p.cover, p.blank]}><FontAwesomeIcon icon={playlist.visibility === 'PRIVATE' ? faLock : faMusic} color="#A9B6FF" size={28} /></View>}
      <View style={p.grow}>
        <Text style={p.title}>{playlist.name}</Text>
        <Text style={p.rule}>{playlist.visibility === 'PUBLIC' ? 'Public' : 'Private'} · {playlist.editLicense === 'EVERYONE' ? 'Everyone edits' : 'Invitees edit'}</Text>
        <Text style={styles.text}>{songsLength} {songsLength === 1 ? 'track' : 'tracks'} · Created by {owner}</Text>
      </View>
    </View>
    {page.invitation?.status === 'PENDING' ? <View style={p.invite}>
      <Text style={p.eyebrow}>INVITATION</Text>
      <Text style={p.inviteText}>You're invited to this playlist.</Text>
      <View style={p.row}>
        <View style={p.grow}><OutlineButton title="Accept" main disabled={busy} onPress={() => answer(true)} /></View>
        <View style={p.grow}><OutlineButton title="Decline" disabled={busy} onPress={() => answer(false)} /></View>
      </View>
    </View> : null}

    {listening ? <NowPlaying player={player} title={listed.current.find(entry => entry.id === listening)?.song.title ?? ''} startedAt={startedAt}
      onStop={() => listen(undefined)} onEnd={() => listen(after(listed.current, listening))} /> : null}
    <Text style={p.heading}>The tracklist</Text>
    {songs.length === 0 ? <Text style={styles.text}>No tracks yet.</Text> : null}
    <Sortable.Grid columns={1} data={songs} keyExtractor={entry => entry.id} renderItem={renderSong} onDragEnd={moved}
      customHandle dragActivationDelay={0} scrollableRef={pageScroll} sortEnabled={canEdit && !busy && !moving} />
  </View>;
}

// One song of the tracklist. memo: drawn again only when what it shows changes. A song keeps its title, artist, picture
// and who added it, so its id is enough: a drop or a live update does not redraw every row (that work, during the drop
// animation, made it stutter)
const SongRow = memo(function SongRow({ entry, addedBy, canEdit, disabled, playing, onPlay, onRemove }: {
  entry: PlaylistEntry; addedBy: string; canEdit: boolean; disabled: boolean; playing: boolean;
  onPlay: (entry: PlaylistEntry) => void; onRemove: (entry: PlaylistEntry) => void;
}) {
  return <View style={p.entry}>
    {canEdit ? <Sortable.Handle><View style={p.handle}><FontAwesomeIcon icon={faGripVertical} color="#737D91" size={14} /></View></Sortable.Handle> : null}
    {entry.song.thumbnailUrl ? <Image source={{ uri: entry.song.thumbnailUrl }} style={p.thumb} /> : <View style={[p.thumb, p.blank]} />}
    <View style={p.grow}>
      <Text style={p.song} numberOfLines={1}>{entry.song.title}</Text>
      <Text style={styles.text} numberOfLines={1}>{entry.song.artist}</Text>
      <Text style={p.meta} numberOfLines={1}>{clock(songSeconds(entry.song.durationSec))} · added by {addedBy}</Text>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${playing ? 'Stop' : 'Play'} ${entry.song.title}`} onPress={() => onPlay(entry)}
      style={({ pressed }) => [p.bin, pressed && p.dim]}>
      <FontAwesomeIcon icon={playing ? faStop : faPlay} color={playing ? '#B7F576' : '#A9B6FF'} size={16} />
    </Pressable>
    {canEdit ? <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${entry.song.title}`} disabled={disabled}
      onPress={() => onRemove(entry)} style={[p.bin, disabled && p.dim]}>
      <FontAwesomeIcon icon={faTrashCan} color="#B4BDCE" size={16} />
    </Pressable> : null}
  </View>;
}, (before, after) => before.entry.id === after.entry.id && before.addedBy === after.addedBy && before.canEdit === after.canEdit
  && before.disabled === after.disabled && before.playing === after.playing && before.onPlay === after.onPlay
  && before.onRemove === after.onRemove);

// The song after this one in the list, or none after the last one (or when this one is no longer in the list)
function after(list: PlaylistEntry[], id: string) {
  const index = list.findIndex(entry => entry.id === id);
  return index < 0 ? undefined : list[index + 1];
}

// The song playing on this phone, with its bar. The bar counts from when the extract started, like the room's, so it never
// shows where the last song stopped. Apart from the page: only this card is drawn again every second.
function NowPlaying({ player, title, startedAt, onStop, onEnd }: {
  player: AudioPlayer; title: string; startedAt: number | null; onStop: () => void; onEnd: () => void;
}) {
  const status = useAudioPlayerStatus(player);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (status.didJustFinish) onEnd(); }, [status.didJustFinish]);
  const elapsed = startedAt === null ? 0 : Math.min(Math.max(Math.floor((now - startedAt) / 1000), 0), EXTRACT_SECONDS);
  const duration = EXTRACT_SECONDS;
  return <View style={p.card}>
    <View style={p.row}>
      <View style={p.grow}>
        <Text style={p.eyebrow}>NOW PLAYING</Text>
        <Text style={p.song} numberOfLines={1}>{title}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Stop ${title}`} onPress={onStop} style={({ pressed }) => [p.bin, pressed && p.dim]}>
        <FontAwesomeIcon icon={faStop} color="#B7F576" size={16} />
      </Pressable>
    </View>
    <View style={p.track}>
      <View style={[p.bar, { flex: elapsed }]} />
      <View style={{ flex: Math.max(duration - elapsed, 0) }} />
    </View>
    <View style={p.between}>
      <Text style={styles.text}>{clock(elapsed)}</Text>
      <Text style={styles.text}>{clock(duration)}</Text>
    </View>
  </View>;
}

const p = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  icons: { flexDirection: 'row' },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, // only the icon, with a finger-sized area to tap
  header: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  cover: { width: 96, height: 96, borderRadius: 14 },
  blank: { backgroundColor: '#242D3E', alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, gap: 4 },
  title: { color: '#F3F3E9', fontSize: 28, fontWeight: '800' },
  rule: { color: '#A9B6FF', fontSize: 13, fontWeight: '600' },
  invite: { gap: 10 },
  eyebrow: { color: '#A98BFF', fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  inviteText: { color: '#F3F3E9', fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 12 },
  heading: { color: '#F3F3E9', fontSize: 20, fontWeight: '700' },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomColor: '#3B4355', borderBottomWidth: 1 },
  handle: { width: 28, height: 44, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: '#242D3E' },
  song: { color: '#F3F3E9', fontSize: 16, fontWeight: '700' },
  meta: { color: '#737D91', fontSize: 12 },
  bin: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.5 },
  card: { backgroundColor: '#171A25', borderRadius: 16, padding: 16, gap: 10 },
  track: { flexDirection: 'row', height: 4, borderRadius: 2, backgroundColor: '#242D3E', overflow: 'hidden' },
  bar: { backgroundColor: '#A98BFF' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
});
