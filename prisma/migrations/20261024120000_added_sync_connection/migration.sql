-- CreateEnum
CREATE TYPE "SyncProvider" AS ENUM ('COINBASE', 'KRAKEN', 'TRADING_212_INVEST', 'TRADING_212_ISA');

-- CreateTable
CREATE TABLE "SyncConnection" (
    "accountName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "credentials" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "provider" "SyncProvider" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SyncConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncConnection_userId_idx" ON "SyncConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncConnection_userId_provider_key" ON "SyncConnection"("userId", "provider");

-- AddForeignKey
ALTER TABLE "SyncConnection" ADD CONSTRAINT "SyncConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
