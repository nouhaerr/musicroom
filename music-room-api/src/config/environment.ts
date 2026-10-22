const secretNames = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;

/** Validate before Nest instantiates providers. Never include secret values in errors. */
export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  for (const name of secretNames) {
    const value = config[name];
    if (typeof value !== 'string' || !value) {
      throw new Error(`${name} est requis`);
    }
    if (Buffer.byteLength(value, 'utf8') < 32 || /\s/.test(value) ||
        /change[ _-]?me|replace[ _-]?me|dev_(access|refresh)_secret/i.test(value) ||
        /^(.)\1+$/u.test(value)) {
      throw new Error(`${name} doit être un secret aléatoire d’au moins 32 octets, sans espaces ni valeur d’exemple`);
    }
  }
  if (config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET) {
    throw new Error('JWT_ACCESS_SECRET et JWT_REFRESH_SECRET doivent être différents');
  }
  // How many songs a party queue or a playlist may hold: also how many one realtime snapshot carries, so that
  // everyone always sees the whole list. Absent or empty means 100; above 1000, each message gets too heavy.
  for (const name of ['MAX_PARTY_SONGS', 'MAX_PLAYLIST_SONGS']) {
    const value = config[name] === undefined || config[name] === '' ? '100' : config[name];
    if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 1000) {
      throw new Error(`${name} must be a whole number from 1 to 1000`);
    }
    config[name] = Number(value);
  }
  return config;
}
