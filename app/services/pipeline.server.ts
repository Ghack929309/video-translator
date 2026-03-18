import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { db } from "~/services/db.server";
import { tigris } from "~/services/tigris.server";
import { ytdlp } from "~/services/ytdlp.server";
import { ffmpeg } from "~/services/ffmpeg.server";
import { assemblyai } from "~/services/assemblyai.server";
import { openaiService } from "~/services/openai.server";

type PipelineStep =
  | "DOWNLOAD"
  | "EXTRACT_AUDIO"
  | "TRANSCRIBE"
  | "TRANSLATE"
  | "CLONE_VOICE"
  | "SYNTHESIZE"
  | "MERGE";

const STEP_PROGRESS: Record<PipelineStep, number> = {
  DOWNLOAD: 10,
  EXTRACT_AUDIO: 20,
  TRANSCRIBE: 40,
  TRANSLATE: 55,
  CLONE_VOICE: 65,
  SYNTHESIZE: 80,
  MERGE: 95,
};

/**
 * Update translation status in DB.
 */
async function updateTranslation(
  translationId: string,
  data: Record<string, unknown>,
) {
  return db.translation.update({
    where: { id: translationId },
    data,
  });
}

/**
 * Pipeline orchestrator — runs translation steps sequentially.
 * Each step is idempotent: it checks for existing output before executing.
 * Phase 4 implements DOWNLOAD and EXTRACT_AUDIO only.
 * Remaining steps (TRANSCRIBE → MERGE) are stubs for Phase 5+.
 */
