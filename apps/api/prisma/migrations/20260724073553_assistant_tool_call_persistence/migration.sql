-- AlterEnum
ALTER TYPE "ai_message_role" ADD VALUE 'TOOL_CALL';

-- AlterTable
ALTER TABLE "ai_messages" ADD COLUMN     "tool_name" TEXT;
