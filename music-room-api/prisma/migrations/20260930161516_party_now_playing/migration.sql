-- AlterTable
ALTER TABLE "Party" ADD COLUMN     "nowPlayingSongId" TEXT,
ADD COLUMN     "nowPlayingStartedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_nowPlayingSongId_fkey" FOREIGN KEY ("nowPlayingSongId") REFERENCES "Song"("id") ON DELETE SET NULL ON UPDATE CASCADE;
