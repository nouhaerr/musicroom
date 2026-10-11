import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { interactiveFacebookToken, type FacebookCredential } from './facebook-flow';

let running = false;
export async function acquireFacebookCredential(): Promise<FacebookCredential | null> {
  if (running) throw new Error('Facebook sign-in is already in progress.');
  if (Constants.executionEnvironment === 'storeClient') throw new Error('Facebook requires a Sonora development build.');
  if (!process.env.EXPO_PUBLIC_FACEBOOK_APP_ID || !process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN) {
    throw new Error('Facebook sign-in is not configured yet. Email login is still available.');
  }
  running = true;
  try {
    let sdk: typeof import('react-native-fbsdk-next');
    let randomUUID: typeof import('expo-crypto').randomUUID;
    try {
      sdk = await import('react-native-fbsdk-next');
      ({ randomUUID } = await import('expo-crypto'));
    }
    catch { throw new Error('Install a new Sonora development build to use Facebook.'); }
    sdk.Settings.initializeSDK();
    return await interactiveFacebookToken({
      logOut: () => sdk.LoginManager.logOut(),
      login: (limited, nonce) => sdk.LoginManager.logInWithPermissions(['public_profile', 'email'], limited ? 'limited' : 'enabled', nonce),
      token: async limited => limited
        ? (await sdk.AuthenticationToken.getAuthenticationTokenIOS())?.authenticationToken ?? null
        : (await sdk.AccessToken.getCurrentAccessToken())?.accessToken ?? null,
    }, Platform.OS, randomUUID());
  } finally { running = false; }
}
