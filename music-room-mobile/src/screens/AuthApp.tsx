import { openEmailInbox } from '../auth/open-email';
import { acquireFacebookCredential } from '../auth/native-facebook';
import { useAutoDismiss } from '../hooks/useAutoDismiss';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, ImageBackground, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { randomUUID } from 'expo-crypto';
import { ToastProvider, useScreenToast } from '../components/Toast';
import { ApiClient, ApiError, normalizeBaseUrl, tokenFromInput, type User } from '../api/client';
import { secureStorage } from '../storage';
import { AccountListScreen } from './AccountListScreen';
import { DevicesScreen } from './DevicesScreen';
import { ProfileScreen } from './ProfileScreen';
import { PeopleScreen } from './PeopleScreen';
import { acquireGoogleIdToken } from '../auth/native-google';
import { passwordValidation } from '../auth/password-validation';
import { Brand } from '../components/Brand';
import { LegalDocuments, type LegalDocument } from '../components/LegalDocuments';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faEnvelope, faUser } from '@fortawesome/free-regular-svg-icons';
import { faGoogle, faFacebookF } from '@fortawesome/free-brands-svg-icons';
import { faArrowUpRightFromSquare, faEnvelopeCircleCheck, faKey, faRotateRight, faTowerBroadcast, faList, faMobileScreen } from '@fortawesome/free-solid-svg-icons';
import { Button, Field } from '../components/FormControls';

