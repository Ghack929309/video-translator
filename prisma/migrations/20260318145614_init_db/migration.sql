-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('UPLOAD', 'YOUTUBE', 'INSTAGRAM', 'FACEBOOK', 'VIMEO');

-- CreateEnum
CREATE TYPE "TranslationStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PipelineStep" AS ENUM ('DOWNLOAD', 'EXTRACT_AUDIO', 'TRANSCRIBE', 'TRANSLATE', 'CLONE_VOICE', 'SYNTHESIZE', 'MERGE');

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "sourceUrl" TEXT,
    "storageKey" TEXT NOT NULL,
    "durationSec" INTEGER,
    "mimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Translation" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "targetLanguage" TEXT NOT NULL,
    "status" "TranslationStatus" NOT NULL DEFAULT 'PENDING',
    "currentStep" "PipelineStep",
    "progress" INTEGER NOT NULL DEFAULT 0,
    "extractedAudioKey" TEXT,
    "transcriptJson" JSONB,
    "translatedJson" JSONB,
    "synthesizedAudioKey" TEXT,
    "resultVideoKey" TEXT,
    "fishAudioVoiceId" TEXT,
    "errorMessage" TEXT,
    "errorStep" "PipelineStep",
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Translation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Profile_email_key" ON "Profile"("email");

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Translation" ADD CONSTRAINT "Translation_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
