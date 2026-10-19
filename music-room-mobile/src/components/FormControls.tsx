import { fieldValidation } from '../auth/field-validation';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faEye, faEyeSlash } from '@fortawesome/free-regular-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { PasswordFeedback } from '../auth/password-validation';

export function Field({ label, value, change, password = false, email = false, icon, feedback = [], onBlur, maxLength, required = false, submitted = false }: {
  label: string; value: string; change: (value: string) => void; password?: boolean; email?: boolean; icon?: IconDefinition;
  required?: boolean; submitted?: boolean; maxLength?: number; feedback?: PasswordFeedback[]; onBlur?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [touched, setTouched] = useState(false);
  const invalid = fieldValidation(value, required, email, touched || submitted);
  const secure = password && !visible;
  return <View style={s.field}><Text style={s.label}>{label}</Text>
    <View style={s.inputWrap}><TextInput accessibilityLabel={label} maxLength={maxLength} style={[s.input, invalid ? s.inputInvalid : null, feedback.length > 0 && (feedback.every(item => item.valid) ? s.inputValid : s.inputInvalid)]} value={value} onChangeText={change} onBlur={() => { setTouched(true); onBlur?.(); }}
      secureTextEntry={secure} autoCapitalize="none" autoCorrect={false}
      keyboardType={email ? 'email-address' : 'default'} />
      {password ? <Pressable accessibilityRole="button" accessibilityLabel={visible ? 'Hide password' : 'Show password'} onPress={() => setVisible(value => !value)} style={s.fieldIconButton}>
        <FontAwesomeIcon icon={visible ? faEye : faEyeSlash} color="#A4ADBF" size={18} />
      </Pressable> : icon ? <FontAwesomeIcon icon={icon} color="#A4ADBF" size={17} style={s.fieldIcon} /> : null}
    </View>
    {invalid ? <Text accessibilityRole="alert" style={s.feedbackInvalid}>{invalid}</Text> : null}
    {feedback.length > 0 ? <View accessibilityLiveRegion="polite">
      {feedback.map(item => <Text key={item.message} style={[s.fieldFeedback, item.valid ? s.feedbackValid : s.feedbackInvalid]}>
        {item.valid ? '✓' : '•'} {item.message}
      </Text>)}
    </View> : null}
  </View>;
}

export function Button({ title, onPress, disabled, secondary = false, accent = false, icon }: {
  title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; accent?: boolean; icon?: IconDefinition;
}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    accessibilityState={{ disabled: !!disabled }} style={({ pressed }) => [s.button, secondary && s.secondary, accent && s.accent, (disabled || pressed) && s.dim]}>
    {icon ? <FontAwesomeIcon icon={icon} color={accent ? '#F8F9FF' : secondary ? '#E2E7F0' : '#16240E'} size={17} style={s.buttonIcon} /> : null}
    <Text style={[s.buttonText, secondary && s.secondaryText, accent && s.accentText]}>{title}</Text>
  </Pressable>;
}

const s = StyleSheet.create({
accent: { backgroundColor: '#4961EE' },
button: { backgroundColor: '#B7F576', borderRadius: 13, padding: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, minHeight: 52 },
buttonIcon: { marginRight: 2 },
fieldIconButton: { position: 'absolute', right: 9, padding: 8 },
fieldIcon: { position: 'absolute', right: 16 },
field: { gap: 8, marginVertical: 3 },
fieldFeedback: { fontSize: 13, lineHeight: 20 },
dim: { opacity: 0.55 },
inputInvalid: { borderColor: '#FFC0B7' },
feedbackInvalid: { color: '#FFC0B7' },
feedbackValid: { color: '#B7F576' },
buttonText: { color: '#16240E', fontSize: 16, fontWeight: '700' },
inputWrap: { position: 'relative', justifyContent: 'center' },
accentText: { color: '#F8F9FF' },
input: { color: '#FAFAF5', backgroundColor: '#111722', borderColor: '#3B4355', borderWidth: 1, borderRadius: 12, padding: 15, paddingRight: 48, fontSize: 16, minHeight: 52 },
secondary: { backgroundColor: '#242D3E' },
label: { color: '#DBE0EB', fontSize: 13, fontWeight: '600', marginTop: 6 },
inputValid: { borderColor: '#B7F576' },
secondaryText: { color: '#E2E7F0' }
});
