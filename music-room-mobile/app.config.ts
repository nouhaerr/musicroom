import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const iosId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
  if (iosId && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(iosId)) {
    throw new Error('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID doit être un ID client OAuth iOS Google valide.');
  }
  const facebookId = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID?.trim();
  const facebookToken = process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN?.trim();
  if (!!facebookId !== !!facebookToken || (facebookId && !/^\d+$/.test(facebookId))) {
    throw new Error('Configure both Facebook App ID and Client Token before building.');
  }
  return {
    ...config,
    name: config.name ?? 'Sonora',
    slug: config.slug ?? 'music-room-mobile',
    plugins: [
      ...(config.plugins ?? []),
      'expo-dev-client',
      ['expo-image-picker', { photosPermission: 'Choose a public profile photo for Sonora.', cameraPermission: false, microphonePermission: false }],
      ...(facebookId && facebookToken ? [['react-native-fbsdk-next', {
        appID: facebookId, clientToken: facebookToken, displayName: 'Sonora', scheme: `fb${facebookId}`,
        advertiserIDCollectionEnabled: false, autoLogAppEventsEnabled: false, isAutoInitEnabled: false,
      }] as [string, Record<string, unknown>]] : []),
      ['expo-build-properties', { ios: { enableSceneSupport: true } }],
      ...(iosId ? [['react-native-nitro-google-signin', {
        iosUrlScheme: `com.googleusercontent.apps.${iosId.replace('.apps.googleusercontent.com', '')}`,
      }] as [string, Record<string, string>]] : []),
      ...(iosId ? ['./plugins/with-google-redirect.cjs'] : []),
    ],
  };
};
