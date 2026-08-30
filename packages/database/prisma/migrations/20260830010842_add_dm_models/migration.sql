-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "dmConversationId" TEXT,
ALTER COLUMN "channelId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "DmConversation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmParticipant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dmConversationId" TEXT NOT NULL,

    CONSTRAINT "DmParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DmParticipant_userId_dmConversationId_key" ON "DmParticipant"("userId", "dmConversationId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_dmConversationId_fkey" FOREIGN KEY ("dmConversationId") REFERENCES "DmConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmParticipant" ADD CONSTRAINT "DmParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmParticipant" ADD CONSTRAINT "DmParticipant_dmConversationId_fkey" FOREIGN KEY ("dmConversationId") REFERENCES "DmConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
