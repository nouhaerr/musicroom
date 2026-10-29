import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faArrowLeft, faCheck, faGlobe, faLock, faMusic, faSearch, faShieldHalved, faUsers } from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { ApiClient } from '../api/client';
import type { PublicProfile } from '../api/profiles';
import { socialApi } from '../api/social';
import { Button, Field } from '../components/FormControls';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { useScreenToast } from '../components/Toast';

type Playlist = { id: string; name: string; ownerId: string; visibility: 'PUBLIC' | 'PRIVATE'; editLicense: 'EVERYONE' | 'INVITED_ONLY' };
type Invitation = { id: string; status: 'PENDING' | 'ACCEPTED'; invitedUserId: string; invitedUser: PublicProfile };
export function AccessPeopleScreen({ client, playlistId, onBack, onBusy }: { client: ApiClient; playlistId: string; onBack: () => void; onBusy?: (busy: boolean) => void }) {
  const path = `/playlists/${encodeURIComponent(playlistId)}`;
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [visibility, setVisibility] = useState<Playlist['visibility']>('PUBLIC');
  const [editLicense, setEditLicense] = useState<Playlist['editLicense']>('EVERYONE');
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState('');
  const [searchPage, setSearchPage] = useState(1);
  const [people, setPeople] = useState<PublicProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  useScreenToast(loadError || error, success, loadError ? () => setReload(n => n + 1) : undefined);
  useEffect(() => { alive.current = true; return () => { alive.current = false; onBusy?.(false); }; }, [onBusy]);
  useEffect(() => { if (!error && !success) return; const timer = setTimeout(() => { setError(''); setSuccess(''); }, 10000); return () => clearTimeout(timer); }, [error, success]);
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError('');
    void Promise.all([client.request<Playlist>(path), client.request<Invitation[]>(`${path}/invitations?page=${page}&limit=20`)]).then(([detail, invited]) => {
      if (!active) return;
      setPlaylist(detail); setVisibility(detail.visibility); setEditLicense(detail.editLicense); setInvitations(invited);
    }).catch(e => { if (active) setLoadError(e instanceof Error ? e.message : 'Unable to load access settings.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, path, page, reload]);
  useEffect(() => {
    let active = true;
    setPeople([]); setSearchError('');
    if (!picker || !query.trim()) { setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      void socialApi(client).search(query.trim(), '', searchPage).then(result => { if (active) setPeople(result); })
        .catch(e => { if (active) setSearchError(e instanceof Error ? e.message : 'Unable to search people.'); })
        .finally(() => { if (active) setSearching(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [client, picker, query, searchPage]);
  async function mutate(operation: () => Promise<unknown>, message: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy?.(true); setError(''); setSuccess('');
    try { await operation(); if (alive.current) { setSuccess(message); setReload(n => n + 1); } }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Unable to save changes.'); }
    finally { lock.current = false; if (alive.current) { setBusy(false); onBusy?.(false); } }
  }
  const disabled = busy || loading || !!loadError;
  const dirty = !!playlist && (playlist.visibility !== visibility || playlist.editLicense !== editLicense);
  const back = () => dirty ? Alert.alert('Discard changes?', 'Your access settings have not been saved.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: onBack }]) : onBack();
  const link = (text: string, action: () => void, blocked = false) => <Pressable accessibilityRole="button" disabled={disabled || blocked} onPress={action} style={{ paddingVertical: 12, paddingHorizontal: 6, opacity: disabled || blocked ? 0.4 : 1 }}><Text style={s.link}>{text}</Text></Pressable>;
  const option = (title: string, description: string, selected: boolean, icon: IconDefinition, action: () => void) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={action} style={[s.option, selected && s.selected]}>
    <FontAwesomeIcon icon={icon} size={23} color="#adb6ff" /><View style={s.grow}><Text style={s.label}>{title}</Text><Text style={s.muted}>{description}</Text></View><View style={[s.radio, selected && s.radioSelected]} />
  </Pressable>;
  return <View style={s.screen}>
    <View style={s.row}><Pressable accessibilityRole="button" accessibilityLabel="Back to playlists" disabled={busy} onPress={back} style={{ padding: 12 }}><FontAwesomeIcon icon={faArrowLeft} size={22} color="#f5f5fa" /></Pressable><Text style={s.link}>Sonora</Text></View>
    <Text style={s.title}>Access & people</Text>
    {loading ? <ActivityIndicator color="#adb6ff" /> : null}
    {playlist ? <>
      <View style={s.person}><View style={s.art}><FontAwesomeIcon icon={faMusic} size={28} color="#adb6ff" /></View><View style={s.grow}><Text style={s.label}>{playlist.name}</Text><Text style={s.muted}>You own this collaborative playlist</Text></View></View>
      <Text style={s.heading}>Who can access?</Text>
      {option('Public · default', 'Anyone can discover and listen.', visibility === 'PUBLIC', faGlobe, () => setVisibility('PUBLIC'))}
      {option('Private', 'Only invited people can access.', visibility === 'PRIVATE', faLock, () => setVisibility('PRIVATE'))}
      <View style={s.card}><View style={s.row}><Text style={s.heading}>Invited people</Text>{link(picker ? 'Close' : 'Invite', () => setPicker(v => !v), dirty)}</View>
        <View style={s.person}><ProfileAvatar name={client.user?.name || 'You'} info={undefined} size={44} /><View style={s.grow}><Text style={s.label}>{client.user?.name || 'You'}</Text><Text style={s.muted}>You · Playlist owner</Text></View><Text style={s.link}>Owner</Text></View>
        {invitations.map(invite => <View key={invite.id} style={s.person}><ProfileAvatar name={invite.invitedUser.name} info={invite.invitedUser.publicInfo} size={44} /><View style={s.grow}><Text style={s.label}>{invite.invitedUser.name}</Text><Text style={s.muted}>{invite.status === 'ACCEPTED' ? 'Invitation accepted' : 'Invite sent · pending'}</Text></View>{link('Remove', () => Alert.alert('Remove invitation?', `${invite.invitedUser.name} will lose invited access and editing rights. Public access still follows your settings.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void mutate(() => client.request(`${path}/invitations/${encodeURIComponent(invite.invitedUserId)}`, 'DELETE'), 'Invitation removed.') }]), dirty)}</View>)}
        {!loading && !invitations.length ? <Text style={s.muted}>No invitations on this page.</Text> : null}
        <View style={s.row}>{link('Previous', () => setPage(p => p - 1), page === 1 || dirty)}<Text style={s.muted}>Page {page}</Text>{link('Next', () => setPage(p => p + 1), invitations.length < 20 || dirty)}</View>
        {picker ? <View style={{ gap: 12 }}><Field label="Find people" value={query} change={v => { setQuery(v); setSearchPage(1); }} icon={faSearch} />
          {searching ? <ActivityIndicator color="#adb6ff" /> : null}
          {searchError ? <Text accessibilityRole="alert" style={{ color: '#ffc0b7' }}>{searchError}</Text> : null}
          {!searching && query.trim() && !searchError && !people.length ? <Text style={s.muted}>No people found.</Text> : null}
          {people.filter(person => person.id !== playlist.ownerId).map(person => <View key={person.id} style={s.person}><ProfileAvatar name={person.name} info={person.publicInfo} size={40} /><Text style={[s.label, s.grow]}>{person.name}</Text>{link(invitations.some(i => i.invitedUserId === person.id) ? 'Invited' : 'Invite', () => void mutate(() => client.request(`${path}/invite`, 'POST', { userId: person.id }), 'Invitation saved.'), dirty || invitations.some(i => i.invitedUserId === person.id))}</View>)}
          {query.trim() ? <View style={s.row}>{link('Previous results', () => setSearchPage(p => p - 1), searchPage === 1 || searching)}{link('More results', () => setSearchPage(p => p + 1), people.length < 20 || searching)}</View> : null}
        </View> : null}
      </View>
      <Text style={s.heading}>Who can edit?</Text>
      {option('Everyone · default', 'Anyone with access can add, reorder and remove tracks.', editLicense === 'EVERYONE', faUsers, () => setEditLicense('EVERYONE'))}
      {option('Invited people only', 'Only invited collaborators can edit.', editLicense === 'INVITED_ONLY', faUsers, () => setEditLicense('INVITED_ONLY'))}
      <View style={[s.option, s.notice]}><FontAwesomeIcon icon={faShieldHalved} size={20} color="#adb6ff" /><Text style={[s.muted, s.grow, { color: '#adb6ff' }]}>For private playlists, access and editing are limited to invited people, even with Everyone selected.</Text></View>
      {dirty ? <Text style={s.muted}>Save your settings before managing invitations.</Text> : null}
      <Button title={busy ? 'Saving…' : 'Save access settings'} accent icon={faCheck} disabled={disabled || !dirty} onPress={() => void mutate(() => client.request(path + '/access', 'PATCH', { visibility, editLicense }), 'Access settings saved.')} />
    </> : null}
  </View>;
}
const s = StyleSheet.create({
  screen: { gap: 16, paddingBottom: 24 }, title: { color: '#f5f5fa', fontSize: 32, fontWeight: '700' },
  heading: { color: '#f5f5fa', fontSize: 23, fontWeight: '700', marginTop: 8 }, label: { color: '#f5f5fa', fontSize: 16, fontWeight: '600' },
  muted: { color: '#999bae', fontSize: 14, lineHeight: 21, marginTop: 4 }, link: { color: '#adb6ff', fontWeight: '600' }, grow: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  art: { width: 60, height: 60, backgroundColor: '#1e264b', borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 24, backgroundColor: '#13141c', padding: 18, gap: 12, marginVertical: 12 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: '#13141c', borderWidth: 1, borderColor: '#2c2e40', borderRadius: 18, padding: 18 },
  selected: { backgroundColor: '#1e264b', borderColor: '#535fff' }, radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: '#999bae' },
  radioSelected: { borderWidth: 6, borderColor: '#adb6ff', backgroundColor: '#535fff' }, notice: { backgroundColor: '#1e264b', borderWidth: 0, marginVertical: 12 },
});
