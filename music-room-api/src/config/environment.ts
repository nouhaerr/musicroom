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
  return config;
}
