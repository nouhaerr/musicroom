export interface GoogleConfig { webClientId: string; iosClientId?: string; offlineAccess: false; autoSelectOnSignIn: false }
export interface GoogleDriver {
  configure(config: GoogleConfig): void;
  checkPlayServices(): Promise<void>;
  signOut(): Promise<void>;
  presentExplicitSignIn(): Promise<{ type: string; data: { idToken?: string | null } | null }>;
}

export function googleConfig(platform: string, webClientId?: string, iosClientId?: string): GoogleConfig {
  const valid = (value?: string) => !!value && /^[\w-]+\.apps\.googleusercontent\.com$/.test(value);
  if (platform !== 'ios' && platform !== 'android') throw new Error('La connexion Google est disponible sur Android et iOS.');
  if (!valid(webClientId) || (platform === 'ios' && !valid(iosClientId))) {
    throw new Error('La connexion Google n’est pas encore configurée pour cette application. La connexion par email reste disponible.');
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
    if (code === 'PLAY_SERVICES_NOT_AVAILABLE') throw new Error('Mettez à jour les services Google Play, puis réessayez.');
    if (code === 'DEVELOPER_ERROR') throw new Error('La configuration Google de cette version de Sonora doit être corrigée.');
    // Native error messages may contain credential details: do not render or log them.
    throw new Error('Connexion à Google impossible. Réessayez ou connectez-vous avec votre email.');
  } finally {
    // Sonora uses its own refresh tokens. No Google offline access is requested.
    await driver.signOut().catch(() => undefined);
  }
}