type Screen = 'welcome' | 'login' | 'register' | 'verify' | 'forgot' | 'reset' | 'settings';
const SERVER_KEY = 'sonora.server.v1';
function createClient(url: string) {
  return new ApiClient(url, secureStorage, fetch, {
    platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
    model: Device.modelName ?? `${Platform.OS} device`,
    appVersion: Constants.expoConfig?.version ?? '0.1.0',
  }, randomUUID);
}
const defaultServer = process.env.EXPO_PUBLIC_API_URL || (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');
function PasswordFields({ password, confirm, onPassword, onConfirm, submitted, reset = false }: {
  password: string; confirm: string; onPassword: (value: string) => void; onConfirm: (value: string) => void;
  submitted: boolean; reset?: boolean;
}) {
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const validation = passwordValidation(password, confirm);
  return <>
    <Field label={reset ? 'New password' : 'Password'} password value={password}
      change={value => { setPasswordTouched(true); onPassword(value); }} onBlur={() => setPasswordTouched(true)}
      feedback={passwordTouched || submitted ? validation.password : []} />
    <Field label={reset ? 'Confirm new password' : 'Confirm password'} password value={confirm}
      change={value => { setConfirmTouched(true); onConfirm(value); }} onBlur={() => setConfirmTouched(true)}
      feedback={confirmTouched || submitted ? validation.confirm : []} />
  </>;
}

function WelcomeScreen({ onRegister, onLogin }: { onRegister: () => void; onLogin: () => void }) {
  return <View style={s.welcome}>
    <ImageBackground source={require('../../assets/hero-artwork.png')} resizeMode="cover" style={s.welcomeArt} imageStyle={s.welcomeArtImage}>
      <View style={s.artGlow} />
      <View style={s.wave}><Text style={s.waveText}>ONE ROOM. EVERYONE’S SOUND.</Text><Image accessibilityLabel="Audio waveform" source={require('../../assets/waves-hero.png')} resizeMode="contain" style={s.waveImage} /></View>
    </ImageBackground>
    <View style={s.welcomeCopy}>
      <Text style={s.welcomeTitle}>Good music.{'\n'}Better together.</Text>
      <Text style={s.welcomeSubtitle}>Make the queue yours. Vote on what’s next, build playlists together and share the room.</Text>
    </View>
    <View style={s.welcomeActions}>
      <Button title="Find your people  →" accent onPress={onRegister} />
      <Pressable accessibilityRole="button" onPress={onLogin} style={s.loginLink}>
        <Text style={s.loginLinkText}>Already have an account? <Text style={s.loginLinkStrong}>Log in</Text></Text>
      </Pressable>
    </View>
  </View>;
}

function RegisterScreen({ name, email, password, confirm, termsAccepted, busy, ready, passwordSubmitted, onName, onEmail, onPassword, onConfirm, onTerms, onDocument, onSubmit, onGoogle, onFacebook, onLogin }: {
  name: string; email: string; password: string; confirm: string; termsAccepted: boolean; busy: boolean; ready: boolean;
  onName: (value: string) => void; onEmail: (value: string) => void; onPassword: (value: string) => void; onConfirm: (value: string) => void;
  onTerms: () => void; onSubmit: () => void; onGoogle: () => void; onFacebook: () => void; onLogin: () => void;
  onDocument: (document: LegalDocument) => void;
  passwordSubmitted: boolean;
}) {
  return <View style={s.registerPanel}>
    <Text style={s.registerEyebrow}>JOIN SONORA</Text>
    <Text style={s.registerTitle}>Your next favorite{`\n`}starts here.</Text>
    <Text style={s.registerSubtitle}>A little about you. A lot of good music.</Text>
    <Field required submitted={passwordSubmitted} label="Your name" value={name} change={onName} maxLength={100} icon={faUser} />
    <Field required submitted={passwordSubmitted} label="Email address" email value={email} change={onEmail} icon={faEnvelope} />
    <PasswordFields password={password} confirm={confirm} onPassword={onPassword} onConfirm={onConfirm} submitted={passwordSubmitted} />
    <View style={s.termsRow}>
      <Pressable accessibilityRole="checkbox" accessibilityLabel="Accept Terms of Service and Privacy Policy" accessibilityState={{ checked: termsAccepted, disabled: busy }} disabled={busy} onPress={onTerms} style={s.checkboxTouch}>
        <View style={[s.checkbox, termsAccepted && s.checkboxChecked]}>{termsAccepted ? <Text style={s.checkmark}>✓</Text> : null}</View>
      </Pressable>
      <Text style={s.termsText}>I agree to the <Text accessibilityRole="link" style={s.termsLink} onPress={() => onDocument('terms')}>Terms of Service</Text> and <Text accessibilityRole="link" style={s.termsLink} onPress={() => onDocument('privacy')}>Privacy Policy</Text>.</Text>
    </View>
    {passwordSubmitted && !termsAccepted ? <Text accessibilityRole="alert" style={s.error}>Accept the terms to create your account.</Text> : null}
    <Button title="Create account  →" accent disabled={busy} onPress={onSubmit} />
    <View style={s.divider}><View style={s.dividerLine} /><Text style={s.dividerText}>or continue with</Text><View style={s.dividerLine} /></View>
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <View style={{ flex: 1 }}><Button icon={faGoogle} title="Google" secondary disabled={busy || !ready} onPress={onGoogle} /></View>
      <View style={{ flex: 1 }}><Button icon={faFacebookF} title="Facebook" secondary disabled={busy || !ready} onPress={onFacebook} /></View>
    </View>
    <Pressable accessibilityRole="button" onPress={onLogin} style={s.registerLoginLink}>
      <Text style={s.loginLinkText}>Already part of the room? <Text style={s.loginLinkStrong}>Log in</Text></Text>
    </Pressable>
    <Text style={s.registerFooter}>We’ll send a verification link to your email.</Text>
  </View>;
}

function LoginScreen({ formError, submitted, email, password, busy, ready, onEmail, onPassword, onSubmit, onGoogle, onFacebook, onForgot, onRegister }: {
  formError: string; submitted: boolean; email: string; password: string; busy: boolean; ready: boolean; onEmail: (value: string) => void; onPassword: (value: string) => void;
  onSubmit: () => void; onGoogle: () => void; onFacebook: () => void; onForgot: () => void; onRegister: () => void;
}) {
  return <View style={s.registerPanel}>
    <Text style={s.registerEyebrow}>WELCOME BACK</Text>
    <Text style={s.registerTitle}>Back for an encore.</Text>
    <Text style={s.registerSubtitle}>Your people. Your playlists. Your room.</Text>
    <Field required submitted={submitted} label="Email address" email value={email} change={onEmail} icon={faEnvelope} />
    <View style={s.passwordField}><Field required submitted={submitted} label="Password" password value={password} change={onPassword} /><Pressable accessibilityRole="button" onPress={onForgot} style={s.forgotLink}><Text style={s.forgotText}>Forgot password?</Text></Pressable></View>
    {formError ? <Text accessibilityRole="alert" style={s.error}>{formError}</Text> : null}
    <Button title="Log in  →" accent disabled={busy} onPress={onSubmit} />
    <View style={s.divider}><View style={s.dividerLine} /><Text style={s.dividerText}>or continue with</Text><View style={s.dividerLine} /></View>
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <View style={{ flex: 1 }}><Button icon={faGoogle} title="Google" secondary disabled={busy || !ready} onPress={onGoogle} /></View>
      <View style={{ flex: 1 }}><Button icon={faFacebookF} title="Facebook" secondary disabled={busy || !ready} onPress={onFacebook} /></View>
    </View>
    <Pressable accessibilityRole="button" onPress={onRegister} style={s.registerLoginLink}>
      <Text style={s.loginLinkText}>New to Sonora? <Text style={s.loginLinkStrong}>Create an account</Text></Text>
    </Pressable>
  </View>;
}

function VerifyScreen({ email, busy, onOpenEmail, onResend, onLogin }: {
  email: string; busy: boolean; onOpenEmail: () => void; onResend: () => void; onLogin: () => void;
}) {
  return <View style={s.registerPanel}>
    <Text style={s.verifyTop}>ONE LAST THING</Text>
    <Text style={s.registerTitle}>Check your inbox.</Text>
    <View style={s.mailCircle}><FontAwesomeIcon icon={faEnvelopeCircleCheck} color="#A9B6FF" size={42} /></View>
    <Text style={s.verifyTitle}>Your room is almost ready.</Text>
    <Text style={s.verifyText}>We sent a verification link to</Text>
    <Text style={s.verifyEmail}>{email || 'your email address'}</Text>
    <Text style={s.verifyText}>Open the link to activate your account. The link expires in 24 hours.</Text>
    <Button title="Open email app" icon={faArrowUpRightFromSquare} accent disabled={busy} onPress={onOpenEmail} />
    <View style={s.verifyPanel}><Text style={s.verifyPanelTitle}>Didn't get the email?</Text><Text style={s.verifyText}>Check your spam folder, or send a fresh link.</Text><Button title="Resend verification email" icon={faRotateRight} secondary disabled={busy} onPress={onResend} /></View>
    <Pressable accessibilityRole="button" onPress={onLogin} style={s.registerLoginLink}><Text style={s.loginLinkText}>Already verified? <Text style={s.loginLinkStrong}>Return to login</Text></Text></Pressable>
  </View>;
}

function ForgotPasswordScreen({ submitted, email, busy, onEmail, onSubmit, onLogin }: {
  submitted: boolean; email: string; busy: boolean; onEmail: (value: string) => void; onSubmit: () => void; onLogin: () => void;
}) {
  return <View style={s.registerPanel}>
    <Text style={s.verifyTop}>RESET PASSWORD</Text>
    <Text style={s.registerTitle}>Let’s get you back in.</Text>
    <View style={s.mailCircle}><FontAwesomeIcon icon={faKey} color="#A9B6FF" size={42} /></View>
    <Text style={s.verifyText}>Forgot your password? Enter your account email and we’ll send a secure reset link.</Text>
    <Field required submitted={submitted} label="Email address" email value={email} change={onEmail} icon={faEnvelope} />
    <Button title="Send reset link  →" accent disabled={busy} onPress={onSubmit} />
    <View style={s.verifyPanel}><Text style={s.verifyPanelTitle}>What happens next?</Text><Text style={s.verifyText}>Follow the link in your email to choose a new password. For your security, the link is valid for 30 minutes.</Text></View>
    <Pressable accessibilityRole="button" onPress={onLogin} style={s.registerLoginLink}><Text style={s.loginLinkStrong}>Back to login</Text></Pressable>
    <Text style={s.registerFooter}>Signed up with Google or Facebook? Use that option on the login page instead.</Text>
  </View>;
}

function ResetPasswordScreen({ password, confirm, busy, passwordSubmitted, onPassword, onConfirm, onSubmit, onLogin }: {
  password: string; confirm: string; busy: boolean; onPassword: (value: string) => void; onConfirm: (value: string) => void;
  onSubmit: () => void; onLogin: () => void;
  passwordSubmitted: boolean;
}) {
  return <View style={s.registerPanel}>
    <Text style={s.verifyTop}>RESET PASSWORD</Text>
    <Text style={s.registerTitle}>Set new password.</Text>
    <View style={s.mailCircle}><FontAwesomeIcon icon={faKey} color="#A9B6FF" size={42} /></View>
    <Text style={s.verifyText}>Choose a new password to keep your Sonora account secure.</Text>
    <PasswordFields reset password={password} confirm={confirm} onPassword={onPassword} onConfirm={onConfirm} submitted={passwordSubmitted} />
    <Button title="Save new password  →" accent disabled={busy} onPress={onSubmit} />
    <Pressable accessibilityRole="button" onPress={onLogin} style={s.registerLoginLink}><Text style={s.loginLinkStrong}>Back to login</Text></Pressable>
    <Text style={s.registerFooter}>After saving, log in with your new password.</Text>
  </View>;
}

function Sonora() {
  const [client, setClient] = useState<ApiClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>('welcome');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordSubmitted, setPasswordSubmitted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [legalDocument, setLegalDocument] = useState<LegalDocument | null>(null);
  const [link, setLink] = useState('');
  const [server, setServer] = useState(defaultServer);
  const [serverError, setServerError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useAutoDismiss(notice, setNotice);
  const [networkError, setNetworkError] = useState(false);
  const lastOperation = useRef<(() => Promise<void>) | null>(null);
  useAutoDismiss(networkError ? '' : error, setError);
  useScreenToast(screen === 'login' && !networkError ? '' : error, notice, networkError && error ? () => { if (lastOperation.current) void run(lastOperation.current); } : undefined);
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [area, setArea] = useState<'profile' | 'people' | 'rooms' | 'playlists' | 'devices'>('profile');
  const [areaBusy, setAreaBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const saved = await secureStorage.getItem(SERVER_KEY);
        if (!active) return;
        const url = normalizeBaseUrl(saved ?? defaultServer);
        setServer(url); setClient(createClient(url));
      } catch {
        if (active) { setError('Unable to read the configuration. Configure the server to continue.'); setScreen('settings'); setReady(true); }
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!client) return;
    let active = true;
    setReady(false); setUser(client.user);
    const unsubscribe = client.subscribe(setUser);
    void client.restore().catch(e => { if (active) setError(e instanceof Error ? e.message : 'Please sign in again.'); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; unsubscribe(); };
  }, [client]);

  useEffect(() => {
    const receive = (url: string | null) => {
      if (!url) return;
      try {
        const parsed = new URL(url);
        const path = parsed.protocol === 'sonora:' ? `/${parsed.hostname}${parsed.pathname}` : parsed.pathname;
        clearFormFields(); setError('');
        if (path === '/auth/verified') {
          setLink(''); setScreen('login');
          setNotice('Your email address has been confirmed. You can now log in.');
          return;
        }
        if (!['/auth/reset-password', '/auth/verify-email'].includes(path)) return;
        tokenFromInput(url); setLink(url); setNotice('');
        setScreen(path.endsWith('reset-password') ? 'reset' : 'verify');
      } catch { /* Ignore unrelated links without contacting any server. */ }
    };
    void Linking.getInitialURL().then(receive).catch(() => undefined);
    const subscription = Linking.addEventListener('url', event => receive(event.url));
    return () => subscription.remove();
  }, []);

  function navigate(next: Screen) {
    clearFormFields(); setNetworkError(false); setFormSubmitted(false); setError(''); setNotice(''); setScreen(next);
  }
  function clearFormFields() {
    setPasswordSubmitted(false);
    setEmail(''); setName(''); setPassword(''); setConfirm(''); setTermsAccepted(false); setLink('');
  }
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true; lastOperation.current = action; setNetworkError(false); setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (e) {
      setNetworkError(e instanceof ApiError && e.status === 0);
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      if (e instanceof ApiError && e.status === 403 && screen === 'login') { clearFormFields(); setEmail(email); setScreen('verify'); }
    } finally { working.current = false; setBusy(false); }
  }
  function validateEmail() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error('Enter a valid email address.');
  }
  async function submit() {
    setFormSubmitted(true);
    if (screen === 'register' || screen === 'reset') setPasswordSubmitted(true);
    if (['login', 'register', 'forgot'].includes(screen) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return;
    if (screen === 'login' && !password) return;
    if (screen === 'register' && (!name.trim() || !termsAccepted)) { setPasswordSubmitted(true); return; }
    if (screen === 'register' || screen === 'reset') {
      setPasswordSubmitted(true);
      if (!passwordValidation(password, confirm).valid) return;
    }
    if (screen === 'settings') {
      let url: string;
      try { url = normalizeBaseUrl(server); setServerError(''); }
      catch (e) { setServerError(e instanceof Error ? e.message : 'Enter a valid server address.'); return; }
      if (client?.baseUrl === url) { navigate('login'); return; }
      let warning = '';
      try { await client?.logout(); } catch (e) { warning = e instanceof Error ? e.message : ''; }
      await secureStorage.setItem(SERVER_KEY, url);
      setClient(createClient(url)); navigate('login');
      setNotice(warning || 'Server address saved.'); return;
    }
    if (!client) throw new Error('Configure the server first.');
    if (['login', 'register', 'forgot'].includes(screen)) validateEmail();
    if (screen === 'login') {
      if (!password) throw new Error('Enter your password.');
      await client.login(email, password); setPassword('');
    } else if (screen === 'register') {
      if (!name.trim()) throw new Error('Enter your name.');
      if (!termsAccepted) throw new Error('Accept the terms to create your account.');
      try { await client.register(name, email, password); }
      catch (e) {
        if (e instanceof ApiError && e.status === 503) {
          clearFormFields(); setEmail(email); setScreen('verify');
          throw new Error('Email delivery failed. Your account may already exist; resend the verification email when the service is available again.');
        }
        throw e;
      }
      const registeredEmail = email;
      navigate('verify'); setEmail(registeredEmail); setNotice('Account created. Check your inbox to verify your email address.');
    } else if (screen === 'verify') {
      await client.verify(link); navigate('login'); setNotice('Email verified. You can now log in.');
    } else if (screen === 'forgot') {
      await client.forgot(email); setNotice('If this account is eligible, you will receive an email.');
    } else if (screen === 'reset') {
      await client.reset(link, password); navigate('login');
      setNotice('Password updated. Log in again with your new password.');
    }
  }

  async function facebookLogin() {
    if (!client) throw new Error('Configure the server first.');
    try {
      const signedIn = await client.loginWithFacebook(acquireFacebookCredential);
      if (!signedIn) setNotice('Facebook sign-in was cancelled.');
      else { clearFormFields(); setArea('profile'); }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        throw new Error('This account already exists. Log in with your usual method, then open My profile → Link Facebook.');
      }
      throw e;
    }
  }

  async function googleLogin() {
    if (!client) throw new Error('Configure the server first.');
    try {
      const signedIn = await client.loginWithGoogle(acquireGoogleIdToken);
      setPassword(''); setConfirm('');
      if (!signedIn) setNotice('Google sign-in was cancelled.');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        navigate('login');
        throw new Error('This account already exists. Log in with your usual method, then open My profile → Link Google.');
      }
      throw e;
    }
  }

  function openEmailApp() {
    void openEmailInbox(Platform.OS, {
      openURL: Linking.openURL,
      openAndroidInbox: async () => {
        const { startActivityAsync } = await import('expo-intent-launcher');
        await startActivityAsync('android.intent.action.MAIN', { category: 'android.intent.category.APP_EMAIL' });
      },
    }).catch(() => {
      setError('Open your email app or webmail to read the message from Sonora.');
    });
  }

  const profile = !!user && screen !== 'settings' && screen !== 'reset' && screen !== 'verify';
  const labels: Record<Screen, string> = { welcome: '', login: 'Log in', register: 'Create account', verify: 'Verify email', forgot: 'Get reset link', reset: 'Change password', settings: 'Save server' };
  return <SafeAreaView style={[s.safe, profile && { backgroundColor: '#08090d' }]}><StatusBar style="light" />
    <LegalDocuments document={legalDocument} onClose={() => setLegalDocument(null)} />
    <KeyboardAvoidingView style={s.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        {!profile ? <View style={s.header}><Brand />
          <Pressable accessibilityRole="button" disabled={busy || areaBusy} onPress={() => navigate('settings')}><Text style={s.serverLink}>Server</Text></Pressable>
        </View> : null}
        {profile || screen === 'welcome' || screen === 'register' || screen === 'login' || screen === 'verify' || screen === 'forgot' || screen === 'reset' ? null : <View style={s.hero}><Text style={s.eyebrow}>MUSIC, TOGETHER</Text>
          <Text style={s.title}>Your Sonora server</Text>
          <Text style={s.subtitle}>Choose the backend used by this device.</Text>
        </View>}
        {!ready && screen !== 'welcome' && screen !== 'register' && screen !== 'login' && screen !== 'verify' && screen !== 'forgot' && screen !== 'reset' ? <ActivityIndicator accessibilityLabel="Restoring session" color="#B7F576" size="large" /> : screen === 'welcome' && !user ? <WelcomeScreen onRegister={() => navigate('register')} onLogin={() => navigate('login')} /> : screen === 'register' && !user ? <>
          <Pressable accessibilityRole="button" onPress={() => navigate('welcome')} style={s.backWelcome}>
            <Text style={s.backWelcomeText}>← Welcome</Text>
          </Pressable>
          <RegisterScreen name={name} email={email} password={password} confirm={confirm} termsAccepted={termsAccepted} busy={busy} ready={ready} passwordSubmitted={passwordSubmitted}
            onName={setName} onEmail={setEmail} onPassword={setPassword} onConfirm={setConfirm} onTerms={() => setTermsAccepted(value => !value)}
            onDocument={setLegalDocument}
            onSubmit={() => void run(submit)} onGoogle={() => void run(googleLogin)} onFacebook={() => void run(facebookLogin)} onLogin={() => navigate('login')} />
        </> : screen === 'login' && !user ? <>
          <Pressable accessibilityRole="button" onPress={() => navigate('welcome')} style={s.backWelcome}><Text style={s.backWelcomeText}>← Welcome</Text></Pressable>
          <LoginScreen submitted={formSubmitted} formError={networkError ? '' : error} email={email} password={password} busy={busy} ready={ready} onEmail={setEmail} onPassword={setPassword}
            onSubmit={() => void run(submit)} onGoogle={() => void run(googleLogin)} onFacebook={() => void run(facebookLogin)} onForgot={() => navigate('forgot')} onRegister={() => navigate('register')} />
        </> : screen === 'verify' && !user ? <>
          <Pressable accessibilityRole="button" onPress={() => navigate('welcome')} style={s.backWelcome}><Text style={s.backWelcomeText}>← Welcome</Text></Pressable>
          <VerifyScreen email={email} busy={busy} onOpenEmail={openEmailApp}
            onResend={() => void run(async () => { validateEmail(); await client!.resend(email); setNotice('If this account is eligible, you will receive an email.'); })} onLogin={() => navigate('login')} />
        </> : screen === 'forgot' && !user ? <>
          <Pressable accessibilityRole="button" onPress={() => navigate('welcome')} style={s.backWelcome}><Text style={s.backWelcomeText}>← Welcome</Text></Pressable>
          <ForgotPasswordScreen submitted={formSubmitted} email={email} busy={busy} onEmail={setEmail} onSubmit={() => void run(submit)} onLogin={() => navigate('login')} />
        </> : screen === 'reset' ? <>
          <Pressable accessibilityRole="button" onPress={() => navigate('welcome')} style={s.backWelcome}><Text style={s.backWelcomeText}>← Welcome</Text></Pressable>
          <ResetPasswordScreen password={password} confirm={confirm} busy={busy} passwordSubmitted={passwordSubmitted} onPassword={setPassword} onConfirm={setConfirm}
            onSubmit={() => void run(submit)} onLogin={() => navigate('login')} />
        </> : <View style={profile ? { gap: 12 } : s.card}>
          {!profile && screen !== 'settings' ? <Pressable accessibilityRole="button" onPress={() => navigate('welcome')} style={s.backWelcome}>
            <Text style={s.backWelcomeText}>← Welcome</Text>
          </Pressable> : null}
          {profile ? <>
            {area === 'profile' ? <ProfileScreen key={user.id} client={client!} onBusy={setAreaBusy}
              onPeople={() => setArea('people')}
              onLogout={async () => { await client!.logout(); navigate('login'); setArea('profile'); setNotice('You are logged out.'); }}
              onServer={async address => {
                const url = normalizeBaseUrl(address);
                if (client!.baseUrl === url) return;
                let warning = '';
                try { await client!.logout(); } catch (e) { warning = e instanceof Error ? e.message : ''; }
                await secureStorage.setItem(SERVER_KEY, url);
                setServer(url); setClient(createClient(url)); navigate('login'); setArea('profile');
                setNotice(warning || 'Backend address saved.');
              }} /> : area === 'people' ?
              <PeopleScreen key={user.id} client={client!} userId={user.id} onBusy={setAreaBusy} onBack={() => setArea('profile')} /> : area === 'devices' ?
              <DevicesScreen key={user.id} client={client!} onBusy={setAreaBusy} /> :
              <AccountListScreen key={area} client={client!} area={area} />}
          </> : <>
            {screen === 'settings' ? <>
              <Text style={s.muted}>On a phone, enter your computer’s IP address on the same Wi-Fi. Changing the server signs you out.</Text>
              <Field label="Backend address" value={server} change={value => { setServer(value); setServerError(''); }} feedback={serverError ? [{ valid: false, message: serverError }] : []} />
              <Text style={s.hint}>Use HTTPS for a server accessible over the internet.</Text>
            </> : null}
            <Button title={busy ? 'Please wait…' : labels[screen]} disabled={busy} onPress={() => void run(submit)} />
            <Button title="Back to login" secondary disabled={busy} onPress={() => navigate('login')} />
          </>}
        </View>}
        {!profile ? <Text style={s.footer}>GOOD MUSIC. BETTER TOGETHER.</Text> : null}
      </ScrollView>
      {profile ? <View style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: '#232532', backgroundColor: '#08090d', paddingVertical: 12 }}>
        {(['rooms', 'playlists', 'devices', 'profile'] as const).map(tab => <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: area === tab || (tab === 'profile' && area === 'people') }} disabled={busy || areaBusy} onPress={() => setArea(tab)} style={{ flex: 1, alignItems: 'center', gap: 5, paddingVertical: 5 }}>
          <FontAwesomeIcon icon={tab === 'rooms' ? faTowerBroadcast : tab === 'playlists' ? faList : tab === 'devices' ? faMobileScreen : faUser} size={20} color={area === tab || (tab === 'profile' && area === 'people') ? '#b1baff' : '#8589a1'} />
          <Text style={{ color: area === tab ? '#b1baff' : '#8589a1', fontSize: 11 }}>{tab[0].toUpperCase() + tab.slice(1)}</Text>
        </Pressable>)}
      </View> : null}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

