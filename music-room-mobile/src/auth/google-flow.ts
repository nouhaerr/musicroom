export interface GoogleConfig { webClientId: string; iosClientId?: string; offlineAccess: false; autoSelectOnSignIn: false }
export interface GoogleDriver {
  configure(config: GoogleConfig): void;
  checkPlayServices(): Promise<void>;
  signOut(): Promise<void>;
  presentExplicitSignIn(): Promise<{ type: string; data: { idToken?: string | null } | null }>;
}

export function googleConfig(platform: string, webClientId?: string, iosClientId?: string): GoogleConfig {
  const valid = (value?: string) => !!value && /^[\w-]+\.apps\.googleusercontent\.com$/.test(value);
  if (platform !== 'ios' && platform !== 'android') throw new Error('Google sign-in is available on Android and iOS.');
  if (!valid(webClientId) || (platform === 'ios' && !valid(iosClientId))) {
    throw new Error('Google sign-in is not configured for this app yet. Email login is still available.');
  }
  return { webClientId: webClientId!, ...(platform === 'ios' ? { iosClientId } : {}), offlineAccess: false, autoSelectOnSignIn: false };
}

/** Always show the account chooser, including linking; never silently choose an identity. */
export async function interactiveGoogleToken(driver: GoogleDriver, config: GoogleConfig, platform: string): Promise<string | null> {
  try {
    driver.configure(config);
    if (platform === 'android') await driver.checkPlayServices();
    await driver.signOut();
    const response = await driver.presentExplicitSignIn();
    if (response.type === 'cancelled') return null;
    if (response.type !== 'success' || !response.data?.idToken) {
      throw new Error('Missing Google identity');
    }
    // Google validates the identity, then Sonora verifies this token on its backend.
    return response.data.idToken;
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === 'SIGN_IN_CANCELLED') return null;
    if (code === 'PLAY_SERVICES_NOT_AVAILABLE') throw new Error('Update Google Play services, then try again.');
    if (code === 'DEVELOPER_ERROR') throw new Error('Google configuration for this version of Sonora needs to be corrected.');
    // Native error messages may contain credential details: do not render or log them.
    throw new Error('Unable to sign in with Google. Try again or log in with your email.');
  } finally {
    // Sonora uses its own refresh tokens. No Google offline access is requested.
    await driver.signOut().catch(() => undefined);
  }
}
