import { Pressable, StyleSheet, Text } from 'react-native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';

// The "← Back to …" link at the top of a page, in the look of the People page
export function BackLink({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[b.back, disabled && b.dim]}>
    <FontAwesomeIcon icon={faArrowLeft} size={16} color="#aeb5ff" />
    <Text style={b.text}>{title}</Text>
  </Pressable>;
}

const b = StyleSheet.create({
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 44 },
  text: { color: '#aeb5ff', fontSize: 13, fontWeight: '600' },
  dim: { opacity: 0.5 },
});
