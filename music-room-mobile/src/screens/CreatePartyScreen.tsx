import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCrosshairs, faGlobe, faLocationDot, faLock, faUserCheck, faUsers } from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { useAutoDismiss } from '../hooks/useAutoDismiss';
import type { ApiClient } from '../api/client';
import { partiesApi, votingWindow, type Party, type Position } from '../api/parties';
import { currentPosition, recentPosition } from '../location';
import { Button, Field } from '../components/FormControls';
import { FriendPicker } from '../components/FriendPicker';
import { VenueMap } from '../components/VenueMap';
import { styles } from '../components/ProfileUI';

const RADII = [100, 200, 500]; // meters around the venue
type Picking = 'day' | 'from' | 'until';

// The next full hour, e.g. 21:00 at 20:14: the default start of the voting hours
function nextFullHour() {
  const hour = new Date();
  hour.setHours(hour.getHours() + 1, 0, 0, 0);
  return hour;
}
const time = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function CreatePartyScreen({ client, onCreated, onBack }: {
  client: ApiClient; onCreated: (partyId: string) => void; onBack: () => void;
}) {
  const api = useMemo(() => partiesApi(client), [client]);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<Party['visibility']>('PUBLIC');
  const [voteLicense, setVoteLicense] = useState<Party['voteLicense']>('EVERYONE');
  const [pin, setPin] = useState<Position | null>(null);
  const [radius, setRadius] = useState(200);
  const [day, setDay] = useState(nextFullHour); // its date is the day of the next full hour: 23:30 starts tomorrow
  const [from, setFrom] = useState(nextFullHour);
  const [until, setUntil] = useState(() => new Date(nextFullHour().getTime() + 3 * 3_600_000));
  const [picking, setPicking] = useState<Picking | null>(null);
  const [locating, setLocating] = useState(false); // a position reading the page waits for
  const [invited, setInvited] = useState(new Map<string, string>()); // friend id → name
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useAutoDismiss(error, setError);
  const alive = useRef(false);
  const working = useRef(false);
  const byLocation = voteLicense === 'LOCATION_TIME';
  const inviting = visibility === 'PRIVATE' || voteLicense === 'INVITED_ONLY'; // an invitation gives something only there
  const hours = votingWindow(day, from, until);
  const nextDay = new Date(hours.voteEndsAt).getDate() !== new Date(hours.voteStartsAt).getDate();

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Choosing "Location & time" puts the pin where the phone is, unless the user already placed it.
  // Quietly: if the position cannot be read, the user taps the map instead.
  useEffect(() => {
    if (!byLocation) return;
    const recent = recentPosition();
    if (recent) { setPin(current => current ?? recent); return; }
    let active = true;
    void locate().then(found => { if (active) setPin(current => current ?? found); }).catch(() => {});
    return () => { active = false; };
  }, [byLocation]);

  async function run(operation: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await operation(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Unable to create the room.'); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }

  // A position reading the page waits for: the line "Finding your position…" shows meanwhile
  async function locate() {
    setLocating(true);
    try { return await currentPosition(); }
    finally { if (alive.current) setLocating(false); }
  }

  function picked(value: Date | undefined) {
    const which = picking;
    setPicking(null);
    if (!value) return;
    if (which === 'day') setDay(value);
    else if (which === 'from') setFrom(value);
    else if (which === 'until') setUntil(value);
  }

  async function create() {
    if (byLocation && new Date(hours.voteEndsAt) <= new Date()) throw new Error('These hours are already over. Choose later hours.');
    const party = await api.create({
      name: name.trim(), visibility, voteLicense,
      ...(byLocation && pin ? { ...pin, radiusMeters: radius, ...hours } : {}),
    });
    // The party exists from here on: a failed invitation does not undo it. Like the hidden map, a hidden list sends nothing.
    const guests = inviting ? [...invited] : [];
    const answers = await Promise.allSettled(guests.map(([userId]) => api.invite(party.id, userId)));
    const missed = guests
      .filter((_, index) => answers[index].status === 'rejected')
      .map(([, friend]) => friend);
    if (!alive.current) return;
    if (missed.length === 0) onCreated(party.id);
    else Alert.alert('Room created', `These friends could not be invited: ${missed.join(', ')}.`, [{ text: 'OK', onPress: () => onCreated(party.id) }]);
  }

  const choice = (selected: boolean, icon: IconDefinition, title: string, text: string, onPress: () => void) =>
    <Pressable accessibilityRole="radio" accessibilityState={{ selected, disabled: busy }} disabled={busy} onPress={onPress}
      style={[c.choice, selected && c.chosen]}>
      <FontAwesomeIcon icon={icon} color={selected ? '#F3F3E9' : '#A4ADBF'} size={18} />
      <View style={c.grow}><Text style={c.title}>{title}</Text><Text style={styles.text}>{text}</Text></View>
    </Pressable>;
  const ready = name.trim().length > 0 && (!byLocation || pin !== null);

  return <View style={styles.section}>
    <Button title="← Back" secondary disabled={busy} onPress={onBack} />
    <Text style={styles.title}>Create a room</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Field label="Room name" value={name} change={setName} maxLength={100} />

    <Text style={c.heading}>Who can find it?</Text>
    {choice(visibility === 'PUBLIC', faGlobe, 'Public', 'Anyone can discover your room.', () => setVisibility('PUBLIC'))}
    {choice(visibility === 'PRIVATE', faLock, 'Private', 'Only invited people can find it and vote.', () => setVisibility('PRIVATE'))}

    <Text style={c.heading}>Who can vote?</Text>
    {choice(voteLicense === 'EVERYONE', faUsers, 'Everyone', 'Everyone who can see the room.', () => setVoteLicense('EVERYONE'))}
    {choice(voteLicense === 'INVITED_ONLY', faUserCheck, 'Invited people only', 'Only your guest list.', () => setVoteLicense('INVITED_ONLY'))}
    {choice(byLocation, faLocationDot, 'Location & time', 'People at your venue during your event.', () => setVoteLicense('LOCATION_TIME'))}

    {byLocation ? <View style={c.card}>
      <Text style={c.title}>Venue</Text>
      <VenueMap pin={pin} radius={radius} onPin={setPin} />
      {locating ? <View style={c.row}>
        <ActivityIndicator color="#B7F576" />
        <Text style={styles.text}>Finding your position…</Text>
      </View> :
      pin ? null :
      <Text style={styles.text}>Tap the map to place the venue.</Text>}
      <Button title="Use my current position" icon={faCrosshairs} secondary disabled={busy || locating}
        onPress={() => void run(async () => { const here = await locate(); if (alive.current) setPin(here); })} />
      <Text style={c.title}>Voting radius</Text>
      <View style={c.row}>{RADII.map(meters => <Pressable key={meters} accessibilityRole="radio" accessibilityState={{ selected: radius === meters, disabled: busy }} disabled={busy}
        onPress={() => setRadius(meters)} style={[c.chip, radius === meters && c.chosen]}><Text style={c.chipText}>{meters} m</Text></Pressable>)}</View>
      <Text style={c.title}>Hours</Text>
      <Button title={`Date · ${day.toLocaleDateString()}`} secondary disabled={busy} onPress={() => setPicking('day')} />
      <View style={c.row}>
        <View style={c.grow}><Button title={`From · ${time(from)}`} secondary disabled={busy} onPress={() => setPicking('from')} /></View>
        <View style={c.grow}><Button title={`Until · ${time(until)}${nextDay ? ' +1d' : ''}`} secondary disabled={busy} onPress={() => setPicking('until')} /></View>
      </View>
      {picking ? <DateTimePicker value={picking === 'day' ? day : picking === 'from' ? from : until}
        mode={picking === 'day' ? 'date' : 'time'} minimumDate={picking === 'day' ? new Date() : undefined}
        onChange={(event, value) => picked(event.type === 'set' ? value : undefined)} /> : null}
    </View> : null}

    {inviting ? <>
      <Text style={c.heading}>Invite your circle</Text>
      <FriendPicker client={client} picked={invited} onChange={setInvited} disabled={busy} />
    </> : null}

    {byLocation && !pin && !locating ? <Text style={styles.text}>Place the venue on the map to create the room.</Text> : null}
    <Button title={visibility === 'PUBLIC' ? 'Create public room' : 'Create private room'} accent disabled={busy || !ready}
      onPress={() => void run(create)} />
  </View>;
}

const c = StyleSheet.create({
  heading: { color: '#F3F3E9', fontSize: 19, fontWeight: '700', marginTop: 10 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#3B4355', backgroundColor: '#111722' },
  chosen: { borderColor: '#4961EE', backgroundColor: '#1E2A5C' },
  grow: { flex: 1, gap: 2 },
  title: { color: '#F3F3E9', fontSize: 16, fontWeight: '700' },
  card: { gap: 10, padding: 14, borderRadius: 16, backgroundColor: '#171A25' },
  row: { flexDirection: 'row', gap: 10 },
  chip: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: '#3B4355', backgroundColor: '#111722' },
  chipText: { color: '#F3F3E9', fontWeight: '600' },
});
