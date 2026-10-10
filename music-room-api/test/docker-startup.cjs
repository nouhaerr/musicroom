// Run only in a disposable Linux container, as root, against a disposable DB.
// Never reads a developer's .env. Its test file is created exclusively.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const { chmodSync, readFileSync, statSync, unlinkSync } = require('node:fs');
const { parseEnv } = require('node:util');

async function main() {
  assert.equal(process.env.SONORA_DISPOSABLE_STARTUP_TEST, 'true');
  assert.equal(process.platform, 'linux');
  assert.equal(process.getuid(), 0);
  assert.ok(process.env.TEST_DATABASE_URL, 'A disposable DB is required');
  const cwd = process.cwd();
  const envPath = `${cwd}/.env`;
  // Only this disposable image directory is made writable for the foreign UID.
  chmodSync(cwd, 0o777);
  const asOwner = { uid: 4242, gid: 4242, encoding: 'utf8', stdio: 'pipe' };
  execFileSync(process.execPath, ['scripts/generate-jwt-secrets.cjs', '--init'], asOwner);
  assert.equal(statSync(envPath).uid, 4242);
  assert.equal(statSync(envPath).mode & 0o777, 0o600);
  const initial = readFileSync(envPath, 'utf8');
  assert.throws(() => execFileSync(process.execPath, ['scripts/generate-jwt-secrets.cjs', '--init'], asOwner));
  assert.equal(readFileSync(envPath, 'utf8'), initial);
  execFileSync(process.execPath, ['scripts/generate-jwt-secrets.cjs', '--write'], asOwner);
  const rotated = readFileSync(envPath, 'utf8');
  assert.notEqual(parseEnv(rotated).JWT_ACCESS_SECRET, parseEnv(initial).JWT_ACCESS_SECRET);
  assert.equal(statSync(envPath).mode & 0o777, 0o600);
  // Simulate Compose: host reads .env and passes environment, container UID cannot read file.
  const env = { ...process.env, ...parseEnv(rotated), DATABASE_URL: process.env.TEST_DATABASE_URL,
    CONFIG_IGNORE_ENV_FILE: 'true', GOOGLE_AUTH_ENABLED: 'false', MAIL_TRANSPORT: 'log', PORT: '3099' };
  const asBackend = { uid: 1000, gid: 1000, env, encoding: 'utf8', stdio: 'pipe', timeout: 60000 };
  assert.throws(() => execFileSync(process.execPath, ['-e', "require('fs').readFileSync('.env')"], asBackend));
  // Reproduce the original Nest failure, before testing the corrected startup.
  const original = "require('@nestjs/config').ConfigModule.forRoot().then(()=>process.exit(2), e=>process.exit(e.code==='EACCES'?0:3))";
  execFileSync(process.execPath, ['-e', original], asBackend);
  console.log('Reproduced EACCES: UID 1000 cannot read the 0600 file owned by UID 4242.');
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], asBackend);
  execFileSync(process.execPath, ['-e', "const {PrismaClient}=require('./generated/prisma'); const p=new PrismaClient(); p.$connect().then(()=>p.$disconnect()).catch(()=>process.exit(1));"], asBackend);
  // Nest boot and Swagger with the exact same unreadable .env.
  const app = spawn(process.execPath, ['dist/main.js'], { uid: 1000, gid: 1000, env, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (app.exitCode !== null) throw new Error('Backend exited before readiness');
      try { ready = (await fetch('http://127.0.0.1:3099/docs')).status === 200; } catch { /* booting */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'Swagger must be ready');
    console.log('PASS: init, no overwrite, rotation, Prisma migrations/client, Nest startup and /docs=200.');
  } finally { app.kill('SIGTERM'); }
  // Missing/weak injected secrets must still fail even when file loading is disabled.
  env.JWT_ACCESS_SECRET = randomBytes(4).toString('hex');
  assert.throws(() => execFileSync(process.execPath, ['dist/main.js'], { ...asBackend, env, timeout: 10000 }));
  console.log('PASS: invalid injected JWT secret still prevents startup.');
  // Ensure no relaxed file permissions were needed.
  assert.equal(statSync(envPath).mode & 0o777, 0o600);
  unlinkSync(envPath);
}
main().catch(() => { console.error('Disposable startup regression failed (credentials suppressed).'); process.exitCode = 1; });
