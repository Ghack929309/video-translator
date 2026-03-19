import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { db } from "~/services/db.server";
import { tigris } from "~/services/tigris.server";
import { ytdlp } from "~/services/ytdlp.server";
import { ffmpeg } from "~/services/ffmpeg.server";
import { assemblyai } from "~/services/assemblyai.server";
import { openaiService } from "~/services/openai.server";
import { fishAudio } from "~/services/fish-audio.server";

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

const MAX_STEP_RETRIES = 3;
const JOB_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const ORDERED_STEPS: PipelineStep[] = [
  "DOWNLOAD",
  "EXTRACT_AUDIO",
  "TRANSCRIBE",
  "TRANSLATE",
  "CLONE_VOICE",
  "SYNTHESIZE",
  "MERGE",
];

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
 * Retry a step function with exponential backoff.
 */
async function withRetry(
  stepName: string,
  fn: () => Promise<void>,
  maxRetries = MAX_STEP_RETRIES,
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 15000);
      console.warn(
        `[pipeline] Step ${stepName} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * Pipeline orchestrator — runs translation steps sequentially.
 * Each step is idempotent and wrapped in retry logic with exponential backoff.
 * Supports resuming from the last failed step on retry.
 */
export const pipeline = {
  async run(translationId: string) {
    const translation = await db.translation.findUniqueOrThrow({
      where: { id: translationId },
      include: { video: true },
    });

    const jobStart = Date.now();

    // Determine resume point: if retrying a failed job, skip already-completed steps
    let startIndex = 0;
    if (translation.status === "FAILED" && translation.errorStep) {
      const failedIdx = ORDERED_STEPS.indexOf(
        translation.errorStep as PipelineStep,
      );
      if (failedIdx > 0) {
        startIndex = failedIdx;
        console.log(
          `[pipeline] Resuming translation ${translationId} from step ${ORDERED_STEPS[startIndex]}`,
        );
      }
    }

    await updateTranslation(translationId, {
      status: "PROCESSING",
      startedAt: translation.startedAt ?? new Date(),
      errorMessage: null,
      errorStep: null,
      retryCount: { increment: translation.status === "FAILED" ? 1 : 0 },
    });

    try {
      const stepFns: Array<{ name: PipelineStep; fn: () => Promise<void> }> = [
        {
          name: "DOWNLOAD",
          fn: () => this.stepDownload(translationId, translation.video),
        },
        {
          name: "EXTRACT_AUDIO",
          fn: () => this.stepExtractAudio(translationId),
        },
        { name: "TRANSCRIBE", fn: () => this.stepTranscribe(translationId) },
        { name: "TRANSLATE", fn: () => this.stepTranslate(translationId) },
        { name: "CLONE_VOICE", fn: () => this.stepCloneVoice(translationId) },
        { name: "SYNTHESIZE", fn: () => this.stepSynthesize(translationId) },
        { name: "MERGE", fn: () => this.stepMerge(translationId) },
      ];

      for (let i = startIndex; i < stepFns.length; i++) {
        // Check job timeout
        if (Date.now() - jobStart > JOB_TIMEOUT_MS) {
          throw new Error(
            `Job timed out after 30 minutes (stuck at ${stepFns[i].name})`,
          );
        }
        await withRetry(stepFns[i].name, stepFns[i].fn);
      }

      await updateTranslation(translationId, {
        status: "COMPLETED",
        progress: 100,
        completedAt: new Date(),
      });

      console.log(`[pipeline] Translation ${translationId} completed`);
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

  /**
   * Step 5 — CLONE_VOICE
   * Download the extracted source audio, send it to Fish Audio to create
   * a voice model, store the model ID on the translation record.
   */
  async stepCloneVoice(translationId: string) {
    const translation = await db.translation.findUniqueOrThrow({
      where: { id: translationId },
      include: { video: true },
    });

    // Skip if already cloned
    if (translation.fishAudioVoiceId) {
      console.log(`[pipeline] Step CLONE_VOICE skipped — voice already cloned`);
      await updateTranslation(translationId, {
        currentStep: "CLONE_VOICE",
        progress: STEP_PROGRESS.CLONE_VOICE,
      });
      return;
    }

    if (!translation.extractedAudioKey) {
      throw new Error(
        "No extracted audio key — EXTRACT_AUDIO step may have been skipped",
      );
    }

    await updateTranslation(translationId, {
      currentStep: "CLONE_VOICE",
      progress: 60,
    });

    console.log(
      `[pipeline] Step CLONE_VOICE — cloning voice from source audio`,
    );

    // Download source audio to /tmp for Fish Audio upload
    const tmpDir = path.join(os.tmpdir(), "dubly", translationId);
    fs.mkdirSync(tmpDir, { recursive: true });
    const audioPath = path.join(tmpDir, "voice-sample.wav");

    const audioStream = await tigris.download(translation.extractedAudioKey);
    if (!audioStream) throw new Error("Failed to download extracted audio");

    const ws = fs.createWriteStream(audioPath);
    for await (const chunk of audioStream as AsyncIterable<Uint8Array>) {
      ws.write(chunk);
    }
    ws.end();
    await new Promise<void>((resolve) => ws.on("finish", resolve));

    // Trim to 30s and compress to MP3 to stay under Fish Audio's upload limit
    const trimmedPath = path.join(tmpDir, "voice-sample-trimmed.mp3");
    await ffmpeg.trimAndCompress(audioPath, trimmedPath, 30);

    const voiceId = await fishAudio.createVoiceModel(
      trimmedPath,
      `dubly-${translationId}`,
    );

    await updateTranslation(translationId, {
      fishAudioVoiceId: voiceId,
      progress: STEP_PROGRESS.CLONE_VOICE,
    });

    console.log(`[pipeline] Step CLONE_VOICE complete — voice ID: ${voiceId}`);
  },

  /**
   * Step 6 — SYNTHESIZE
   * For each translated segment: generate TTS with cloned voice,
   * time-stretch to match original duration, concatenate with silence gaps.
   * Upload the full synthesized audio to Tigris.
   */
  async stepSynthesize(translationId: string) {
    const translation = await db.translation.findUniqueOrThrow({
      where: { id: translationId },
    });

    // Skip if already synthesized
    if (translation.synthesizedAudioKey) {
      console.log(
        `[pipeline] Step SYNTHESIZE skipped — audio already synthesized`,
      );
      await updateTranslation(translationId, {
        currentStep: "SYNTHESIZE",
        progress: STEP_PROGRESS.SYNTHESIZE,
      });
      return;
    }

    if (!translation.fishAudioVoiceId) {
      throw new Error(
        "No Fish Audio voice ID — CLONE_VOICE step may have been skipped",
      );
    }
    if (!translation.translatedJson) {
      throw new Error(
        "No translated JSON — TRANSLATE step may have been skipped",
      );
    }

    await updateTranslation(translationId, {
      currentStep: "SYNTHESIZE",
      progress: 70,
    });

    const segments = translation.translatedJson as unknown as {
      translatedText: string;
      start: number;
      end: number;
    }[];

    console.log(
      `[pipeline] Step SYNTHESIZE — generating ${segments.length} TTS segments`,
    );

    const tmpDir = path.join(os.tmpdir(), "dubly", translationId);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Build an ordered list of audio file paths (silence + speech alternating)
    const audioParts: string[] = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segDurationSec = (seg.end - seg.start) / 1000;

      // Add silence gap before this segment (from previous end to this start)
      const prevEnd = i === 0 ? 0 : segments[i - 1].end;
      const gapSec = (seg.start - prevEnd) / 1000;

      if (gapSec > 0.05) {
        const silencePath = path.join(tmpDir, `silence-${i}.wav`);
        await ffmpeg.generateSilence(gapSec, silencePath);
        audioParts.push(silencePath);
      }

      // Generate TTS for the segment
      const rawPath = path.join(tmpDir, `tts-raw-${i}.wav`);
      const stretchedPath = path.join(tmpDir, `tts-stretched-${i}.wav`);

      try {
        const audioBuffer = await fishAudio.synthesize(
          seg.translatedText,
          translation.fishAudioVoiceId,
          translation.targetLanguage,
        );
        fs.writeFileSync(rawPath, audioBuffer);

        // Time-stretch to match original segment duration
        if (segDurationSec > 0.1) {
          await ffmpeg.timeStretch(rawPath, segDurationSec, stretchedPath);
          audioParts.push(stretchedPath);
        } else {
          audioParts.push(rawPath);
        }
      } catch (err) {
        console.warn(
          `[pipeline] TTS failed for segment ${i}, inserting silence: ${err}`,
        );
        // Fallback: insert silence matching segment duration
        const fallbackPath = path.join(tmpDir, `fallback-${i}.wav`);
        await ffmpeg.generateSilence(
          Math.max(segDurationSec, 0.1),
          fallbackPath,
        );
        audioParts.push(fallbackPath);
      }

      // Update progress proportionally
      const segProgress = 70 + Math.round((i / segments.length) * 10);
      await updateTranslation(translationId, { progress: segProgress });
    }

    // Concatenate all parts into the final synthesized audio
    const synthesizedPath = path.join(tmpDir, "synthesized.wav");
    await ffmpeg.concatenateAudio(audioParts, synthesizedPath);

    // Upload to Tigris
    const audioKey = `translations/${translationId}/synthesized-audio.wav`;
    const finalBuffer = fs.readFileSync(synthesizedPath);
    await tigris.upload(audioKey, finalBuffer, "audio/wav");

    await updateTranslation(translationId, {
      synthesizedAudioKey: audioKey,
      progress: STEP_PROGRESS.SYNTHESIZE,
    });

    console.log(`[pipeline] Step SYNTHESIZE complete — stored at ${audioKey}`);
  },

  /**
   * Step 7 — MERGE
   * Download original video + synthesized audio from Tigris,
   * mux synthesized audio onto the video, upload result to Tigris.
   */
  async stepMerge(translationId: string) {
    const translation = await db.translation.findUniqueOrThrow({
      where: { id: translationId },
      include: { video: true },
    });

    // Skip if already merged
    if (translation.resultVideoKey) {
      console.log(
        `[pipeline] Step MERGE skipped — result video already exists`,
      );
      await updateTranslation(translationId, {
        currentStep: "MERGE",
        progress: STEP_PROGRESS.MERGE,
      });
      return;
    }

    if (!translation.synthesizedAudioKey) {
      throw new Error(
        "No synthesized audio key — SYNTHESIZE step may have been skipped",
      );
    }

    await updateTranslation(translationId, {
      currentStep: "MERGE",
      progress: 85,
    });

    console.log(`[pipeline] Step MERGE — combining video + synthesized audio`);

    const tmpDir = path.join(os.tmpdir(), "dubly", translationId);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Download original video
    const videoPath = path.join(tmpDir, "source-video.mp4");
    const videoStream = await tigris.download(translation.video.storageKey);
    if (!videoStream) throw new Error("Failed to download source video");

    const vws = fs.createWriteStream(videoPath);
    for await (const chunk of videoStream as AsyncIterable<Uint8Array>) {
      vws.write(chunk);
    }
    vws.end();
    await new Promise<void>((resolve) => vws.on("finish", resolve));

    // Download synthesized audio
    const audioPath = path.join(tmpDir, "synth-audio.wav");
    const audioStream = await tigris.download(translation.synthesizedAudioKey);
    if (!audioStream) throw new Error("Failed to download synthesized audio");

    const aws = fs.createWriteStream(audioPath);
    for await (const chunk of audioStream as AsyncIterable<Uint8Array>) {
      aws.write(chunk);
    }
    aws.end();
    await new Promise<void>((resolve) => aws.on("finish", resolve));

    // Verify files are valid before merging
    const videoSize = fs.statSync(videoPath).size;
    const audioSize = fs.statSync(audioPath).size;
    console.log(
      `[pipeline] Merge inputs — video: ${(videoSize / 1024 / 1024).toFixed(1)}MB, audio: ${(audioSize / 1024).toFixed(1)}KB`,
    );

    if (audioSize < 100) {
      throw new Error(
        `Synthesized audio file is too small (${audioSize} bytes) — likely empty`,
      );
    }

    const audioDuration = await ffmpeg.getDuration(audioPath);
    console.log(
      `[pipeline] Synthesized audio duration: ${audioDuration.toFixed(1)}s`,
    );

    // Merge
    const outputPath = await ffmpeg.mergeAudioVideo(
      videoPath,
      audioPath,
      translationId,
    );

    // Upload result
    const resultKey = `translations/${translationId}/result.mp4`;
    const resultBuffer = fs.readFileSync(outputPath);
    await tigris.upload(resultKey, resultBuffer, "video/mp4");

    await updateTranslation(translationId, {
      resultVideoKey: resultKey,
      progress: STEP_PROGRESS.MERGE,
    });

    console.log(`[pipeline] Step MERGE complete — result at ${resultKey}`);
  },
};
