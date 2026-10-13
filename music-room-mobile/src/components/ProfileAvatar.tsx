import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import type { ProfileInfo } from '../api/profiles';

export function ProfileAvatar({ name, info, size = 60 }: { name: string; info: ProfileInfo | undefined; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  const uri = typeof info?.avatar === 'string' && info.avatar.startsWith('data:image/jpeg;base64,') && info.avatar.length <= 64_023 ? info.avatar : null;
  const style = { width: size, height: size, borderRadius: size / 2 };
  if (uri && failed !== uri) return <Image accessibilityLabel={`${name}'s profile photo`} source={{ uri }} style={style} onError={() => setFailed(uri)} />;
  return <View style={[style, { backgroundColor: '#20264f', alignItems: 'center', justifyContent: 'center' }]}><Text style={{ color: '#acb6ff', fontSize: size * 0.4, fontWeight: '700' }}>{name.trim().split(/\s+/).map(n => n[0]).slice(0, 2).join('').toUpperCase()}</Text></View>;
}
