ALTER TABLE "Device" ADD COLUMN "installationId" TEXT;
CREATE UNIQUE INDEX "Device_userId_installationId_key" ON "Device"("userId", "installationId");
