import { useScreenToast } from '../components/Toast';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCheckCircle, faChevronRight, faDesktop, faMobileScreen, faPlus, faRotateRight, faShieldHalved } from '@fortawesome/free-solid-svg-icons';
import { ApiError, type ApiClient } from '../api/client';
import { useAutoDismiss } from '../hooks/useAutoDismiss';

import { detachDevice, devicePage, DEVICE_PAGE_SIZE as PAGE_SIZE, type Device } from '../api/devices';
const platformName = (platform: string) => ({ IOS: 'iOS', ANDROID: 'Android', WEB: 'Web' })[platform] ?? platform;
const deviceIcon = (platform: string) => platform === 'WEB' ? faDesktop : faMobileScreen;

export function DevicesScreen({ client, onBusy }: { client: ApiClient; onBusy: (busy: boolean) => void }) {
  const alive = useRef(true);
  const removing = useRef(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [current, setCurrent] = useState<Device | null>(null);
  const [details, setDetails] = useState<Device | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [retryDevice, setRetryDevice] = useState<Device | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  useAutoDismiss(retryDevice ? '' : error, setError);
  useAutoDismiss(notice, setNotice);
  useScreenToast(error || loadError, notice, error && retryDevice ? () => void remove(retryDevice) : !error && loadError ? () => setRetry(n => n + 1) : undefined);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setBusy(true); setLoadError('');
    void (async () => {
      const data = await devicePage(client, page);
      if (!active) return;
      if (!data.length && page > 1) { setPage(p => p - 1); return; }
      const currentId = client.currentDeviceId;
      let found = data.find(d => d.id === currentId);
      // Keep this phone pinned even when browsing a different list page.
      if (!found && currentId) {
        for (let number = 1; active; number++) {
          const candidate = number === page ? data : await devicePage(client, number);
          found = candidate.find(d => d.id === currentId);
          if (found || candidate.length < PAGE_SIZE) break;
        }
      }
      if (active) { setDevices(data); setCurrent(found ?? null); }
    })().catch(e => { if (active) { setLoadError(e instanceof Error ? e.message : 'Unable to load your devices.'); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [client, page, retry]);
  const selected = current;
  const currentDeviceId = client.currentDeviceId;
  const others = devices.filter(d => d.id !== currentDeviceId);
  async function remove(device: Device) {
    if (removing.current || !alive.current) return;
    removing.current = true; setRetryDevice(null); setDeleting(true); onBusy(true); setError(''); setNotice('');
    try {
      await detachDevice(client, device.id);
      if (alive.current) { setDetails(null); setNotice('Device detached.'); setRetry(n => n + 1); }
    } catch (e) {
      if (alive.current) { setDetails(null); setError(e instanceof Error ? e.message : 'Unable to detach device.'); if (e instanceof ApiError && e.status === 0) setRetryDevice(device); }
    } finally {
      removing.current = false;
      if (alive.current) setDeleting(false);
      onBusy(false);
    }
  }
  function confirmDetach(device: Device) {
    Alert.alert('Detach device?', `Remove ${device.model || 'this device'} from your account’s device list? This does not sign it out. It may register again when Sonora restarts.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Detach', style: 'destructive', onPress: () => void remove(device) },
    ]);
  }
  const addDevice = () => Alert.alert('Add a device', 'Open Sonora on another phone and sign in to this account. The device will be registered automatically. Then refresh this list.', [{ text: 'Got it' }]);
  return <View style={s.screen}>
    <View style={s.header}><View style={s.grow}><Text style={s.eyebrow}>YOUR DEVICES</Text><Text style={s.heading}>Your sound, everywhere.</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Add a device" onPress={addDevice} style={s.iconButton}><FontAwesomeIcon icon={faPlus} size={23} color="#f5f5fa" /></Pressable>
    </View>
    <View style={{ height: 20 }}>{busy ? <ActivityIndicator color="#aeb5ff" accessibilityLabel="Loading devices" /> : null}</View>
    {selected ? <>
      <View style={s.selected}>
        <View style={s.row}><Text style={[s.label, s.grow]}>CURRENT DEVICE</Text><FontAwesomeIcon icon={faCheckCircle} size={22} color="#aeb5ff" /></View>
        <View style={[s.row, s.deviceIdentity]}><View style={s.selectedIcon}><FontAwesomeIcon icon={deviceIcon(selected.platform)} size={49} color="#aeb5ff" /></View>
          <View style={s.grow}><Text style={s.deviceName}>{selected.model || 'Unnamed device'}</Text>{selected.id === currentDeviceId ? <Text style={s.currentBadge}>This device</Text> : null}<Text style={s.accent}>{platformName(selected.platform)} · Registered</Text>{selected.appVersion ? <Text style={s.muted}>Sonora {selected.appVersion}</Text> : null}</View>
        </View>
      </View>
      <View style={s.info}><FontAwesomeIcon icon={faShieldHalved} size={20} color="#aeb5ff" /><Text style={[s.infoText, s.grow]}>This device is attached to your account. Registration does not indicate whether it is currently online.</Text></View>
      <View style={s.card}><Text style={s.sectionTitle}>Your account, your devices.</Text><Text style={s.muted}>Sign in on your devices to keep your profile, friends and playlists with you.</Text></View>
    </> : null}
      <View style={s.list}><Text style={s.sectionTitle}>Other attached devices</Text>
        {others.map(device => <Pressable key={device.id} accessibilityRole="button" accessibilityLabel={`View details for ${device.model || 'device'}`} disabled={deleting} onPress={() => setDetails(device)} style={({ pressed }) => [s.deviceRow, pressed && s.pressed]}>
          <View style={s.smallIcon}><FontAwesomeIcon icon={deviceIcon(device.platform)} color="#999bae" size={23} /></View>
          <View style={s.grow}><Text style={s.rowName}>{device.model || 'Unnamed device'}</Text>{device.id === currentDeviceId ? <Text style={s.currentBadge}>This device</Text> : null}<Text style={s.muted}>{platformName(device.platform)} · Registered device</Text></View>
          <FontAwesomeIcon icon={faChevronRight} color="#72768f" size={15} />
        </Pressable>)}
        {!busy && !loadError && !others.length ? <Text style={s.muted}>No other devices on this page.</Text> : null}
        <Text style={s.muted}>Tap a device to view its details or detach it.</Text>
      </View>
    <Pressable accessibilityRole="button" disabled={busy || deleting} onPress={() => setRetry(n => n + 1)} style={({ pressed }) => [s.refresh, (busy || pressed) && s.pressed]}><FontAwesomeIcon icon={faRotateRight} color="#f5f5fa" size={17} /><Text style={s.buttonText}>Refresh devices</Text></Pressable>
    {page > 1 || devices.length === PAGE_SIZE ? <View style={s.row}>
      <Pressable accessibilityRole="button" disabled={busy || deleting || page === 1} onPress={() => setPage(p => p - 1)} style={[s.pageButton, (busy || page === 1) && s.pressed]}><Text style={s.accent}>Previous</Text></Pressable>
      <Text style={[s.muted, s.grow, s.center]}>Page {page}</Text>
      <Pressable accessibilityRole="button" disabled={busy || deleting || devices.length < PAGE_SIZE} onPress={() => setPage(p => p + 1)} style={[s.pageButton, (busy || devices.length < PAGE_SIZE) && s.pressed]}><Text style={s.accent}>Next</Text></Pressable>
    </View> : null}
    <Modal visible={details !== null} transparent animationType="slide" onRequestClose={() => { if (!deleting) setDetails(null); }}>
      <View style={s.modalBackdrop}><View style={s.modalPanel} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={s.modalContent}>
          <Text style={s.sectionTitle}>Device details</Text>
          {details ? <>
            <FontAwesomeIcon icon={deviceIcon(details.platform)} size={36} color="#aeb5ff" />
            <Text style={s.deviceName}>{details.model || 'Unnamed device'}</Text>
            <Text style={s.muted}>Platform: {platformName(details.platform)}</Text>
            <Text style={s.muted}>App version: {details.appVersion || 'Not available'}</Text>
            {details.createdAt && Number.isFinite(Date.parse(details.createdAt)) ? <Text style={s.muted}>Registered: {new Date(details.createdAt).toLocaleDateString()}</Text> : null}
            <Text style={s.muted}>Detaching removes this registration, but does not revoke its login session. The device may register again when Sonora restarts.</Text>
            <Pressable accessibilityRole="button" disabled={deleting} onPress={() => confirmDetach(details)} style={[s.refresh, deleting && s.pressed]}><Text style={s.error}>{deleting ? 'Detaching…' : 'Detach device'}</Text></Pressable>
          </> : null}
          <Pressable accessibilityRole="button" disabled={deleting} onPress={() => setDetails(null)} style={[s.refresh, deleting && s.pressed]}><Text style={s.buttonText}>Close</Text></Pressable>
        </ScrollView>
      </View></View>
    </Modal>
  </View>;
}

const s = StyleSheet.create({
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.65)' },
  modalPanel: { maxHeight: '85%', backgroundColor: '#13141c', borderRadius: 24 },
  modalContent: { padding: 24, gap: 16 },
  notice: { color: '#c9eacb', fontSize: 14, lineHeight: 21 },
  screen: { gap: 26, paddingTop: 6, paddingBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrow: { color: '#b28dff', fontSize: 11, fontWeight: '600', marginBottom: 9 },
  heading: { color: '#f5f5fa', fontSize: 29, lineHeight: 35, fontWeight: '700', letterSpacing: -0.6 },
  grow: { flex: 1 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  selected: { borderWidth: 1, borderColor: '#5966ff', backgroundColor: '#1d254b', borderRadius: 23, padding: 23, gap: 24 },
  label: { color: '#aeb5ff', fontSize: 11, fontWeight: '600' },
  deviceIdentity: { paddingVertical: 8, gap: 19 }, selectedIcon: { width: 58, alignItems: 'center' },
  deviceName: { color: '#f5f5fa', fontSize: 22, lineHeight: 28, fontWeight: '700', marginBottom: 8 },
  currentBadge: { alignSelf: 'flex-start', color: '#c9ceff', backgroundColor: '#303b70', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontWeight: '600', marginBottom: 6 },
  accent: { color: '#aeb5ff', fontSize: 13, lineHeight: 21 },
  muted: { color: '#999bae', fontSize: 13, lineHeight: 20 },
  info: { flexDirection: 'row', gap: 12, backgroundColor: '#1d254b', padding: 16, borderRadius: 16 },
  infoText: { color: '#aeb5ff', fontSize: 13, lineHeight: 19 },
  card: { padding: 20, backgroundColor: '#13141c', borderRadius: 22, gap: 15 },
  sectionTitle: { color: '#f5f5fa', fontSize: 20, fontWeight: '700', lineHeight: 26 },
  list: { gap: 12 }, deviceRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#13141c', borderRadius: 18, padding: 15 },
  smallIcon: { height: 48, width: 48, borderRadius: 14, backgroundColor: '#1e1f2a', alignItems: 'center', justifyContent: 'center' },
  rowName: { color: '#f5f5fa', fontWeight: '600', fontSize: 15, marginBottom: 4 },
  refresh: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, borderRadius: 16, padding: 17, backgroundColor: '#1e1f2b', borderWidth: 1, borderColor: '#2b2d40' },
  buttonText: { color: '#f5f5fa', fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.45 }, pageButton: { padding: 12 }, center: { textAlign: 'center' },
  error: { color: '#ffaaaa', fontSize: 14, lineHeight: 21 },
});
