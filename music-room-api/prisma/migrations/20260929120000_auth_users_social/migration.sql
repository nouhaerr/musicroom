-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED');

-- AlterTable
-- Preserve the original JSON in an archive table before converting genres.
CREATE TABLE "_MusicPreferencesArchive" AS
SELECT "id" AS "userId", "musicPreferences" FROM "User"
WHERE "musicPreferences" IS NOT NULL;
ALTER TABLE "_MusicPreferencesArchive" ALTER COLUMN "userId" SET NOT NULL,
ALTER COLUMN "musicPreferences" SET NOT NULL,
ADD CONSTRAINT "_MusicPreferencesArchive_pkey" PRIMARY KEY ("userId");
ALTER TABLE "User" ADD COLUMN "musicGenres" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "User" u SET "musicGenres" = ARRAY(
  SELECT DISTINCT lower(trim(value #>> '{}'))
  FROM jsonb_array_elements(CASE
    WHEN jsonb_typeof(u."musicPreferences") = 'array' THEN u."musicPreferences"
    WHEN jsonb_typeof(u."musicPreferences"->'genres') = 'array' THEN u."musicPreferences"->'genres'
    ELSE '[]'::jsonb END) AS value
  WHERE jsonb_typeof(value) = 'string' AND length(trim(value #>> '{}')) BETWEEN 1 AND 50
);
ALTER TABLE "User" DROP COLUMN "musicPreferences";
ALTER TABLE "User" RENAME COLUMN "musicGenres" TO "musicPreferences";
CREATE INDEX "User_musicPreferences_idx" ON "User" USING GIN ("musicPreferences");

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthSession_userId_revokedAt_idx" ON "AuthSession"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_sessionId_idx" ON "RefreshToken"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AuthSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing collaborators had already been granted access by the old API.
UPDATE "Invitation" i SET status = 'ACCEPTED'
WHERE (i."playlistId" IS NOT NULL AND EXISTS (
  SELECT 1 FROM "_PlaylistCollaborators" c WHERE c."A" = i."playlistId" AND c."B" = i."invitedUserId"
)) OR (i."partyId" IS NOT NULL AND EXISTS (
  SELECT 1 FROM "_PartyMembers" m WHERE m."A" = i."partyId" AND m."B" = i."invitedUserId"
));
