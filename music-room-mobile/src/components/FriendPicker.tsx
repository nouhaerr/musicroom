import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faSquare, faSquareCheck } from '@fortawesome/free-regular-svg-icons';
import type { ApiClient } from '../api/client';
import { PAGE_SIZE, type PublicProfile } from '../api/profiles';
import { socialApi } from '../api/social';
import { ProfileAvatar } from './ProfileAvatar';
import { Action, styles } from './ProfileUI';

// Your friends, each with a box to tick, page by page like the People page.
// The ticked friends survive a change of page: the parent keeps them, by id with their name.
export function FriendPicker({ client, picked, onChange, disabled }: {
  client: ApiClient; picked: Map<string, string>; onChange: (picked: Map<string, string>) => void; disabled: boolean;
}) {
  const api = useMemo(() => socialApi(client), [client]);
  const [friends, setFriends] = useState<PublicProfile[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void api.friends(page).then(result => { if (active) setFriends(result); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load your friends.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, page]);

  function toggle(friend: PublicProfile) {
    const updated = new Map(picked);
    if (updated.has(friend.id)) updated.delete(friend.id);
    else updated.set(friend.id, friend.name);
    onChange(updated);
  }

  if (loading) return <ActivityIndicator color="#B7F576" accessibilityLabel="Loading your friends" />;
  if (error) return <Text accessibilityRole="alert" style={styles.error}>{error}</Text>;
  if (page === 1 && friends.length === 0) return <Text style={styles.text}>No friends yet. Add some from the People page.</Text>;
  return <View>
    {friends.map(friend => {
      const ticked = picked.has(friend.id);
      return <Pressable key={friend.id} accessibilityRole="checkbox" accessibilityState={{ checked: ticked, disabled }}
        disabled={disabled} onPress={() => toggle(friend)} style={f.row}>
        <ProfileAvatar name={friend.name} info={friend.publicInfo} size={40} />
        <View style={f.grow}>
          <Text style={f.name} numberOfLines={1}>{friend.name}</Text>
          {friend.username ? <Text style={styles.text} numberOfLines={1}>@{friend.username}</Text> : null}
        </View>
        <FontAwesomeIcon icon={ticked ? faSquareCheck : faSquare} color={ticked ? '#B7F576' : '#737D91'} size={22} />
      </Pressable>;
    })}
    {page > 1 || friends.length === PAGE_SIZE ? <View style={f.pages}>
      <Action title="Previous" secondary disabled={page === 1} onPress={() => setPage(p => p - 1)} />
      <Action title="Next" secondary disabled={friends.length < PAGE_SIZE} onPress={() => setPage(p => p + 1)} />
    </View> : null}
  </View>;
}

const f = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomColor: '#3B4355', borderBottomWidth: 1 },
  grow: { flex: 1, gap: 2 },
  name: { color: '#F3F3E9', fontSize: 16, fontWeight: '700' },
  pages: { flexDirection: 'row', gap: 12, marginTop: 8 },
});