export default function App() { return <SafeAreaProvider><ToastProvider><Sonora /></ToastProvider></SafeAreaProvider>; }

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
  muted: { color: '#B4BDCE', lineHeight: 23, fontSize: 15 },
  error: { color: '#FFC0B7', backgroundColor: '#452825', borderRadius: 10, padding: 12, lineHeight: 21 },
  notice: { color: '#D4F2B6', backgroundColor: '#283525', borderRadius: 10, padding: 12, lineHeight: 21 },
  hint: { color: '#9FAABC', fontSize: 12, lineHeight: 18 }, footer: { color: '#6F7B90', textAlign: 'center', fontSize: 10, letterSpacing: 1.4, marginTop: 30 },
  section: { color: '#B7F576', fontSize: 11, letterSpacing: 2, fontWeight: '700' }, profileName: { fontSize: 26, fontWeight: '700', color: '#F3F3E9' },
  welcome: { flex: 1, paddingTop: 10 }, welcomeArt: { height: 280, overflow: 'hidden', borderRadius: 24, backgroundColor: '#090B12', borderWidth: 1, borderColor: '#272D42' },
  welcomeArtImage: { opacity: 0.92 }, artGlow: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(5, 7, 18, 0.16)' },
  wave: { position: 'absolute', left: 20, right: 20, bottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  waveText: { color: '#A9B6FF', backgroundColor: '#1B244A', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 9, letterSpacing: 1.1, fontWeight: '700' }, waveImage: { width: 34, height: 24 },
  welcomeCopy: { paddingTop: 34, paddingBottom: 26 }, welcomeEyebrow: { color: '#A98BFF', fontSize: 11, letterSpacing: 2, fontWeight: '700', marginBottom: 14 },
  welcomeTitle: { color: '#F3F3E9', fontSize: 42, lineHeight: 45, fontWeight: '800' }, welcomeSubtitle: { color: '#A4ADBF', fontSize: 16, lineHeight: 24, marginTop: 16 },
  welcomeActions: { marginTop: 'auto', paddingTop: 14 }, loginLink: { alignItems: 'center', paddingVertical: 18 }, loginLinkText: { color: '#929BB0', fontSize: 13 }, loginLinkStrong: { color: '#F3F3E9', fontWeight: '700' },
  backWelcome: { alignSelf: 'flex-start', paddingVertical: 4 }, backWelcomeText: { color: '#A9B6FF', fontSize: 13, fontWeight: '600' },
  registerPanel: { paddingTop: 8, paddingBottom: 28, gap: 10 }, registerEyebrow: { color: '#A98BFF', fontSize: 11, letterSpacing: 2, fontWeight: '700', marginTop: 8 },
  registerTitle: { color: '#F3F3E9', fontSize: 34, lineHeight: 38, fontWeight: '800', marginTop: 2 }, registerSubtitle: { color: '#A4ADBF', fontSize: 15, lineHeight: 22, marginBottom: 12 },
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginVertical: 5 }, checkbox: { width: 16, height: 16, borderWidth: 1, borderColor: '#A9B6FF', borderRadius: 3, alignItems: 'center', justifyContent: 'center' }, checkboxChecked: { backgroundColor: '#526BFF' }, checkmark: { color: '#FFFFFF', fontSize: 12, lineHeight: 14, fontWeight: '800' }, termsText: { flex: 1, color: '#8D97AB', fontSize: 11, lineHeight: 17 }, termsLink: { color: '#A9B6FF' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 9, marginVertical: 5 }, dividerLine: { flex: 1, height: 1, backgroundColor: '#303747' }, dividerText: { color: '#737D91', fontSize: 11 }, registerLoginLink: { alignItems: 'center', paddingVertical: 8, marginTop: 2 }, registerFooter: { color: '#737D91', fontSize: 11, textAlign: 'center', lineHeight: 17 },
  checkboxTouch: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  passwordField: { gap: 3 }, forgotLink: { alignSelf: 'flex-end', paddingVertical: 4 }, forgotText: { color: '#A9B6FF', fontSize: 12 },
  verifyTop: { color: '#A98BFF', fontSize: 11, letterSpacing: 2, fontWeight: '700', marginTop: 8 }, mailCircle: { alignSelf: 'center', width: 128, height: 128, borderRadius: 64, backgroundColor: '#272044', alignItems: 'center', justifyContent: 'center', marginVertical: 14 }, verifyTitle: { color: '#F3F3E9', fontSize: 23, lineHeight: 28, fontWeight: '800', marginTop: 8 }, verifyText: { color: '#A4ADBF', fontSize: 14, lineHeight: 21 }, verifyEmail: { color: '#A9B6FF', fontSize: 14, fontWeight: '700' }, verifyPanel: { backgroundColor: '#171A25', borderRadius: 16, padding: 16, gap: 8, marginTop: 6 }, verifyPanelTitle: { color: '#F3F3E9', fontSize: 16, fontWeight: '700' },
});
