import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { parseEnv } from 'node:util';
import { validateEnvironment } from './environment';

const valid = () => ({ JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex') });

describe('JWT environment validation', () => {
  it.each(['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'])('rejects missing and weak %s without revealing its value', name => {
    for (const value of [undefined, '', 123, 'short-secret', 'x'.repeat(64), 'change_me_' + 'a'.repeat(40), 'replace-me-' + 'b'.repeat(40), 'secret-with-spaces '.repeat(4)]) {
      const config = { ...valid(), [name]: value };
      expect(() => validateEnvironment(config)).toThrow(name);
      if (typeof value === 'string' && value) {
        try { validateEnvironment(config); } catch (error) { expect((error as Error).message).not.toContain(value); }
      }
    }
  });

  it('rejects identical secrets', () => {
    const secret = randomBytes(32).toString('hex');
    expect(() => validateEnvironment({ JWT_ACCESS_SECRET: secret, JWT_REFRESH_SECRET: secret })).toThrow('différents');
  });

  it('preserves valid secrets and unrelated configuration', () => {
    const config = { ...valid(), PORT: '3000' };
    expect(validateEnvironment(config)).toBe(config);
  });

  it.each(['development', 'test', 'production'])('fails during ConfigModule initialization in %s', async NODE_ENV => {
    // Disable env-file/process loading: no test can consume a developer’s secrets.
    await expect(ConfigModule.forRoot({
      ignoreEnvFile: true, ignoreEnvVars: true,
      validate: () => validateEnvironment({ NODE_ENV }),
    })).rejects.toThrow('JWT_ACCESS_SECRET');
  });

  it('makes validated secrets available through ConfigService', async () => {
    const config = valid();
    const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({
      ignoreEnvFile: true, ignoreEnvVars: true,
      validate: () => validateEnvironment(config),
    })] }).compile();
    try {
      expect(module.get(ConfigService).getOrThrow('JWT_ACCESS_SECRET')).toBe(config.JWT_ACCESS_SECRET);
    } finally { await module.close(); }
  });
});

describe('JWT secret generation command', () => {
  const script = resolve('scripts/generate-jwt-secrets.cjs');
  let directory: string;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'sonora-secrets-test-')); });
  afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

  it.each(['\n', '\r\n'])('replaces only JWT assignments, preserving line endings (%j) without printing values', newline => {
    const source = ['# preserve comment', 'MAIL_PASSWORD="smtp-test-value"', 'JWT_ACCESS_SECRET=old', 'JWT_REFRESH_SECRET=old2', 'GOOGLE_AUTH_ENABLED=false', ''].join(newline);
    writeFileSync(join(directory, '.env'), source);
    const output = execFileSync(process.execPath, [script, '--write'], { cwd: directory, encoding: 'utf8' });
    const updated = readFileSync(join(directory, '.env'), 'utf8');
    const config = parseEnv(updated);
    expect(() => validateEnvironment(config)).not.toThrow();
    expect(updated.replace(/JWT_ACCESS_SECRET=[^\r\n]*/, 'JWT_ACCESS_SECRET=old').replace(/JWT_REFRESH_SECRET=[^\r\n]*/, 'JWT_REFRESH_SECRET=old2')).toBe(source);
    expect(output).not.toContain(config.JWT_ACCESS_SECRET);
    expect(output).not.toContain(config.JWT_REFRESH_SECRET);
    expect(output).not.toContain('smtp-test-value');
  });

  it('creates a valid .env from the example and refuses to overwrite an existing one', () => {
    writeFileSync(join(directory, '.env.example'), 'JWT_ACCESS_SECRET=\nJWT_REFRESH_SECRET=\n');
    execFileSync(process.execPath, [script, '--init'], { cwd: directory });
    const before = readFileSync(join(directory, '.env'), 'utf8');
    expect(() => validateEnvironment(parseEnv(before))).not.toThrow();
    expect(() => execFileSync(process.execPath, [script, '--init'], { cwd: directory, stdio: 'pipe' })).toThrow();
    expect(readFileSync(join(directory, '.env'), 'utf8')).toBe(before);
  });

  it('refuses ambiguous duplicate assignments without changing the file', () => {
    const source = 'JWT_ACCESS_SECRET=one\nJWT_ACCESS_SECRET=two\nJWT_REFRESH_SECRET=three\n';
    writeFileSync(join(directory, '.env'), source);
    expect(() => execFileSync(process.execPath, [script, '--write'], { cwd: directory, stdio: 'pipe' })).toThrow();
    expect(readFileSync(join(directory, '.env'), 'utf8')).toBe(source);
  });
});
