export interface EmailLauncher {
  openURL: (url: string) => Promise<unknown>;
  openAndroidInbox: () => Promise<unknown>;
}

/** Android opens the inbox chooser, not a new-message composer. */
export async function openEmailInbox(platform: string, launcher: EmailLauncher): Promise<void> {
  if (platform === 'android') {
    await launcher.openAndroidInbox();
    return;
  }
  try {
    await launcher.openURL('googlegmail://');
  } catch {
    await launcher.openURL('message://');
  }
}
