-- CreateEnum
CREATE TYPE "TtsEngine" AS ENUM ('FISH_AUDIO', 'COSYVOICE');

-- AlterTable
ALTER TABLE "Translation" ADD COLUMN "ttsEngine" "TtsEngine" NOT NULL DEFAULT 'FISH_AUDIO';
