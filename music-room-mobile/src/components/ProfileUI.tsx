import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ProfileInfo } from '../api/profiles';

export function Action({ title, onPress, disabled = false, secondary = false }: {
  title: string; onPress: () => void; disabled?: boolean; secondary?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondary, (pressed || disabled) && { opacity: 0.5 }]}>
    <Text style={[styles.buttonText, secondary && { color: '#E2E7F0' }]}>{title}</Text>
  </Pressable>;
}

export function Input({ label, value, onChange, multiline = false, disabled = false, maxLength }: {
  label: string; value: string; onChange: (value: string) => void; multiline?: boolean; disabled?: boolean; maxLength?: number;
}) {
  return <View style={styles.section}><Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} editable={!disabled}
      multiline={multiline} maxLength={maxLength} autoCapitalize="sentences" style={[styles.input, multiline && { minHeight: 90, textAlignVertical: 'top' }]} />
  </View>;
}

export function Info({ title, info }: { title: string; info: ProfileInfo | undefined }) {
  const entries = Object.entries(info ?? {}).filter(([, value]) => value !== '' && value !== null);
  return <View style={styles.section}><Text style={styles.label}>{title}</Text>
    {entries.length ? entries.map(([key, value]) => <Text key={key} style={styles.text}>
      {key === 'bio' ? '' : `${key} : `}{typeof value === 'string' ? value : JSON.stringify(value)}
    </Text>) : <Text style={styles.text}>Aucune information renseignée.</Text>}
  </View>;
}

export const styles = StyleSheet.create({
  section: { gap: 8, marginVertical: 5 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  title: { color: '#F3F3E9', fontSize: 23, fontWeight: '700' },
  label: { color: '#D5ECC0', fontSize: 14, fontWeight: '600' },
  text: { color: '#B4BDCE', lineHeight: 23, fontSize: 15 },
  input: { color: '#FAFAF5', backgroundColor: '#111722', borderColor: '#3B4355', borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16, minHeight: 50 },
  button: { backgroundColor: '#B7F576', borderRadius: 12, padding: 14, alignItems: 'center', minHeight: 48 },
  buttonText: { color: '#16240E', fontSize: 15, fontWeight: '700' }, secondary: { backgroundColor: '#242D3E' },
  card: { gap: 10, paddingVertical: 16, borderBottomColor: '#3B4355', borderBottomWidth: 1 },
  error: { color: '#FFC0B7', lineHeight: 22 }, notice: { color: '#D4F2B6', lineHeight: 22 },
});
