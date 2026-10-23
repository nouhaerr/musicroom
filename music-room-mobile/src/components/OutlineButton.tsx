import { Pressable, StyleSheet, Text } from 'react-native';

// The app's button: no fill, a border on the page's own background, the color in the text. The main choice gets the
// lavender of the "← Back" link, the other choices a grey border.
export function OutlineButton({ title, onPress, main = false, disabled = false }: {
  title: string; onPress: () => void; main?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [o.button, main && o.main, (disabled || pressed) && o.dim]}>
    <Text style={[o.text, main && o.mainText]}>{title}</Text>
  </Pressable>;
}

const o = StyleSheet.create({
  button: { minHeight: 48, paddingHorizontal: 16, borderRadius: 13, borderWidth: 1, borderColor: '#3B4355', alignItems: 'center', justifyContent: 'center' },
  main: { borderColor: '#AEB5FF' },
  text: { color: '#B4BDCE', fontSize: 15, fontWeight: '700' },
  mainText: { color: '#A9B6FF' },
  dim: { opacity: 0.5 },
});
