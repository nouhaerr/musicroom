// Local browser test only. Never serves .env or stores Google/API tokens.
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
if (!clientId || process.env.NODE_ENV === 'production') {
  console.error('Ce test local nécessite GOOGLE_CLIENT_ID et un environnement de développement.');
  process.exit(1);
}
const apiUrl = process.env.APP_URL || 'http://localhost:3000';
const html = readFileSync(join(__dirname, 'google-login-test.html'));
const server = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['localhost:8085', '127.0.0.1:8085'].includes(req.headers.host) || req.method !== 'GET') {
    res.writeHead(403).end();
  } else if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  } else if (req.url === '/config') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ clientId, apiUrl }));
  } else {
    res.writeHead(404).end();
  }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? 'Le port 8085 est déjà utilisé.' : 'Impossible de démarrer la page de test Google.');
  process.exitCode = 1;
});
server.listen(8085, '127.0.0.1', () => console.log('Test Google : http://localhost:8085 (Ctrl+C pour arrêter)'));
