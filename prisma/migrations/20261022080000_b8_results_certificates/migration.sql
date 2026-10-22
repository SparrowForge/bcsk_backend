-- LMS results and certificates completion: withholding one student's result, and certificate
-- provenance (exam, issuer) plus revocation. Additive only: new nullable columns, one boolean with
-- a default, one index. Diffed offline between two schema files (no shadow database).

-- AlterTable
ALTER TABLE "ResultSummary" ADD COLUMN     "withheld" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "withheldAt" TIMESTAMP(3),
ADD COLUMN     "withheldById" INTEGER,
ADD COLUMN     "withheldReason" TEXT;

-- AlterTable
ALTER TABLE "Certificate" ADD COLUMN     "examId" INTEGER,
ADD COLUMN     "issuedById" INTEGER,
ADD COLUMN     "revokeReason" TEXT,
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "revokedById" INTEGER;

-- CreateIndex
CREATE INDEX "Certificate_examId_idx" ON "Certificate"("examId");

-- Mark sheets already issued carry their exam in the serial (BCSK-MS-<examId>-...).
UPDATE "Certificate" SET "examId" = split_part("serial", '-', 3)::INTEGER
WHERE "type" = 'MARK_SHEET' AND "serial" ~ '^BCSK-MS-[0-9]+-' AND "examId" IS NULL;
