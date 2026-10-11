import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { googleConfig, interactiveGoogleToken } from './google-flow';

let running = false;

export async function acquireGoogleIdToken(): Promise<string | null> {
  if (running) throw new Error('Google sign-in is already in progress.');
  if (Constants.executionEnvironment === 'storeClient') {
    throw new Error('Google requires a Sonora development build. In Expo Go, use email login.');
  }
  const config = googleConfig(Platform.OS,
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim(),
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim());
  running = true;
  try {
    let sdk: typeof import('react-native-nitro-google-signin');
    try {
      // Lazy import preserves email login in Expo Go and builds without the native module.
      sdk = await import('react-native-nitro-google-signin');
    } catch {
      throw new Error('This version of Sonora does not include Google yet. Install a new development build.');
    }
    return await interactiveGoogleToken(sdk.GoogleOneTapSignIn, config, Platform.OS);
  } finally { running = false; }
}
