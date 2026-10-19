const platform = process.argv[2];
const keys = ['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', ...(platform === 'ios' ? ['EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'] : [])];
const missing = keys.filter(key => !/^[\w-]+\.apps\.googleusercontent\.com$/.test(process.env[key]?.trim() ?? ''));
if (missing.length) {
  console.error(`Configuration Google incomplète : ${missing.join(', ')}. Voir docs/GOOGLE-NATIVE.md.`);
  process.exitCode = 1;
}
