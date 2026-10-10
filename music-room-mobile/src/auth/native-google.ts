import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { googleConfig, interactiveGoogleToken } from './google-flow';

let running = false;

export async function acquireGoogleIdToken(): Promise<string | null> {
  if (running) throw new Error('Une connexion Google est déjà en cours.');
  if (Constants.executionEnvironment === 'storeClient') {
    throw new Error('Google nécessite la version de développement de Sonora. Dans Expo Go, utilisez la connexion par email.');
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
      throw new Error('Cette version de Sonora ne contient pas encore Google. Installez une nouvelle version de développement.');
    }
    return await interactiveGoogleToken(sdk.GoogleOneTapSignIn, config, Platform.OS);
  } finally { running = false; }
}
