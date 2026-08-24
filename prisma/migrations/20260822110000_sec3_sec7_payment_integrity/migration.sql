-- AlterTable
ALTER TABLE "ApplicationForm" ADD COLUMN     "isBcskStudent" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_gatewayTxnId_key" ON "Payment"("gatewayTxnId");

