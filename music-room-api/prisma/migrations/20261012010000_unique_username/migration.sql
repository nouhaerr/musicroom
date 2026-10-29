ALTER TABLE "User" ADD COLUMN "username" TEXT;
-- Claim only unambiguous valid legacy display handles; keep legacy JSON untouched.
WITH candidates AS (
  SELECT id, lower(trim(leading '@' from btrim("publicInfo"->>'username'))) AS handle
  FROM "User" WHERE jsonb_typeof("publicInfo"->'username') = 'string'
), unique_handles AS (
  SELECT handle FROM candidates WHERE handle ~ '^[a-z0-9_]{3,30}$'
  GROUP BY handle HAVING count(*) = 1
)
UPDATE "User" u SET username = c.handle FROM candidates c
JOIN unique_handles h ON h.handle = c.handle WHERE u.id = c.id;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
ALTER TABLE "User" ADD CONSTRAINT "User_username_format" CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,30}$');
