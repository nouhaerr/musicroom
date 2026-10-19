import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { ApiClient } from '../api/client';
import { useScreenToast } from '../components/Toast';

type Item = { id: string; name?: string; model?: string; title?: string; platform?: string; visibility?: string };
/** Initial read-only destinations for the profile navigation. */
export function AccountListScreen({ client, area }: { client: ApiClient; area: 'rooms' | 'playlists' | 'devices' }) {
  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useScreenToast(error, '', error ? () => setRetry(n => n + 1) : undefined);
  useEffect(() => {
    let active = true;
    setBusy(true); setError('');
    const path = area === 'rooms' ? '/parties/mine' : area === 'playlists' ? '/playlists/mine' : '/devices';
    void client.request<Item[]>(`${path}?page=${page}&limit=20`).then(data => {
      if (!Array.isArray(data)) throw new Error('Unable to read this list.');
      if (active) setItems(data);
    }).catch(e => { if (active) { setError(e instanceof Error ? e.message : 'Unable to load this list.'); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [client, area, page, retry]);
  const action = (label: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" disabled={busy || disabled} onPress={onPress} style={{ padding: 14, opacity: busy || disabled ? 0.4 : 1 }}><Text style={{ color: '#b1baff' }}>{label}</Text></Pressable>;
  return <View style={{ gap: 20 }}><Text style={{ color: '#f5f5fa', fontSize: 28, fontWeight: '700' }}>{area === 'rooms' ? 'Your rooms' : area === 'playlists' ? 'Your playlists' : 'Your devices'}</Text>
    <Text style={{ color: '#999bae' }}>Account overview</Text>
    {busy ? <ActivityIndicator color="#b1baff" /> : null}
    {!busy && !error && items.length === 0 ? <Text style={{ color: '#999bae' }}>Nothing here yet.</Text> : null}
    {items.map(item => <View key={item.id} style={{ backgroundColor: '#13141c', padding: 20, borderRadius: 18, gap: 8 }}><Text style={{ color: '#f5f5fa', fontWeight: '600' }}>{item.name || item.title || item.model || 'Unnamed device'}</Text><Text style={{ color: '#999bae' }}>{item.platform || item.visibility || ''}</Text></View>)}
    {action('Reload', () => setRetry(n => n + 1))}
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>{action('Previous', () => setPage(p => p - 1), page === 1)}{action('Next', () => setPage(p => p + 1), items.length < 20)}</View>
  </View>;
}
