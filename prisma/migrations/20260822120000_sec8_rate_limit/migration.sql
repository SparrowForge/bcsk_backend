-- CreateTable
CREATE TABLE "RateLimit" (
    "id" SERIAL NOT NULL,
    "bucket" TEXT NOT NULL,
    "windowAt" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateLimit_windowAt_idx" ON "RateLimit"("windowAt");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_bucket_windowAt_key" ON "RateLimit"("bucket", "windowAt");

