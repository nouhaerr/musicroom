/** Native modules are loaded on demand so an older build can still open the profile. */
export async function chooseProfilePhoto(): Promise<string | null> {
  try {
    const picker = await import('expo-image-picker');
    const manipulator = await import('expo-image-manipulator');
    const result = await picker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (result.canceled) return null;
    const context = manipulator.ImageManipulator.manipulate(result.assets[0].uri);
    context.resize({ width: 256 });
    const rendered = await context.renderAsync();
    try {
      const image = await rendered.saveAsync({ format: manipulator.SaveFormat.JPEG, compress: 0.65, base64: true });
      if (!image.base64 || image.base64.length > 64_000) throw new Error('Choose a smaller photo and try again.');
      return `data:image/jpeg;base64,${image.base64}`;
    } finally { rendered.release(); context.release(); }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to choose a photo.';
    if (/native module|Cannot find|not found/i.test(message)) throw new Error('Rebuild the Sonora app to enable photo selection.');
    throw new Error(message);
  }
}
