const { randomBytes } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');

// --init creates .env exclusively. --write rotates only the two JWT secrets.
// Values are never printed and regular application startup never rotates keys.
const mode = process.argv[2];
if (process.argv.length !== 3 || !['--init', '--write'].includes(mode)) {
  console.error('Usage: node scripts/generate-jwt-secrets.cjs --init | --write');
  process.exitCode = 1;
} else {
  try {
    let content = readFileSync(mode === '--init' ? '.env.example' : '.env', 'utf8');
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
      const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=[^\\r\\n]*`, 'gm');
      const matches = content.match(pattern) ?? [];
      if (matches.length > 1) throw new Error('Duplicate JWT setting');
      const assignment = `${name}=${randomBytes(32).toString('hex')}`;
      content = matches.length
        ? content.replace(pattern, assignment)
        : `${content}${content.endsWith('\n') ? '' : newline}${assignment}${newline}`;
    }
    writeFileSync('.env', content, { encoding: 'utf8', mode: 0o600, flag: mode === '--init' ? 'wx' : 'w' });
    console.log('Deux secrets JWT aléatoires enregistrés dans .env. Aucune valeur affichée.');
    if (mode === '--write') console.log('Recréer le backend : les anciens tokens et liens d’authentification seront invalides.');
  } catch {
    // Do not include input contents or raw filesystem errors in diagnostics.
    console.error('Échec : vérifier la présence du fichier source, les permissions et les doublons JWT. --init exige un .env inexistant.');
    process.exitCode = 1;
  }
}
