-- CreateTable
CREATE TABLE "UserMenuPermission" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "menuKey" TEXT NOT NULL,
    "canAccess" BOOLEAN NOT NULL DEFAULT false,
    "canInsert" BOOLEAN NOT NULL DEFAULT false,
    "canUpdate" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMenuPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserMenuPermission_userId_menuKey_key" ON "UserMenuPermission"("userId", "menuKey");

-- AddForeignKey
ALTER TABLE "UserMenuPermission" ADD CONSTRAINT "UserMenuPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

