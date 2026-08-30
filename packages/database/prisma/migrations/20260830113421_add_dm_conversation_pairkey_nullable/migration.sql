-- AlterTable
ALTER TABLE "DmConversation" ADD COLUMN     "pairKey" TEXT;

-- Backfill pairKey for any pre-existing rows before the next migration makes
-- it NOT NULL + UNIQUE. COLLATE "C" matters: the application computes
-- pairKey as `[userIdA, userIdB].sort().join(':')`, which sorts by UTF-16
-- code unit — the only Postgres collation guaranteed to agree is "C" (byte
-- order). A locale-aware collation could sort differently and produce a
-- pairKey the application can never look back up.
UPDATE "DmConversation" dc
SET "pairKey" = sub.key
FROM (
  SELECT "dmConversationId" AS id,
         string_agg("userId", ':' ORDER BY "userId" COLLATE "C") AS key
  FROM "DmParticipant"
  GROUP BY "dmConversationId"
) sub
WHERE dc.id = sub.id AND dc."pairKey" IS NULL;
