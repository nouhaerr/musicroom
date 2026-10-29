import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from '../generated/prisma';

it('migrates existing preferences without losing the original JSON and preserves accepted invitations', async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required');
  const schema = `musicroom_test_${randomUUID().replace(/-/g, '')}`;
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('schema', schema);
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  const directory = mkdtempSync(join(tmpdir(), 'musicroom-migration-'));
  let created = false;
  try {
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    created = true;
    cpSync('prisma/schema.prisma', join(directory, 'schema.prisma'));
    mkdirSync(join(directory, 'migrations'));
    cpSync('prisma/migrations/20260924122038_creation', join(directory, 'migrations/20260924122038_creation'), { recursive: true });
    cpSync('prisma/migrations/migration_lock.toml', join(directory, 'migrations/migration_lock.toml'));
    const migrate = (path: string) => execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', path], {
      env: { ...process.env, DATABASE_URL: url.href }, stdio: 'pipe', timeout: 60000,
    });
    migrate(join(directory, 'schema.prisma'));
    const users = [randomUUID(), randomUUID(), randomUUID()];
    const legacy = [[' Jazz ', 'ROCK', 'jazz', '', 42], { genres: ['Soul', 'FUNK'], other: 'keep' }, { oldFormat: true }];
    for (let i = 0; i < users.length; i++) {
      await db.$executeRaw`INSERT INTO "User" (id, email, name, "updatedAt", "musicPreferences")
        VALUES (${users[i]}, ${`${users[i]}@EXAMPLE.COM`}, 'Migration user', NOW(), ${JSON.stringify(legacy[i])}::jsonb)`;
    }
    const playlistId = randomUUID();
    const invitationId = randomUUID();
    await db.$executeRaw`INSERT INTO "Playlist" (id, "ownerId", name, "updatedAt") VALUES (${playlistId}, ${users[0]}, 'Existing playlist', NOW())`;
    await db.$executeRaw`INSERT INTO "_PlaylistCollaborators" ("A", "B") VALUES (${playlistId}, ${users[1]})`;
    await db.$executeRaw`INSERT INTO "Invitation" (id, "resourceType", "playlistId", "invitedById", "invitedUserId")
      VALUES (${invitationId}, 'PLAYLIST', ${playlistId}, ${users[0]}, ${users[1]})`;
    for (let i = 0; i < users.length; i++) {
      const handle = [' @Alice_42 ', 'duplicate', 'DUPLICATE'][i];
      await db.$executeRaw`UPDATE "User" SET "publicInfo" = ${JSON.stringify({ username: handle, bio: 'Preserved' })}::jsonb WHERE id = ${users[i]}`;
    }
    const duplicateId = randomUUID();
    await db.$executeRaw`INSERT INTO "User" (id, email, name, "updatedAt", "musicPreferences")
      VALUES (${duplicateId}, ${`${users[0]}@example.com`}, 'Collision fixture', NOW(), '[]'::jsonb)`;
    expect(() => migrate('prisma/schema.prisma')).toThrow();
    // The failing normalization transaction leaves both accounts intact.
    const preserved = await db.user.findMany({ where: { id: { in: [users[0], duplicateId] } } });
    expect(preserved).toHaveLength(2);
    expect(preserved.find(user => user.id === users[0])?.email).toBe(`${users[0]}@EXAMPLE.COM`);
    // Resolve only the disposable test fixture, never production accounts.
    await db.user.delete({ where: { id: duplicateId } });
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'resolve', '--rolled-back', '20261015010000_normalize_email'], {
      env: { ...process.env, DATABASE_URL: url.href }, stdio: 'pipe', timeout: 60000,
    });
    migrate('prisma/schema.prisma');
    expect((await db.user.findUniqueOrThrow({ where: { id: users[0] } })).username).toBe('alice_42');
    for (const id of users.slice(1)) expect((await db.user.findUniqueOrThrow({ where: { id } })).username).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: users[0] } })).publicInfo).toEqual({ username: ' @Alice_42 ', bio: 'Preserved' });

    const expected = [['jazz', 'rock'], ['funk', 'soul'], []];
    for (let i = 0; i < users.length; i++) {
      const user = await db.user.findUniqueOrThrow({ where: { id: users[i] } });
      expect(user.email).toBe(`${users[i]}@example.com`);
      expect(user.musicPreferences.sort()).toEqual(expected[i]);
      const archive = await db.musicPreferencesArchive.findUniqueOrThrow({ where: { userId: users[i] } });
      expect(archive.musicPreferences).toEqual(legacy[i]);
    }
    expect((await db.invitation.findUniqueOrThrow({ where: { id: invitationId } })).status).toBe('ACCEPTED');
  } finally {
    if (created) await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await db.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});