export const pipeline = {
  async run(translationId: string) {
    const translation = await db.translation.findUniqueOrThrow({
      where: { id: translationId },
      include: { video: true },
    });

    await updateTranslation(translationId, {
      status: "PROCESSING",
      startedAt: new Date(),
      errorMessage: null,
      errorStep: null,
    });

    try {
      // Step 1 — DOWNLOAD
      await this.stepDownload(translationId, translation.video);

      // Step 2 — EXTRACT_AUDIO
      await this.stepExtractAudio(translationId);

      // Step 3 — TRANSCRIBE
      await this.stepTranscribe(translationId);

      // Step 4 — TRANSLATE
      await this.stepTranslate(translationId);

      // Steps 5–7 are stubs for Phase 6
      // Step 5 — CLONE_VOICE
      // Step 6 — SYNTHESIZE
      // Step 7 — MERGE

      // For now, mark as completed after TRANSLATE
      await updateTranslation(translationId, {
        status: "COMPLETED",
        progress: 100,
        completedAt: new Date(),
      });

      console.log(
        `[pipeline] Translation ${translationId} completed (Phase 5: transcribe + translate)`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[pipeline] Translation ${translationId} failed:`, message);

      const current = await db.translation.findUnique({
        where: { id: translationId },
        select: { currentStep: true },
      });

      await updateTranslation(translationId, {
        status: "FAILED",
        errorMessage: message,
        errorStep: current?.currentStep ?? null,
      });
    } finally {
      ffmpeg.cleanup(translationId);
    }
  },

  /**
   * Step 1 — DOWNLOAD
   * For UPLOAD source type: video is already in Tigris, skip.
   * For URL sources: use yt-dlp to download, then upload to Tigris.
   */
  async stepDownload(
    translationId: string,
    video: {
      id: string;
      sourceType: string;
      sourceUrl: string | null;
      storageKey: string;
    },
  ) {
    // Skip if storageKey already exists (user uploaded directly)
    if (video.storageKey && video.sourceType === "UPLOAD") {
      console.log(`[pipeline] Step DOWNLOAD skipped — file already uploaded`);
      await updateTranslation(translationId, {
        currentStep: "DOWNLOAD",
        progress: STEP_PROGRESS.DOWNLOAD,
      });
      return;
    }

    await updateTranslation(translationId, {
      currentStep: "DOWNLOAD",
      progress: 5,
    });

    if (!video.sourceUrl) {
      throw new Error("No source URL provided for download");
    }

    console.log(
      `[pipeline] Step DOWNLOAD — downloading from ${video.sourceUrl}`,
    );
    const { filePath, mimeType } = await ytdlp.download(
      video.sourceUrl,
      video.id,
    );

    // Upload downloaded file to Tigris
    const storageKey = `videos/${video.id}/source.mp4`;
    const fileBuffer = fs.readFileSync(filePath);
    await tigris.upload(storageKey, fileBuffer, mimeType);

    // Update video record with storage key
    await db.video.update({
      where: { id: video.id },
      data: {
        storageKey,
        mimeType,
        fileSizeBytes: fileBuffer.length,
      },
    });

    // Clean up downloaded file
    fs.unlinkSync(filePath);

    await updateTranslation(translationId, {
      progress: STEP_PROGRESS.DOWNLOAD,
    });

    console.log(`[pipeline] Step DOWNLOAD complete — stored at ${storageKey}`);
  },

  /**
   * Step 2 — EXTRACT_AUDIO
   * Download source video from Tigris, extract audio as WAV, upload WAV to Tigris.
   */
  async stepExtractAudio(translationId: string) {
    const translation = await db.translation.findUniqueOrThrow({
      where: { id: translationId },
      include: { video: true },
    });

    // Skip if already extracted
    if (translation.extractedAudioKey) {
      console.log(
        `[pipeline] Step EXTRACT_AUDIO skipped — audio already extracted`,
      );
      await updateTranslation(translationId, {
        currentStep: "EXTRACT_AUDIO",
        progress: STEP_PROGRESS.EXTRACT_AUDIO,
      });
      return;
    }

    await updateTranslation(translationId, {
      currentStep: "EXTRACT_AUDIO",
      progress: 15,
    });

    console.log(
      `[pipeline] Step EXTRACT_AUDIO — extracting from ${translation.video.storageKey}`,
    );

    // Download source video from Tigris to /tmp
    const tmpDir = path.join(os.tmpdir(), "dubly", translationId);
    fs.mkdirSync(tmpDir, { recursive: true });
    const videoPath = path.join(tmpDir, "source.mp4");

    const videoStream = await tigris.download(translation.video.storageKey);
    if (!videoStream) {
      throw new Error("Failed to download source video from storage");
    }

    // Write stream to file
    const writeStream = fs.createWriteStream(videoPath);
    // @ts-expect-error — S3 Body is a readable stream
    for await (const chunk of videoStream) {
      writeStream.write(chunk);
    }
    writeStream.end();
    await new Promise<void>((resolve) => writeStream.on("finish", resolve));

    // Extract audio
    const audioPath = await ffmpeg.extractAudio(videoPath, translationId);

    // Get video duration while we have it
    const durationSec = await ffmpeg.getDuration(videoPath);

    // Upload extracted audio to Tigris
    const audioKey = `translations/${translationId}/source-audio.wav`;
    const audioBuffer = fs.readFileSync(audioPath);
    await tigris.upload(audioKey, audioBuffer, "audio/wav");

    // Update records
    await updateTranslation(translationId, {
      extractedAudioKey: audioKey,
      progress: STEP_PROGRESS.EXTRACT_AUDIO,
    });

    if (durationSec > 0) {
      await db.video.update({
        where: { id: translation.video.id },
        data: { durationSec: Math.round(durationSec) },
      });
    }

    console.log(
      `[pipeline] Step EXTRACT_AUDIO complete — stored at ${audioKey}`,
    );
  },

  /**
   * Step 3 — TRANSCRIBE
   * Get a presigned URL for the extracted audio, send to AssemblyAI,
   * store the transcript JSON on the translation record.
   */
  async stepTranscribe(translationId: string) {
    const translation = await db.translation.findUniqueOrThrow({
      where: { id: translationId },
    });

    // Skip if already transcribed
    if (translation.transcriptJson) {
      console.log(
        `[pipeline] Step TRANSCRIBE skipped — transcript already exists`,
      );
      await updateTranslation(translationId, {
        currentStep: "TRANSCRIBE",
        progress: STEP_PROGRESS.TRANSCRIBE,
      });
      return;
    }

    if (!translation.extractedAudioKey) {
      throw new Error(
        "No extracted audio key — EXTRACT_AUDIO step may have been skipped",
      );
    }

    await updateTranslation(translationId, {
      currentStep: "TRANSCRIBE",
      progress: 25,
    });

    console.log(`[pipeline] Step TRANSCRIBE — sending audio to AssemblyAI`);

    // Generate a presigned download URL for AssemblyAI to fetch the audio
    const audioUrl = await tigris.presignedDownloadUrl(
      translation.extractedAudioKey,
      3600,
    );

    const transcript = await assemblyai.transcribe(audioUrl);

    await updateTranslation(translationId, {
      transcriptJson: transcript as unknown as Record<string, unknown>,
      progress: STEP_PROGRESS.TRANSCRIBE,
    });

    console.log(
      `[pipeline] Step TRANSCRIBE complete — ${transcript.segments.length} segments, ` +
        `${transcript.words.length} words`,
    );
  },

  /**
   * Step 4 — TRANSLATE
   * Read the transcript from the DB, translate all segments via OpenAI,
   * store the translated JSON on the translation record.
   */
  async stepTranslate(translationId: string) {
    const translation = await db.translation.findUniqueOrThrow({
      where: { id: translationId },
    });

    // Skip if already translated
    if (translation.translatedJson) {
      console.log(
        `[pipeline] Step TRANSLATE skipped — translation already exists`,
      );
      await updateTranslation(translationId, {
        currentStep: "TRANSLATE",
        progress: STEP_PROGRESS.TRANSLATE,
      });
      return;
    }

    if (!translation.transcriptJson) {
      throw new Error(
        "No transcript JSON — TRANSCRIBE step may have been skipped",
      );
    }

    await updateTranslation(translationId, {
      currentStep: "TRANSLATE",
      progress: 45,
    });

    console.log(
      `[pipeline] Step TRANSLATE — translating to ${translation.targetLanguage}`,
    );

    const transcript = translation.transcriptJson as unknown as {
      segments: {
        text: string;
        start: number;
        end: number;
        words: {
          text: string;
          start: number;
          end: number;
          confidence: number;
        }[];
      }[];
      languageCode: string | null;
    };

    const translated = await openaiService.translateSegments(
      transcript.segments,
      translation.targetLanguage,
      transcript.languageCode,
    );

    await updateTranslation(translationId, {
      translatedJson: translated as unknown as Record<string, unknown>[],
      progress: STEP_PROGRESS.TRANSLATE,
    });

    console.log(
      `[pipeline] Step TRANSLATE complete — ${translated.length} segments translated`,
    );
  },
};
