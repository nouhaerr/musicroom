import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const iosId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
  if (iosId && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(iosId)) {
    throw new Error('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID doit être un ID client OAuth iOS Google valide.');
  }
  return {
    ...config,
    name: config.name ?? 'Sonora',
    slug: config.slug ?? 'music-room-mobile',
    plugins: [
      ...(config.plugins ?? []),
      'expo-dev-client',
      ['expo-build-properties', { ios: { enableSceneSupport: true } }],
      ...(iosId ? [['react-native-nitro-google-signin', {
        iosUrlScheme: `com.googleusercontent.apps.${iosId.replace('.apps.googleusercontent.com', '')}`,
      }] as [string, Record<string, string>]] : []),
      ...(iosId ? ['./plugins/with-google-redirect.cjs'] : []),
    ],
  };
};
