-- AlterTable
ALTER TABLE "ApplicationForm" ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "couponId" INTEGER,
ADD COLUMN     "couponType" TEXT,
ADD COLUMN     "couponValue" INTEGER;

-- CreateTable
CREATE TABLE "Coupon" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "discountType" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "appliesTo" TEXT NOT NULL DEFAULT 'ALL',
    "maxUses" INTEGER,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- AddForeignKey
ALTER TABLE "ApplicationForm" ADD CONSTRAINT "ApplicationForm_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

