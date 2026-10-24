const secretNames = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;

const numberSettings = [
  // How many songs a party queue or a playlist may hold: also how many one realtime snapshot carries, so that
  // everyone always sees the whole list. Above 1000, each message gets too heavy.
  { name: 'MAX_PARTY_SONGS', fallback: 100, max: 1000 },
  { name: 'MAX_PLAYLIST_SONGS', fallback: 100, max: 1000 },
  // How many requests one IP may send to one route per minute, on the routes without a stricter limit of their own
  { name: 'THROTTLE_LIMIT', fallback: 60, max: 1_000_000 },
];

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
  // The whole-number settings: absent or empty means their default, anything else must be from 1 to their max
  for (const { name, fallback, max } of numberSettings) {
    const value = config[name] === undefined || config[name] === '' ? String(fallback) : config[name];
    if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) {
      throw new Error(`${name} must be a whole number from 1 to ${max}`);
    }
    config[name] = Number(value);
  }
  return config;
}
