import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { ApiClient, ApiError, normalizeBaseUrl, tokenFromInput, type User } from '../api/client';
import { secureStorage } from '../storage';

type Screen = 'login' | 'register' | 'verify' | 'forgot' | 'reset' | 'settings';
const SERVER_KEY = 'sonora.server.v1';
const defaultServer = process.env.EXPO_PUBLIC_API_URL || (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');
const titles: Record<Screen, string> = {
  login: 'Retrouve ton rythme.', register: 'Bienvenue chez toi.', verify: 'Un dernier petit pas.',
  forgot: 'On te remet en piste.', reset: 'Un nouveau départ.', settings: 'Ton serveur Sonora.',
};

function Field({ label, value, change, password = false, email = false }: {
  label: string; value: string; change: (value: string) => void; password?: boolean; email?: boolean;
}) {
  return <View style={s.field}><Text style={s.label}>{label}</Text>
    <TextInput accessibilityLabel={label} style={s.input} value={value} onChangeText={change}
      secureTextEntry={password} autoCapitalize="none" autoCorrect={false}
      keyboardType={email ? 'email-address' : 'default'} />
  </View>;
}

function Button({ title, onPress, disabled, secondary = false }: {
  title: string; onPress: () => void; disabled?: boolean; secondary?: boolean;
}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    accessibilityState={{ disabled: !!disabled }} style={({ pressed }) => [s.button, secondary && s.secondary, (disabled || pressed) && s.dim]}>
    <Text style={[s.buttonText, secondary && s.secondaryText]}>{title}</Text>
  </Pressable>;
}

function Sonora() {
  const [client, setClient] = useState<ApiClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>('login');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [link, setLink] = useState('');
  const [server, setServer] = useState(defaultServer);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const saved = await secureStorage.getItem(SERVER_KEY);
        if (!active) return;
        const url = normalizeBaseUrl(saved ?? defaultServer);
        setServer(url); setClient(new ApiClient(url, secureStorage));
      } catch {
        if (active) { setError('Impossible de lire la configuration. Configurez le serveur pour continuer.'); setScreen('settings'); setReady(true); }
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!client) return;
    let active = true;
    setReady(false); setUser(client.user);
    const unsubscribe = client.subscribe(setUser);
    void client.restore().catch(e => { if (active) setError(e instanceof Error ? e.message : 'Veuillez vous reconnecter.'); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; unsubscribe(); };
  }, [client]);

  useEffect(() => {
    if (!client || !user || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return;
    let active = true;
    void client.registerDevice(Platform.OS === 'ios' ? 'IOS' : 'ANDROID', `${Platform.OS} ${Platform.Version}`)
      .catch(() => { if (active) setNotice('Connexion réussie. L’enregistrement de cet appareil sera retenté à la prochaine connexion.'); });
    return () => { active = false; };
  }, [client, user?.id]);

  useEffect(() => {
    const receive = (url: string | null) => {
      if (!url) return;
      try {
        const parsed = new URL(url);
        const path = parsed.protocol === 'sonora:' ? `/${parsed.hostname}${parsed.pathname}` : parsed.pathname;
        if (!['/auth/reset-password', '/auth/verify-email'].includes(path)) return;
        tokenFromInput(url); setLink(url); setPassword(''); setConfirm(''); setError(''); setNotice('');
        setScreen(path.endsWith('reset-password') ? 'reset' : 'verify');
      } catch { /* Ignore unrelated links without contacting any server. */ }
    };
    void Linking.getInitialURL().then(receive).catch(() => undefined);
    const subscription = Linking.addEventListener('url', event => receive(event.url));
    return () => subscription.remove();
  }, []);

  function navigate(next: Screen) {
    setPassword(''); setConfirm(''); setLink(''); setError(''); setNotice(''); setScreen(next);
  }
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (e) {
      setError(e instanceof Error ? e.message : 'Une erreur est survenue. Réessayez.');
      if (e instanceof ApiError && e.status === 403 && screen === 'login') { setPassword(''); setScreen('verify'); }
    } finally { working.current = false; setBusy(false); }
  }
  function validateEmail() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error('Saisissez une adresse email valide.');
  }
  function validatePassword() {
    if (password.length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
    if (password !== confirm) throw new Error('Les deux mots de passe ne correspondent pas.');
  }

  async function submit() {
    if (screen === 'settings') {
      const url = normalizeBaseUrl(server);
      if (client?.baseUrl === url) { navigate('login'); return; }
      let warning = '';
      try { await client?.logout(); } catch (e) { warning = e instanceof Error ? e.message : ''; }
      await secureStorage.setItem(SERVER_KEY, url);
      setClient(new ApiClient(url, secureStorage)); navigate('login');
      setNotice(warning || 'Adresse du serveur enregistrée.'); return;
    }
    if (!client) throw new Error('Configurez d’abord le serveur.');
    if (['login', 'register', 'forgot'].includes(screen)) validateEmail();
    if (screen === 'login') {
      if (!password) throw new Error('Saisissez votre mot de passe.');
      await client.login(email, password); setPassword('');
    } else if (screen === 'register') {
      if (!name.trim()) throw new Error('Saisissez votre nom.');
      validatePassword();
      try { await client.register(name, email, password); }
      catch (e) {
        if (e instanceof ApiError && e.status === 503) {
          setScreen('verify'); setPassword(''); setConfirm('');
          throw new Error('L’envoi de l’email a échoué. Le compte peut déjà être créé : utilisez « Renvoyer l’email » après rétablissement du service.');
        }
        throw e;
      }
      navigate('verify'); setNotice('Compte créé. Consultez votre boîte mail pour vérifier votre adresse.');
    } else if (screen === 'verify') {
      await client.verify(link); navigate('login'); setNotice('Adresse vérifiée. Vous pouvez vous connecter.');
    } else if (screen === 'forgot') {
      await client.forgot(email); setNotice('Si ce compte est éligible, vous recevrez un email.');
    } else if (screen === 'reset') {
      validatePassword(); await client.reset(link, password); navigate('login');
      setNotice('Mot de passe modifié. Reconnectez-vous avec votre nouveau mot de passe.');
    }
  }

  const profile = !!user && screen !== 'settings' && screen !== 'reset' && screen !== 'verify';
  const labels: Record<Screen, string> = { login: 'Se connecter', register: 'Créer mon compte', verify: 'Valider mon email', forgot: 'Recevoir le lien', reset: 'Changer le mot de passe', settings: 'Enregistrer le serveur' };
  return <SafeAreaView style={s.safe}><StatusBar style="light" />
    <KeyboardAvoidingView style={s.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <View style={s.header}><Text style={s.brand}>SONORA<Text style={s.dot}> ●</Text></Text>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => navigate('settings')}><Text style={s.serverLink}>Serveur</Text></Pressable>
        </View>
        <View style={s.hero}><Text style={s.eyebrow}>LA MUSIQUE, ENSEMBLE</Text>
          <Text style={s.title}>{profile ? `Salut ${user.name}.` : titles[screen]}</Text>
          <Text style={s.subtitle}>{profile ? 'Ton espace personnel est prêt.' : 'Tes morceaux. Tes amis. Ton prochain moment.'}</Text>
        </View>
        {!ready ? <ActivityIndicator accessibilityLabel="Restauration de la session" color="#B7F576" size="large" /> : <View style={s.card}>
          {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
          {notice ? <Text accessibilityLiveRegion="polite" style={s.notice}>{notice}</Text> : null}
          {profile ? <>
            <Text style={s.section}>MON PROFIL</Text><Text style={s.profileName}>{user.name}</Text><Text style={s.muted}>{user.email}</Text>
            <Text style={s.label}>Mes genres musicaux</Text><Text style={s.muted}>{user.musicPreferences?.join(', ') || 'Aucun genre ajouté pour le moment.'}</Text>
            <Button title="Actualiser mon profil" disabled={busy} onPress={() => void run(async () => { setUser(await client!.request<User>('/users/me')); setNotice('Profil actualisé.'); })} secondary />
            <Button title="Se déconnecter" disabled={busy} onPress={() => void run(async () => { await client!.logout(); navigate('login'); setNotice('Vous êtes déconnecté.'); })} />
          </> : <>
            {screen === 'settings' ? <>
              <Text style={s.muted}>Sur un téléphone, indique l’adresse IP de ton ordinateur sur le même Wi-Fi. Un changement de serveur te déconnecte.</Text>
              <Field label="Adresse du backend" value={server} change={setServer} />
              <Text style={s.hint}>Utilisez HTTPS pour un serveur accessible sur Internet.</Text>
            </> : null}
            {screen === 'register' ? <Field label="Ton nom" value={name} change={setName} /> : null}
            {['login', 'register', 'forgot', 'verify'].includes(screen) ? <Field label="Adresse email" email value={email} change={setEmail} /> : null}
            {screen === 'verify' ? <Text style={s.muted}>Ouvre le lien reçu par email, puis reviens te connecter. Tu peux aussi coller ce lien ci-dessous.</Text> : null}
            {['reset', 'verify'].includes(screen) ? <Field label="Lien reçu par email" value={link} change={setLink} /> : null}
            {['login', 'register', 'reset'].includes(screen) ? <Field label={screen === 'reset' ? 'Nouveau mot de passe' : 'Mot de passe'} password value={password} change={setPassword} /> : null}
            {['register', 'reset'].includes(screen) ? <Field label="Confirmer le mot de passe" password value={confirm} change={setConfirm} /> : null}
            <Button title={busy ? 'Un instant…' : labels[screen]} disabled={busy} onPress={() => void run(submit)} />
            {screen === 'verify' ? <>
              <Button title="Renvoyer l’email" secondary disabled={busy} onPress={() => void run(async () => { validateEmail(); await client!.resend(email); setNotice('Si ce compte est éligible, vous recevrez un email.'); })} />
              <Button title="J’ai vérifié mon email" secondary disabled={busy} onPress={() => navigate('login')} />
            </> : null}
            {screen === 'login' ? <>
              <Button title="Créer un compte" secondary disabled={busy} onPress={() => navigate('register')} />
              <Button title="Mot de passe oublié ?" secondary disabled={busy} onPress={() => navigate('forgot')} />
            </> : null}
            {screen === 'forgot' ? <Button title="J’ai reçu le lien" secondary disabled={busy} onPress={() => navigate('reset')} /> : null}
            {screen !== 'login' ? <Button title="Retour à la connexion" secondary disabled={busy} onPress={() => navigate('login')} /> : null}
          </>}
        </View>}
        <Text style={s.footer}>UNE BONNE CONNEXION CHANGE TOUT.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

export default function App() { return <SafeAreaProvider><Sonora /></SafeAreaProvider>; }

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#10141E' }, grow: { flex: 1 },
  page: { flexGrow: 1, padding: 24, paddingBottom: 40, width: '100%', maxWidth: 540, alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  brand: { color: '#F3F3E9', fontSize: 22, fontWeight: '800', letterSpacing: 3 }, dot: { color: '#B7F576' },
  serverLink: { color: '#C0C6D4', padding: 12, fontSize: 14 }, hero: { paddingTop: 38, paddingBottom: 30 },
  eyebrow: { color: '#B7F576', letterSpacing: 2, fontSize: 11, fontWeight: '700', marginBottom: 15 },
  title: { color: '#F3F3E9', fontSize: 38, lineHeight: 44, fontWeight: '800', letterSpacing: -1.2 },
  subtitle: { color: '#A4ADBF', fontSize: 16, lineHeight: 24, marginTop: 14 },
  card: { backgroundColor: '#1B2130', borderColor: '#2D3547', borderWidth: 1, borderRadius: 24, padding: 22, gap: 12 },
  field: { gap: 8, marginVertical: 3 }, label: { color: '#DBE0EB', fontSize: 13, fontWeight: '600', marginTop: 6 },
  input: { color: '#FAFAF5', backgroundColor: '#111722', borderColor: '#3B4355', borderWidth: 1, borderRadius: 12, padding: 15, fontSize: 16, minHeight: 52 },
  button: { backgroundColor: '#B7F576', borderRadius: 13, padding: 16, alignItems: 'center', minHeight: 52 },
  buttonText: { color: '#16240E', fontSize: 16, fontWeight: '700' }, secondary: { backgroundColor: '#242D3E' },
  secondaryText: { color: '#E2E7F0' }, dim: { opacity: 0.55 }, muted: { color: '#B4BDCE', lineHeight: 23, fontSize: 15 },
  error: { color: '#FFC0B7', backgroundColor: '#452825', borderRadius: 10, padding: 12, lineHeight: 21 },
  notice: { color: '#D4F2B6', backgroundColor: '#283525', borderRadius: 10, padding: 12, lineHeight: 21 },
  hint: { color: '#9FAABC', fontSize: 12, lineHeight: 18 }, footer: { color: '#6F7B90', textAlign: 'center', fontSize: 10, letterSpacing: 1.4, marginTop: 30 },
  section: { color: '#B7F576', fontSize: 11, letterSpacing: 2, fontWeight: '700' }, profileName: { fontSize: 26, fontWeight: '700', color: '#F3F3E9' },
});
