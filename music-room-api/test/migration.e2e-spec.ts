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
        VALUES (${users[i]}, ${`${users[i]}@example.com`}, 'Migration user', NOW(), ${JSON.stringify(legacy[i])}::jsonb)`;
    }
    const playlistId = randomUUID();
    const invitationId = randomUUID();
    await db.$executeRaw`INSERT INTO "Playlist" (id, "ownerId", name, "updatedAt") VALUES (${playlistId}, ${users[0]}, 'Existing playlist', NOW())`;
    await db.$executeRaw`INSERT INTO "_PlaylistCollaborators" ("A", "B") VALUES (${playlistId}, ${users[1]})`;
    await db.$executeRaw`INSERT INTO "Invitation" (id, "resourceType", "playlistId", "invitedById", "invitedUserId")
      VALUES (${invitationId}, 'PLAYLIST', ${playlistId}, ${users[0]}, ${users[1]})`;
    migrate('prisma/schema.prisma');
    const expected = [['jazz', 'rock'], ['funk', 'soul'], []];
    for (let i = 0; i < users.length; i++) {
      const user = await db.user.findUniqueOrThrow({ where: { id: users[i] } });
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
