import { Image, StyleSheet, Text, View } from 'react-native';

export function Brand() {
  return <View style={styles.lockup}>
    <Image accessibilityLabel="Sonora logo" source={require('../../assets/logo.png')} resizeMode="contain" style={styles.logo} />
    <Text style={styles.name}>Sonora</Text>
  </View>;
}

const styles = StyleSheet.create({
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 43, height: 43 },
  name: { color: '#F3F3E9', fontSize: 22, fontWeight: '800', letterSpacing: 0.2 },
});
