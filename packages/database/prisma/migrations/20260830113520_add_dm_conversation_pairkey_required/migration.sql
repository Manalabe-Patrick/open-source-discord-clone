-- AlterTable
ALTER TABLE "DmConversation" ALTER COLUMN "pairKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "DmConversation_pairKey_key" ON "DmConversation"("pairKey");
