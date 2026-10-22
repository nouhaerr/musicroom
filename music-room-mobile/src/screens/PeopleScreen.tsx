import { useScreenToast } from '../components/Toast';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { useAutoDismiss } from '../hooks/useAutoDismiss';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faArrowLeft, faChevronRight, faMagnifyingGlass, faMusic, faUserGroup, faUserPlus, faUserCheck, faClock, faXmark, faCheck, faEllipsis } from '@fortawesome/free-solid-svg-icons';
import { ApiError, type ApiClient } from '../api/client';
import { PAGE_SIZE, visibleProfileSections, type FriendRequest, type PublicProfile } from '../api/profiles';
import { socialApi } from '../api/social';

type Tab = 'search' | 'friends' | 'requests';
const tabLabels: Record<Tab, string> = { friends: 'Friends', requests: 'Requests', search: 'Discover' };

export function PeopleScreen({ client, userId, onBusy, onBack }: {
  client: ApiClient; userId: string; onBusy: (busy: boolean) => void; onBack: () => void;
}) {
  const api = useMemo(() => socialApi(client), [client]);
  const [tab, setTab] = useState<Tab>('friends');
  const [q, setQ] = useState('');
  const [genre, setGenre] = useState('');
  const [filters, setFilters] = useState({ q: '', genre: '' });
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [rows, setRows] = useState<(PublicProfile | FriendRequest)[]>([]);
  const [selected, setSelected] = useState<PublicProfile | null>(null);
  const loadedList = useRef('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [retryAction, setRetryAction] = useState<(() => Promise<void>) | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  useAutoDismiss(notice, setNotice);
  useScreenToast(error || loadError, notice, error && retryAction ? () => void action(retryAction) : !error && loadError ? () => setReload(n => n + 1) : undefined);
  useAutoDismiss(retryAction ? '' : error, setError);
  const alive = useRef(false);
  const working = useRef(false);
  const disabled = loading || busy;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => { onBusy(disabled); return () => onBusy(false); }, [disabled, onBusy]);

  useEffect(() => {
    let active = true;
    const listKey = JSON.stringify([tab, filters.q, filters.genre, page]);
    if (loadedList.current !== listKey) { setRows([]); loadedList.current = listKey; }
    setLoading(true); setSelected(null); setLoadError('');
    const request = tab === 'search' ? api.search(filters.q, filters.genre, page)
      : tab === 'friends' ? api.friends(page) : api.pending(page);
    void request.then(result => { if (active) setRows(result); })
      .catch(e => { if (active) setLoadError(e instanceof Error ? e.message : 'Unable to load. Please try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, tab, filters.q, filters.genre, page, reload]);

  async function action(operation: () => Promise<void>) {
    if (working.current || loading) return;
    working.current = true; setRetryAction(null); setBusy(true); setError(''); setNotice('');
    try { await operation(); }
    catch (e) { if (alive.current) { setError(e instanceof Error ? e.message : 'Unable to complete this action.'); if (e instanceof ApiError && e.status === 0) setRetryAction(() => operation); } }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  function refresh(message: string) {
    if (!alive.current) return;
    setNotice(message); setSelected(null); setReload(value => value + 1);
  }
  function openProfile(person: PublicProfile) {
    void action(async () => {
      // Fetch each time: friendship may have changed since the list was loaded.
      const profile = await api.profile(person.id);
      if (alive.current) setSelected(profile);
    });
  }
  function send(person: PublicProfile) {
    void action(async () => {
      const result = await api.send(person.id);
      refresh(result.status === 'ACCEPTED' ? 'You are now friends.' : 'Friend request sent.');
    });
  }
  function remove(person: PublicProfile) {
    Alert.alert('Remove friend?', `${person.name} will no longer have access to your friends-only information.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        if (alive.current) void action(async () => { await api.remove(person.id); refresh('Friend removed.'); });
      } },
    ]);
  }
  function changeTab(next: Tab) {
    setRows([]); setSelected(null); setTab(next); setPage(1); setNotice(''); setError(''); setReload(value => value + 1);
  }

  const button = (title: string, onPress: () => void, secondary = false, blocked = false) =>
    <Pressable accessibilityRole="button" disabled={disabled || blocked} onPress={onPress}
      style={({ pressed }) => [s.button, secondary && s.secondary, (disabled || blocked || pressed) && s.dim]}>
      <Text style={s.buttonText}>{title}</Text>
    </Pressable>;
  const socialButton = (title: string, icon: IconDefinition, onPress: () => void, secondary = false, trailing?: IconDefinition, hint?: string) =>
    <Pressable accessibilityRole="button" accessibilityLabel={title === 'Pending' ? 'Cancel friend request' : title === 'Friends' ? 'Friend options' : title}
      accessibilityHint={hint} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [s.button, s.socialButton, secondary && s.secondary, (disabled || pressed) && s.dim]}>
      <FontAwesomeIcon icon={icon} size={16} color="#e4e7ff" />
      <Text style={s.buttonText}>{title}</Text>
      {trailing ? <FontAwesomeIcon icon={trailing} size={15} color="#b6bbdc" /> : null}
    </Pressable>;
  const pendingButton = (requestId: string) => socialButton('Pending', faClock, () => void action(async () => {
    await api.cancel(requestId); refresh('Friend request cancelled.');
  }), true, faXmark, 'Cancels the request you sent.');
  const incomingButtons = (requestId: string) => <View style={s.actions}>
    {socialButton('Accept', faCheck, () => void action(async () => {
      await api.accept(requestId); refresh('Friend request accepted.');
    }))}
    {socialButton('Decline', faXmark, () => void action(async () => {
      await api.reject(requestId); refresh('Friend request declined.');
    }), true)}
  </View>;
  const relationshipButton = (person: PublicProfile) => {
    if (tab === 'friends' || person.relationship === 'FRIENDS') return socialButton('Friends', faUserCheck, () => {
      Alert.alert(person.name, 'You are friends.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove friend', style: 'destructive', onPress: () => { if (alive.current) remove(person); } },
      ]);
    }, true, faEllipsis, 'Opens friendship options.');
    if (person.relationship === 'OUTGOING' && person.friendRequestId) return pendingButton(person.friendRequestId);
    if (person.relationship === 'INCOMING' && person.friendRequestId) return incomingButtons(person.friendRequestId);
    return socialButton('Add friend', faUserPlus, () => send(person));
  };
  const genres = (person: PublicProfile) => <View style={s.chips}>
    {person.musicPreferences.length ? person.musicPreferences.map(g => <View key={g} style={s.chip}><Text style={s.chipText}>{g}</Text></View>) : <Text style={s.muted}>No music preferences yet.</Text>}
  </View>;
  const identity = (person: PublicProfile) => <Pressable accessibilityRole="button" accessibilityLabel={`View ${person.name}'s profile`} disabled={disabled} onPress={() => openProfile(person)} style={s.identity}>
    <ProfileAvatar name={person.name} info={person.publicInfo} size={48} />
    <View style={s.grow}><Text style={s.name}>{person.name}</Text>{person.username ? <Text style={s.muted}>@{person.username}</Text> : null}</View>
    <FontAwesomeIcon icon={faChevronRight} size={14} color="#8589a1" />
  </Pressable>;
  const count = rows.filter(row => tab === 'requests' || row.id !== userId).length;
  return <View style={s.screen}>
    <Pressable accessibilityRole="button" disabled={disabled} onPress={selected ? () => setSelected(null) : onBack} style={s.back}>
      <FontAwesomeIcon icon={faArrowLeft} size={16} color="#aeb5ff" /><Text style={s.backText}>{selected ? 'Back to people' : 'Back to profile'}</Text>
    </Pressable>
    <View><Text style={s.eyebrow}>FRIENDS & DISCOVERY</Text><Text style={s.heading}>Find your people.</Text><Text style={s.subtitle}>Good music brings us together.</Text></View>
    {!selected ? <View accessibilityRole="tablist" style={s.tabs}>{(Object.keys(tabLabels) as Tab[]).map(key =>
      <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key, disabled }} disabled={disabled} onPress={() => changeTab(key)} style={[s.tab, tab === key && s.activeTab, busy && s.dim]}>
        <Text style={[s.tabText, tab === key && s.activeTabText]}>{tabLabels[key]}</Text>
      </Pressable>
    )}</View> : null}
    <View style={{ height: 20 }}>{disabled ? <ActivityIndicator color="#aeb5ff" accessibilityLabel="Loading people" /> : null}</View>
    {selected ? <>
      <View style={s.card}><View style={s.identity}><ProfileAvatar name={selected.name} info={selected.publicInfo} /><View style={s.grow}><Text style={s.sectionTitle}>{selected.name}</Text>{selected.username ? <Text style={s.muted}>@{selected.username}</Text> : null}</View></View>
        <Text style={s.label}>MUSIC DNA</Text>{genres(selected)}
      </View>
      {visibleProfileSections(selected).map(section => {
        const entries = Object.entries(section.info ?? {}).filter(([key, value]) => !['avatar', 'username', 'shareListeningActivity'].includes(key) && typeof value === 'string' && value !== '');
        const fieldLabels: Record<string, string> = { bio: 'Bio', city: 'City', favoriteArtists: 'Favorite artists' };
        return <View key={section.title} style={s.card}><Text style={s.sectionTitle}>{section.title}</Text>
          {entries.length ? entries.map(([key, value]) => <View key={key} style={s.field}><Text style={s.muted}>{fieldLabels[key] ?? key}</Text><Text style={s.body}>{String(value)}</Text></View>) : <Text style={s.muted}>No information shared yet.</Text>}
        </View>;
      })}
      {!Object.hasOwn(selected, 'friendsOnlyInfo') ? <View style={s.info}><Text style={s.infoText}>Friends-only details are shared after a friend request is accepted.</Text></View> : null}
    </> : <>
      {tab === 'search' ? <View style={s.card}>
        <Text style={s.sectionTitle}>A shared taste in music.</Text>
        <Text style={s.muted}>Search by name or username, and discover people who enjoy the same genres.</Text>
        <View style={s.field}><Text style={s.inputLabel}>Name or username</Text><View style={s.inputRow}><FontAwesomeIcon icon={faMagnifyingGlass} size={16} color="#8589a1" /><TextInput accessibilityLabel="Name or username" value={q} onChangeText={setQ} maxLength={100} editable={!disabled} autoCapitalize="none" placeholder="Search people" placeholderTextColor="#73778e" style={s.input} /></View></View>
        <View style={s.field}><Text style={s.inputLabel}>Music genre · optional</Text><View style={s.inputRow}><FontAwesomeIcon icon={faMusic} size={16} color="#8589a1" /><TextInput accessibilityLabel="Music genre" value={genre} onChangeText={setGenre} maxLength={50} editable={!disabled} autoCapitalize="none" placeholder="e.g. jazz" placeholderTextColor="#73778e" style={s.input} /></View></View>
        {socialButton('Find people', faMagnifyingGlass, () => { setFilters({ q: q.trim(), genre: genre.trim().toLowerCase() }); setPage(1); setReload(v => v + 1); setNotice(''); })}
      </View> : <View style={s.info}><FontAwesomeIcon icon={tab === 'friends' ? faUserGroup : faUserPlus} size={19} color="#aeb5ff" /><Text style={[s.infoText, s.grow]}>{tab === 'friends' ? 'Your circle. Your shared love of music.' : 'Accept an invitation or manage the requests you have sent.'}</Text></View>}
      <View style={s.sectionHeader}><Text style={s.sectionTitle}>{tab === 'friends' ? 'Your friends' : tab === 'requests' ? 'Pending requests' : 'People to discover'}</Text>{!loading && !error ? <Text style={s.muted}>{count} on this page</Text> : null}</View>
      {!loading && count === 0 && !error && !loadError ? <View style={s.empty}><FontAwesomeIcon icon={faUserGroup} size={28} color="#aeb5ff" /><Text style={s.sectionTitle}>{tab === 'requests' ? 'All caught up.' : tab === 'friends' ? 'Build your circle.' : 'No matches yet.'}</Text><Text style={[s.muted, s.center]}>{tab === 'requests' ? 'No pending requests on this page.' : tab === 'friends' ? 'Find people and send your first friend request.' : 'Try another name or music genre.'}</Text>{tab === 'friends' ? button('Discover people', () => changeTab('search')) : null}</View> : null}
      {rows.map(row => {
        if (tab === 'requests') {
          const request = row as FriendRequest;
          const incoming = request.receiverId === userId;
          const person = incoming ? request.sender : request.receiver;
          return <View key={request.id} style={s.card}>
            <Text style={s.label}>{incoming ? 'RECEIVED REQUEST' : 'SENT REQUEST'}</Text>{identity(person)}
            {incoming ? incomingButtons(request.id) : pendingButton(request.id)}
          </View>;
        }
        const person = row as PublicProfile;
        if (person.id === userId) return null;
        return <View key={person.id} style={s.card}>{identity(person)}{genres(person)}
          {relationshipButton(person)}
        </View>;
      })}
      {page > 1 || rows.length >= PAGE_SIZE ? <View style={s.pagination}>
        {button('Previous', () => { setPage(p => p - 1); setNotice(''); }, true, page === 1)}
        <Text style={s.muted}>Page {page}</Text>
        {button('Next', () => { setPage(p => p + 1); setNotice(''); }, true, rows.length < PAGE_SIZE || page >= 1000000)}
      </View> : null}
      {button('Refresh list', () => { setReload(v => v + 1); setNotice(''); }, true)}
    </>}
  </View>;
}

const s = StyleSheet.create({
  screen: { gap: 22, paddingTop: 4, paddingBottom: 12 }, grow: { flex: 1 },
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 44 },
  backText: { color: '#aeb5ff', fontSize: 13, fontWeight: '600' },
  eyebrow: { color: '#b28dff', fontSize: 11, fontWeight: '600', marginBottom: 9 },
  heading: { color: '#f5f5fa', fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.6 },
  subtitle: { color: '#999bae', fontSize: 14, lineHeight: 21, marginTop: 8 },
  tabs: { flexDirection: 'row', padding: 5, gap: 4, borderRadius: 15, backgroundColor: '#13141c' },
  tab: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4, borderRadius: 11 },
  activeTab: { backgroundColor: '#252c56' }, tabText: { color: '#999bae', fontSize: 13, fontWeight: '600' }, activeTabText: { color: '#c4caff' },
  card: { backgroundColor: '#13141c', borderRadius: 22, padding: 19, gap: 17 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 48 },
  name: { color: '#f5f5fa', fontSize: 17, lineHeight: 23, fontWeight: '600' },
  sectionTitle: { color: '#f5f5fa', fontSize: 19, lineHeight: 25, fontWeight: '700' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  muted: { color: '#999bae', fontSize: 13, lineHeight: 20 }, body: { color: '#e1e2ee', fontSize: 14, lineHeight: 21 },
  label: { color: '#aeb5ff', fontSize: 10, fontWeight: '600', letterSpacing: 0.8 },
  field: { gap: 7 }, inputLabel: { color: '#b8bacc', fontSize: 12, fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#0e0f16', borderWidth: 1, borderColor: '#2b2d40', borderRadius: 13, paddingHorizontal: 13 },
  input: { flex: 1, minHeight: 48, paddingVertical: 12, color: '#f5f5fa', fontSize: 14 },
  button: { flexGrow: 1, minHeight: 46, paddingVertical: 13, paddingHorizontal: 15, borderRadius: 13, backgroundColor: '#535fff', justifyContent: 'center', alignItems: 'center' },
  secondary: { backgroundColor: '#1e1f2b', borderWidth: 1, borderColor: '#2b2d40' },
  buttonText: { color: '#f5f5fa', fontSize: 13, fontWeight: '600' }, dim: { opacity: 0.45 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, chip: { backgroundColor: '#252344', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }, chipText: { color: '#c2b0ff', fontSize: 11 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16, backgroundColor: '#1d254b' }, infoText: { color: '#aeb5ff', fontSize: 13, lineHeight: 20 },
  empty: { alignItems: 'center', gap: 14, padding: 26, backgroundColor: '#13141c', borderRadius: 22 }, center: { textAlign: 'center' },
  socialButton: { flexDirection: 'row', gap: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, pagination: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  error: { color: '#ffb5ba', backgroundColor: '#35202a', padding: 14, borderRadius: 13, lineHeight: 21 },
  notice: { color: '#cadbff', backgroundColor: '#1d254b', padding: 14, borderRadius: 13, lineHeight: 21 },
});
