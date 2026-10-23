import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faGripVertical, faLock, faMusic, faPlus, faTrashCan } from '@fortawesome/free-solid-svg-icons';
import Sortable, { type SortableGridDragEndParams, type SortableGridRenderItem } from 'react-native-sortables';
import type { AnimatedRef } from 'react-native-reanimated';
import { useAutoDismiss } from '../hooks/useAutoDismiss';
import { useScreenToast } from '../components/Toast';
import { ApiError, type ApiClient } from '../api/client';
import { clock, songSeconds } from '../api/parties';
import { droppedPosition, playlistsApi, type PlaylistEntry, type PlaylistPage, type PlaylistSnapshot } from '../api/playlists';
import type { GoneReason, Live } from '../realtime/live';
import { BackLink } from '../components/BackLink';
import { Button } from '../components/FormControls';
import { styles } from '../components/ProfileUI';
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
  const [error, setError] = useState('');
  useAutoDismiss(error, setError);
  useScreenToast(error, ''); // shown at the bottom of the screen: a bin can be far down the list
  const alive = useRef(false);
  const working = useRef(false);
  const declining = useRef(false); // a private playlist is being declined: losing access then means the decline worked

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
    <SongRow entry={item} addedBy={item.addedBy.id === userId ? 'you' : item.addedBy.name} canEdit={canEdit} disabled={busy} onRemove={remove} />,
  [userId, canEdit, busy, remove]);

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

  const { playlist, songs, songsLength } = snapshot;
  const cover = songs[0]?.song.thumbnailUrl;
  const owner = page.owner.id === userId ? 'you' : page.owner.name;
  // A light button: only a border on the page background, blue for the main choice
  const outline = (title: string, onPress: () => void, main: boolean) =>
    <Pressable accessibilityRole="button" disabled={busy} onPress={onPress} style={({ pressed }) => [p.outline, main && p.outlineMain, (busy || pressed) && p.dim]}>
      <Text style={[p.outlineText, main && p.outlineMainText]}>{title}</Text>
    </Pressable>;
  return <View style={styles.section}>
    <View style={p.top}>
      <BackLink title="Back to playlists" disabled={busy} onPress={onBack} />
      {canEdit ? <Pressable accessibilityRole="button" accessibilityLabel="Add tracks" disabled={busy} onPress={() => setAdding(true)}
        style={({ pressed }) => [p.plus, (busy || pressed) && p.dim]}>
        <FontAwesomeIcon icon={faPlus} color="#A9B6FF" size={24} />
      </Pressable> : null}
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
      <View style={p.row}>{outline('Accept', () => answer(true), true)}{outline('Decline', () => answer(false), false)}</View>
    </View> : null}

    <Text style={p.heading}>The tracklist</Text>
    {songs.length === 0 ? <Text style={styles.text}>No tracks yet.</Text> : null}
    <Sortable.Grid columns={1} data={songs} keyExtractor={entry => entry.id} renderItem={renderSong} onDragEnd={moved}
      customHandle dragActivationDelay={0} scrollableRef={pageScroll} sortEnabled={canEdit && !busy && !moving} />
  </View>;
}

// One song of the tracklist. memo: drawn again only when what it shows changes. A song keeps its title, artist, picture
// and who added it, so its id is enough: a drop or a live update does not redraw every row (that work, during the drop
// animation, made it stutter)
const SongRow = memo(function SongRow({ entry, addedBy, canEdit, disabled, onRemove }: {
  entry: PlaylistEntry; addedBy: string; canEdit: boolean; disabled: boolean; onRemove: (entry: PlaylistEntry) => void;
}) {
  return <View style={p.entry}>
    {canEdit ? <Sortable.Handle><View style={p.handle}><FontAwesomeIcon icon={faGripVertical} color="#737D91" size={14} /></View></Sortable.Handle> : null}
    {entry.song.thumbnailUrl ? <Image source={{ uri: entry.song.thumbnailUrl }} style={p.thumb} /> : <View style={[p.thumb, p.blank]} />}
    <View style={p.grow}>
      <Text style={p.song} numberOfLines={1}>{entry.song.title}</Text>
      <Text style={styles.text} numberOfLines={1}>{entry.song.artist}</Text>
      <Text style={p.meta} numberOfLines={1}>{clock(songSeconds(entry.song.durationSec))} · added by {addedBy}</Text>
    </View>
    {canEdit ? <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${entry.song.title}`} disabled={disabled}
      onPress={() => onRemove(entry)} style={[p.bin, disabled && p.dim]}>
      <FontAwesomeIcon icon={faTrashCan} color="#B4BDCE" size={16} />
    </Pressable> : null}
  </View>;
}, (before, after) => before.entry.id === after.entry.id && before.addedBy === after.addedBy && before.canEdit === after.canEdit
  && before.disabled === after.disabled && before.onRemove === after.onRemove);

const p = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  plus: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, // only the +, with a finger-sized area to tap
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
  outline: { flex: 1, minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: '#3B4355', alignItems: 'center', justifyContent: 'center' },
  outlineMain: { borderColor: '#AEB5FF' },
  outlineText: { color: '#B4BDCE', fontSize: 15, fontWeight: '700' },
  outlineMainText: { color: '#A9B6FF' },
  heading: { color: '#F3F3E9', fontSize: 20, fontWeight: '700' },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomColor: '#3B4355', borderBottomWidth: 1 },
  handle: { width: 28, height: 44, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: '#242D3E' },
  song: { color: '#F3F3E9', fontSize: 16, fontWeight: '700' },
  meta: { color: '#737D91', fontSize: 12 },
  bin: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.5 },
});
