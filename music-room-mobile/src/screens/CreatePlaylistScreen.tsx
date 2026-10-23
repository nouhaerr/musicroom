import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faGlobe, faLock, faUserCheck, faUsers } from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { useAutoDismiss } from '../hooks/useAutoDismiss';
import { useScreenToast } from '../components/Toast';
import type { ApiClient } from '../api/client';
import { playlistsApi, type Playlist } from '../api/playlists';
import { BackLink } from '../components/BackLink';
import { Field } from '../components/FormControls';
import { FriendPicker } from '../components/FriendPicker';
import { OutlineButton } from '../components/OutlineButton';
import { styles } from '../components/ProfileUI';

// A new playlist: its name, who can find it, who can edit it, and the friends invited to it
export function CreatePlaylistScreen({ client, onCreated, onBack }: {
  client: ApiClient; onCreated: (playlistId: string) => void; onBack: () => void;
}) {
  const api = useMemo(() => playlistsApi(client), [client]);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<Playlist['visibility']>('PUBLIC');
  const [editLicense, setEditLicense] = useState<Playlist['editLicense']>('EVERYONE');
  const [invited, setInvited] = useState(new Map<string, string>()); // friend id → name
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useAutoDismiss(error, setError);
  useScreenToast(error, ''); // shown at the bottom of the screen: the Create button is at the end of a long page
  const alive = useRef(false);
  const working = useRef(false);
  const inviting = visibility === 'PRIVATE' || editLicense === 'INVITED_ONLY'; // an invitation gives something only there

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  async function run(operation: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await operation(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Unable to create the playlist.'); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function create() {
    const playlist = await api.create({ name: name.trim(), visibility, editLicense });
    // The playlist exists from here on: a failed invitation does not undo it. A hidden list of friends sends nothing.
    const guests = inviting ? [...invited] : [];
    const answers = await Promise.allSettled(guests.map(([userId]) => api.invite(playlist.id, userId)));
    const missed = guests
      .filter((_, index) => answers[index].status === 'rejected')
      .map(([, friend]) => friend);
    if (!alive.current) return;
    if (missed.length === 0) onCreated(playlist.id);
    else Alert.alert('Playlist created', `These friends could not be invited: ${missed.join(', ')}.`, [{ text: 'OK', onPress: () => onCreated(playlist.id) }]);
  }

  const choice = (selected: boolean, icon: IconDefinition, title: string, text: string, onPress: () => void) =>
    <Pressable accessibilityRole="radio" accessibilityState={{ selected, disabled: busy }} disabled={busy} onPress={onPress}
      style={[c.choice, selected && c.chosen]}>
      <FontAwesomeIcon icon={icon} color={selected ? '#F3F3E9' : '#A4ADBF'} size={18} />
      <View style={c.grow}><Text style={c.title}>{title}</Text><Text style={styles.text}>{text}</Text></View>
    </Pressable>;

  return <View style={styles.section}>
    <BackLink title="Back to playlists" disabled={busy} onPress={onBack} />
    <Text style={styles.title}>Create a playlist</Text>
    <Field label="Playlist name" value={name} change={setName} maxLength={100} />

    <Text style={c.heading}>Who can find it?</Text>
    {choice(visibility === 'PUBLIC', faGlobe, 'Public', 'Anyone can discover and listen.', () => setVisibility('PUBLIC'))}
    {choice(visibility === 'PRIVATE', faLock, 'Private', 'Only invited people can access.', () => setVisibility('PRIVATE'))}

    <Text style={c.heading}>Who can edit?</Text>
    {choice(editLicense === 'EVERYONE', faUsers, 'Everyone', 'Anyone who can see it can add, reorder and remove tracks.', () => setEditLicense('EVERYONE'))}
    {choice(editLicense === 'INVITED_ONLY', faUserCheck, 'Invited people only', 'Only the friends you invite, once they accept.', () => setEditLicense('INVITED_ONLY'))}

    {inviting ? <>
      <Text style={c.heading}>Invite your circle</Text>
      <FriendPicker client={client} picked={invited} onChange={setInvited} disabled={busy} />
    </> : null}
    <OutlineButton title={visibility === 'PUBLIC' ? 'Create public playlist' : 'Create private playlist'} main
      disabled={busy || !name.trim()} onPress={() => void run(create)} />
  </View>;
}

const c = StyleSheet.create({
  heading: { color: '#F3F3E9', fontSize: 19, fontWeight: '700', marginTop: 10 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#3B4355', backgroundColor: '#111722' },
  chosen: { borderColor: '#4961EE', backgroundColor: '#1E2A5C' },
  grow: { flex: 1, gap: 2 },
  title: { color: '#F3F3E9', fontSize: 16, fontWeight: '700' },
});
