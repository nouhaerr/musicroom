import { Prisma } from '../../generated/prisma';

// All mutations for the same users take these locks in a stable order.
// READ COMMITTED then sees the result of any preceding mutation.
export async function lockUsers(tx: Prisma.TransactionClient, ids: string[]) {
  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM "User" WHERE id IN (${Prisma.join([...new Set(ids)].sort())})
    ORDER BY id FOR UPDATE
  `);
}
