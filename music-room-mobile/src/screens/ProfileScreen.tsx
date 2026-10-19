import { useScreenToast } from '../components/Toast';
import { editableInfo } from '../api/profiles';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { chooseProfilePhoto } from '../auth/profile-photo';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faGoogle, faFacebookF } from '@fortawesome/free-brands-svg-icons';
import { faPen, faGlobe, faUsers, faLock, faSliders, faRightFromBracket } from '@fortawesome/free-solid-svg-icons';
import { ApiError, normalizeBaseUrl, type ApiClient } from '../api/client';
import { type OwnProfile, type ProfileInfo } from '../api/profiles';
import { acquireGoogleIdToken } from '../auth/native-google';
import { acquireFacebookCredential } from '../auth/native-facebook';
import { useAutoDismiss } from '../hooks/useAutoDismiss';

type Section = 'public' | 'friends' | 'private' | 'music';
const value = (info: ProfileInfo | undefined, key: string) => typeof info?.[key] === 'string' ? info[key] as string : '';

export function ProfileScreen({ client, onBusy, onLogout, onServer, onPeople }: {
  client: ApiClient; onBusy: (busy: boolean) => void; onLogout: () => Promise<void>;
  onServer: (url: string) => Promise<void>; onPeople: () => void;
}) {
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [editing, setEditing] = useState<Section | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [server, setServer] = useState(client.baseUrl);
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAction, setRetryAction] = useState<(() => Promise<void>) | null>(null);
  const [notice, setNotice] = useState('');
  useAutoDismiss(notice, setNotice); useAutoDismiss(profile && !retryAction ? error : '', setError);
  useScreenToast(error, notice, error && retryAction ? () => void run(retryAction) : !profile && error ? () => void run(async () => { const p = await client.getMyProfile(); if (alive.current) setProfile(p); }) : undefined);
  const alive = useRef(false), working = useRef(false);
  useEffect(() => {
    alive.current = true;
    void run(async () => { const p = await client.getMyProfile(); if (alive.current) setProfile(p); });
    return () => { alive.current = false; onBusy(false); };
  }, [client]);
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setRetryAction(null); setBusy(true); onBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (e) { if (alive.current) { setError(e instanceof Error ? e.message : 'Unable to update your profile.'); if (e instanceof ApiError && e.status === 0) setRetryAction(() => action); } }
    finally { working.current = false; if (alive.current) { setBusy(false); onBusy(false); } }
  }
  function edit(section: Section) {
    if (!profile) return;
    setEditing(section); setError(''); setFieldErrors({});
    setFields({ name: profile.name, username: (profile.username ?? ''), bio: value(profile.publicInfo, 'bio'),
      city: value(profile.friendsOnlyInfo, 'city'), birthday: value(profile.privateInfo, 'birthday'),
      genres: profile.musicPreferences.join(', '), artists: value(profile.publicInfo, 'favoriteArtists') });
  }
  async function save() {
    if (!profile || !editing) return;
    const invalid = (field: string, message: string) => { setFieldErrors({ [field]: message }); };
    setFieldErrors({});
    let changes: Record<string, unknown> = {};
    if (editing === 'public') {
      if (!fields.name.trim()) return invalid('name', 'Enter your display name.');
      const username = fields.username.trim().replace(/^@/, '').toLowerCase();
      if (username && !/^[a-z0-9_]{3,30}$/.test(username)) return invalid('username', 'Username must contain 3–30 letters, numbers or underscores.');
      changes = { name: fields.name.trim(), username: username || null, publicInfo: { ...editableInfo(profile.publicInfo), bio: fields.bio.trim() } };
    } else if (editing === 'friends') changes = { friendsOnlyInfo: { ...editableInfo(profile.friendsOnlyInfo), city: fields.city.trim() } };
    else if (editing === 'private') {
      const birthday = fields.birthday.trim();
      if (birthday && (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) || !Number.isFinite(Date.parse(birthday)) || new Date(birthday).toISOString().slice(0, 10) !== birthday || birthday > new Date().toISOString().slice(0, 10))) return invalid('birthday', 'Enter a valid birthday in YYYY-MM-DD format.');
      changes = { privateInfo: { ...editableInfo(profile.privateInfo), birthday } };
    } else {
      const genres = [...new Set(fields.genres.split(',').map(g => g.trim().toLowerCase()).filter(Boolean))];
      if (genres.length > 50 || genres.some(g => g.length > 50)) return invalid('genres', 'Choose up to 50 genres, with no more than 50 characters each.');
      changes = { musicPreferences: genres, publicInfo: { ...editableInfo(profile.publicInfo), favoriteArtists: fields.artists.trim() } };
    }
    let updated: OwnProfile;
    try { updated = await client.patchMyProfile(changes); }
    catch (e) {
      if (e instanceof ApiError && e.status === 409 && editing === 'public') return invalid('username', e.message);
      throw e;
    }
    if (alive.current) { setProfile(updated); setEditing(null); setNotice('Profile saved.'); }
  }
  function editPhoto() {
    Alert.alert('Profile photo', 'Your profile photo is visible to everyone.', [
      { text: 'Choose photo', onPress: () => void run(async () => {
        const image = await chooseProfilePhoto();
        if (!image || !alive.current) return;
        const updated = await client.setAvatar(image);
        if (alive.current) { setProfile(updated); setNotice('Profile photo saved.'); }
      }) },
      ...(profile?.publicInfo?.avatar ? [{ text: 'Remove photo', onPress: () => void run(async () => {
        const updated = await client.setAvatar(null);
        if (alive.current) { setProfile(updated); setNotice('Profile photo removed.'); }
      }) }] : []),
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function social(provider: 'google' | 'facebook') {
    const linked = provider === 'google' ? profile?.googleId : profile?.facebookId;
    const label = provider === 'google' ? 'Google' : 'Facebook';
    Alert.alert(`${linked ? 'Unlink' : 'Link'} ${label}?`, linked ? 'This provider will no longer sign in to your account. You must keep another sign-in method.' : `The account you select will be able to sign in to ${profile?.email}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: linked ? 'Unlink' : 'Continue', onPress: () => void run(async () => {
        if (linked) { const p = await client.unlinkSocial(provider); if (alive.current) setProfile(p); }
        else {
          const result = provider === 'google' ? await client.linkGoogle(acquireGoogleIdToken) : await client.linkFacebook(acquireFacebookCredential);
          if (!result) { if (alive.current) setNotice(`${label} linking cancelled.`); return; }
          if (alive.current) setProfile(client.user as OwnProfile);
        }
        if (alive.current) setNotice(`${label} account ${linked ? 'unlinked' : 'linked'}.`);
      }) },
    ]);
  }
  const button = (label: string, action: () => void, full = false) => <Pressable accessibilityRole="button" disabled={busy} onPress={action} style={[full && s.button, busy && { opacity: 0.5 }]}><Text style={full ? s.buttonText : s.link}>{label}</Text></Pressable>;
  const input = (key: string, label: string, multiline = false) => <View style={s.field}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} value={fields[key]} onChangeText={v => { setFields(f => ({ ...f, [key]: v })); setFieldErrors(errors => ({ ...errors, [key]: '' })); }} editable={!busy} multiline={multiline} autoCapitalize="none" style={[s.input, fieldErrors[key] ? { borderColor: '#ffaaaa' } : null]} maxLength={key === 'bio' ? 500 : key === 'name' ? 100 : key === 'username' ? 30 : 250} />{fieldErrors[key] ? <Text accessibilityRole="alert" style={s.error}>{fieldErrors[key]}</Text> : null}</View>;
  const detail = (label: string, text: string) => <View style={s.field}><Text style={s.label}>{label}</Text><Text style={s.text}>{text || 'Not set'}</Text></View>;
  function card(title: string, section: Section, contents: ReactNode, editor: ReactNode, badge?: string) {
    return <View style={section === 'music' ? s.music : s.card}>
      <View style={s.row}><Text style={s.title}>{title}</Text>{button('Edit', () => edit(section))}</View>
      {badge ? <View style={[s.badge, section === 'friends' && s.purple, section === 'private' && s.gray]}><FontAwesomeIcon icon={section === 'public' ? faGlobe : section === 'friends' ? faUsers : faLock} size={10} color="#b4b7ff" /><Text style={s.badgeText}>{badge}</Text></View> : null}
      {editing === section ? <>{editor}{button('Save changes', () => void run(save), true)}{button('Cancel', () => setEditing(null))}</> : contents}
    </View>;
  }
  return <View style={s.page}>
    <Text style={s.eyebrow}>PROFILE & SETTINGS</Text><Text style={s.heading}>Your corner.</Text>
    {busy ? <ActivityIndicator accessibilityLabel="Loading profile" color="#aeb5ff" /> : null}
    {!profile ? button('Reload profile', () => void run(async () => { const p = await client.getMyProfile(); if (alive.current) setProfile(p); }), true) : <>
      <View style={[s.row, s.identity]}><Pressable accessibilityRole="button" accessibilityLabel="Edit profile photo" disabled={busy} onPress={editPhoto}><ProfileAvatar name={profile.name} info={profile.publicInfo} /><Text style={s.photoEdit}>Edit photo</Text></Pressable><View style={s.grow}><Text style={s.name}>{profile.name}</Text>{(profile.username ?? '') ? <Text style={s.muted}>@{(profile.username ?? '')}</Text> : null}<Text style={s.tagline}>{value(profile.publicInfo, 'bio')}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Edit public profile" disabled={busy} onPress={() => edit('public')}><FontAwesomeIcon icon={faPen} color="#aeb5ff" size={18} /></Pressable></View>
      {card('Public information', 'public', <>{detail('Display name / username', profile.name + ((profile.username ?? '') ? ` · @${(profile.username ?? '')}` : ''))}{detail('Bio', value(profile.publicInfo, 'bio'))}</>, <>{input('name', 'Display name')}{input('username', 'Unique username (3–30 letters, numbers or _)')}{input('bio', 'Bio', true)}</>, 'Visible to everyone')}
      {card('Friends-only information', 'friends', <>{detail('City', value(profile.friendsOnlyInfo, 'city'))}{button('Manage friends', onPeople)}</>, <>{input('city', 'City')}</>, 'Only your friends')}
      {card('Private information', 'private', <>{detail(`Email · ${profile.emailVerifiedAt ? 'Verified' : 'Not verified'}`, profile.email)}{detail('Birthday', value(profile.privateInfo, 'birthday'))}{profile.hasPassword ? button('Change password', () => Alert.alert('Change password', `Send a reset link to ${profile.email}? Completing the reset signs out all sessions.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Send email', onPress: () => void run(async () => { await client.forgot(profile.email); if (alive.current) setNotice('If your account is eligible, a reset email will arrive shortly.'); }) }])) : button('Create password', () => Alert.alert('Create a password', `We will send a one-time link to ${profile.email}. Creating your password signs out all sessions. Your social accounts remain linked.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Send email', onPress: () => void run(async () => { const result = await client.requestPasswordSetup(); if (alive.current) setNotice(result.message); }) }]))}</>, <>{detail('Email', profile.email)}{input('birthday', 'Birthday (YYYY-MM-DD)')}</>, 'Only you')}
      {card('Your music DNA', 'music', <><View style={s.chips}>{profile.musicPreferences.map(g => <View style={s.badge} key={g}><Text style={s.badgeText}>{g}</Text></View>)}</View>{detail('Favorite artists', value(profile.publicInfo, 'favoriteArtists'))}</>, <>{input('genres', 'Genres (comma separated)')}{input('artists', 'Favorite artists (public)')}</>)}
      <View style={s.card}><Text style={s.title}>Linked accounts</Text>{(['google', 'facebook'] as const).map(provider => <View key={provider} style={[s.row, s.provider]}><View style={s.providerIcon}><FontAwesomeIcon icon={provider === 'google' ? faGoogle : faFacebookF} color="#f5f5fa" size={20} /></View><View style={s.grow}><Text style={s.text}>{provider === 'google' ? 'Google' : 'Facebook'}</Text><Text style={s.muted}>{profile[provider === 'google' ? 'googleId' : 'facebookId'] ? 'Connected' : 'Not connected'}</Text></View>{button(profile[provider === 'google' ? 'googleId' : 'facebookId'] ? 'Unlink' : 'Link', () => social(provider))}</View>)}<Text style={s.muted}>Link a social account anytime for easier sign-in.</Text></View>
      <View style={s.card}><View style={s.row}><FontAwesomeIcon icon={faSliders} color="#bca0ff" /><Text style={[s.title, s.grow]}>Advanced</Text></View><Text style={s.text}>Backend address</Text><TextInput accessibilityLabel="Backend address" value={server} onChangeText={value => { setServer(value); setServerError(''); }} editable={!busy} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={s.input} /><>{serverError ? <Text accessibilityRole="alert" style={s.error}>{serverError}</Text> : null}</><Text style={s.muted}>Change the server address for testing. This setting applies only to this app on your device. Changing servers signs you out.</Text>{button('Save backend address', () => void run(async () => { let address: string; try { address = normalizeBaseUrl(server); } catch (e) { setServerError(e instanceof Error ? e.message : 'Enter a valid server address.'); return; } await onServer(address); if (alive.current) setNotice('Backend address saved.'); }), true)}</View>
      <Pressable accessibilityRole="button" disabled={busy} style={[s.button, s.logout]} onPress={() => void run(onLogout)}><FontAwesomeIcon icon={faRightFromBracket} color="#f5f5fa" /><Text style={s.buttonText}>Log out</Text></Pressable>
      <Text style={s.version}>Sonora · Version {Constants.expoConfig?.version ?? '0.1.0'}</Text>
    </>}
  </View>;
}
const s = StyleSheet.create({
  photoEdit: { color: '#b1baff', fontSize: 10, textAlign: 'center', marginTop: 5 },
  page: { gap: 20 }, eyebrow: { color: '#bba0ff', fontSize: 11, fontWeight: '600', marginBottom: -14 }, heading: { color: '#f4f4fa', fontSize: 30, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'space-between' }, grow: { flex: 1 }, identity: { paddingVertical: 8 }, avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#20264f', justifyContent: 'center', alignItems: 'center' }, initials: { color: '#acb6ff', fontSize: 24, fontWeight: '700' }, name: { color: '#f5f5fa', fontSize: 21, fontWeight: '700' }, tagline: { color: '#b39bef', fontSize: 12, marginTop: 5 },
  card: { backgroundColor: '#13141c', borderRadius: 22, padding: 18, gap: 15 }, music: { gap: 14 }, title: { color: '#f5f5fa', fontSize: 18, fontWeight: '700' }, text: { color: '#e1e1eb', fontSize: 14, lineHeight: 21 }, muted: { color: '#999bae', fontSize: 12, lineHeight: 18 }, label: { color: '#85889e', fontSize: 11 }, field: { gap: 4 }, link: { color: '#b1baff', fontSize: 12, fontWeight: '600', paddingVertical: 8 }, badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#20264f' }, purple: { backgroundColor: '#302344' }, gray: { backgroundColor: '#23232f' }, badgeText: { color: '#b8bfff', fontSize: 11 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, input: { color: '#f5f5fa', borderColor: '#2a2c3e', borderWidth: 1, borderRadius: 12, padding: 13, fontSize: 14 }, button: { backgroundColor: '#20212d', borderColor: '#2b2c40', borderWidth: 1, borderRadius: 14, padding: 16, alignItems: 'center' }, buttonText: { color: '#f5f5fa', fontWeight: '600', fontSize: 14 }, provider: { paddingVertical: 2 }, providerIcon: { width: 36, height: 36, backgroundColor: '#20212d', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, logout: { flexDirection: 'row', justifyContent: 'center', gap: 10 }, version: { color: '#7c8099', fontSize: 11, textAlign: 'center', marginBottom: 10 }, error: { color: '#ffaaaa' }, notice: { color: '#b1edc1' },
});
