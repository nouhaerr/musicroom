export type FacebookCredential = { accessToken: string; nonce?: string };
export interface FacebookDriver {
  logOut(): void;
  login(limited: boolean, nonce: string): Promise<{ isCancelled: boolean }>;
  token(limited: boolean): Promise<string | null>;
}

export async function interactiveFacebookToken(driver: FacebookDriver, platform: string, nonce: string): Promise<FacebookCredential | null> {
  const limited = platform === 'ios';
  try {
    driver.logOut();
    const result = await driver.login(limited, nonce);
    if (result.isCancelled) return null;
    const accessToken = await driver.token(limited);
    if (!accessToken) throw new Error();
    return { accessToken, ...(limited ? { nonce } : {}) };
  } catch {
    throw new Error('Unable to sign in with Facebook. Try again or use your email.');
  } finally { try { driver.logOut(); } catch { /* Never expose native errors or mask cancellation. */ } }
}
