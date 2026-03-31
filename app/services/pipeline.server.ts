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
import { cosyvoice } from "~/services/cosyvoice.server";
import { env } from "~/utils/env.server";
import { runpodApi } from "~/services/runpod-api.server";

// ── Delayed Pod Shutdown ──────────────────────────────────────────────────
// Instead of stopping the pod immediately after a job completes, wait 20 minutes.
// If a new job starts within that window, cancel the pending shutdown.
const POD_IDLE_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
let podShutdownTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePodShutdown() {
  // Cancel any existing scheduled shutdown
  if (podShutdownTimer) {
    clearTimeout(podShutdownTimer);
    podShutdownTimer = null;
  }

  if (!env.RUNPOD_POD_ID) return;

  console.log(
    `[pipeline] Pod shutdown scheduled in 20 minutes (cancel if new job starts)`,
  );

  podShutdownTimer = setTimeout(async () => {
    podShutdownTimer = null;
    try {
      // Double-check no active jobs before stopping
      const activeJobs = await db.translation.count({
        where: {
          status: "PROCESSING",
          ttsEngine: "COSYVOICE",
        },
      });

      if (activeJobs > 0) {
        console.log(
          `[pipeline] Pod shutdown cancelled — ${activeJobs} active job(s)`,
        );
        return;
      }

      console.log(
        `[pipeline] Pod idle for 20 minutes — stopping to save billing...`,
      );
      await runpodApi.stopPod(env.RUNPOD_POD_ID!);
    } catch (err) {
      console.error(`[pipeline] Failed to stop pod after idle timeout:`, err);
    }
  }, POD_IDLE_TIMEOUT_MS);
}

function cancelPodShutdown() {
  if (podShutdownTimer) {
    clearTimeout(podShutdownTimer);
    podShutdownTimer = null;
    console.log(`[pipeline] Pending pod shutdown cancelled — new job started`);
  }
}

type PipelineStep =
  | "DOWNLOAD"
  | "EXTRACT_AUDIO"
  | "SEPARATE_AUDIO"
  | "TRANSCRIBE"
  | "TRANSLATE"
  | "CLONE_VOICE"
  | "SYNTHESIZE"
  | "MERGE";

const STEP_PROGRESS: Record<PipelineStep, number> = {
  DOWNLOAD: 8,
  EXTRACT_AUDIO: 15,
  SEPARATE_AUDIO: 25,
  TRANSCRIBE: 38,
  TRANSLATE: 50,
  CLONE_VOICE: 60,
  SYNTHESIZE: 80,
  MERGE: 95,
};

const MAX_STEP_RETRIES = 3;
const JOB_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes base timeout

const ORDERED_STEPS: PipelineStep[] = [
  "DOWNLOAD",
  "EXTRACT_AUDIO",
  "SEPARATE_AUDIO",
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
 * Split translated segments longer than MAX_SEGMENT_SEC at sentence boundaries.
 * Long utterances (30+ seconds) cause CosyVoice to truncate or produce artifacts.
 * Splitting preserves proportional timing for each sub-segment.
 * Per Phase 12 research, Pitfall 5.
 */
const MAX_SEGMENT_SEC = 15;

interface TranslatedSegment {
  translatedText: string;
  start: number;
  end: number;
  speaker?: string;
}

function splitLongSegments(segments: TranslatedSegment[]): TranslatedSegment[] {
  const result: TranslatedSegment[] = [];
  for (const seg of segments) {
    const durationSec = (seg.end - seg.start) / 1000;
    if (durationSec <= MAX_SEGMENT_SEC) {
      result.push(seg);
      continue;
    }
    // Split at sentence boundaries (period, exclamation, question mark followed by space)
    const sentences = seg.translatedText.split(/(?<=[.!?])\s+/);
    if (sentences.length <= 1) {
      // Can't split further — use as-is and let TTS handle it
      console.warn(
        `[pipeline] Segment at ${(seg.start / 1000).toFixed(1)}s is ${durationSec.toFixed(1)}s ` +
          `but cannot be split (single sentence)`,
      );
      result.push(seg);
      continue;
    }
    // Distribute timing proportionally by character count
    const totalChars = sentences.reduce((sum, s) => sum + s.length, 0);
    let currentStart = seg.start;
    for (let j = 0; j < sentences.length; j++) {
      const sentence = sentences[j];
      const fraction = sentence.length / totalChars;
      const subDurationMs = fraction * (seg.end - seg.start);
      const subEnd = Math.round(currentStart + subDurationMs);
      result.push({
        ...seg,
        translatedText: sentence.trim(),
        start: Math.round(currentStart),
        end: Math.min(subEnd, seg.end),
      });
      currentStart = subEnd;
    }
    console.log(
      `[pipeline] Split ${durationSec.toFixed(1)}s segment into ${sentences.length} sub-segments`,
    );
  }
  return result;
}

/**
 * Pipeline orchestrator — runs translation steps sequentially.
 * Each step is idempotent and wrapped in retry logic with exponential backoff.
 * Supports resuming from the last failed step on retry.
 */
export const pipeline = {
  async run(translationId: string) {
    const translation = await db.translation.findUnique({
      where: { id: translationId },
      include: { video: true },
    });

    if (!translation) {
      console.warn(
        `[pipeline] Translation ${translationId} not found — skipping (likely deleted)`,
      );
      return;
    }

    const jobStart = Date.now();

    // Cancel any pending pod shutdown — a new job is starting
    cancelPodShutdown();

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
      // Phase 9: Pre-Heating (Run immediately. If the physical host lacks GPUs, immediately abort before wasting third-party credits)
      // SEPARATE_AUDIO (index 2) also needs the pod for Demucs, so start pod if we haven't passed SYNTHESIZE yet
      if (
        translation.ttsEngine === "COSYVOICE" &&
        env.RUNPOD_POD_ID &&
        startIndex <= 6
      ) {
        console.log(`[pipeline] Waking CosyVoice Pod...`);
        try {
          await runpodApi.startPod(env.RUNPOD_POD_ID);
        } catch (err) {
          console.error("[pipeline] Pre-heat startPod failed:", err);
          throw new Error(
            "RunPod infrastructure is currently at maximum capacity (No free GPUs on your Pod's host machine). " +
              "Please click Retry on this translation in a few minutes once capacity clears up.",
          );
        }
      }
      const stepFns: Array<{ name: PipelineStep; fn: () => Promise<void> }> = [
        {
          name: "DOWNLOAD",
          fn: () => this.stepDownload(translationId, translation.video),
        },
        {
          name: "EXTRACT_AUDIO",
          fn: () => this.stepExtractAudio(translationId),
        },
        {
          name: "SEPARATE_AUDIO",
          fn: () => this.stepSeparateAudio(translationId),
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

      // Schedule delayed pod shutdown (20 min idle timeout)
      // If another job starts within that window, the timer is cancelled.
      if (translation.ttsEngine === "COSYVOICE" && env.RUNPOD_POD_ID) {
        schedulePodShutdown();
      }
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
    const {
      filePath,
      mimeType,
      title: videoTitle,
    } = await ytdlp.download(video.sourceUrl, video.id);

    // Upload downloaded file to Tigris
    const storageKey = `videos/${video.id}/source.mp4`;
    const fileBuffer = fs.readFileSync(filePath);
    await tigris.upload(storageKey, fileBuffer, mimeType);

    // Update video record with storage key and real title from source
    const updateData: Record<string, unknown> = {
      storageKey,
      mimeType,
      fileSizeBytes: fileBuffer.length,
    };
    // Replace placeholder title with the real video title from yt-dlp
    if (videoTitle) {
      updateData.title = videoTitle;
      console.log(`[pipeline] Video title from source: "${videoTitle}"`);
    }
    await db.video.update({
      where: { id: video.id },
      data: updateData,
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
      progress: 12,
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
   * Step 2.5 — SEPARATE_AUDIO
   * Extract full-quality audio from source video, send to Demucs /separate endpoint
   * on the GPU pod, store the background track in Tigris.
   * Per D-04: New step between EXTRACT_AUDIO and TRANSCRIBE.
   * Per D-03: Extract from original video at full quality (44.1kHz stereo).
   * Per D-05: Re-separate each time (no caching across translations).
   * Per D-07: If separation fails, fall back silently to speech-only.
   */
  async stepSeparateAudio(translationId: string) {
    const translation = await db.translation.findUniqueOrThrow({
      where: { id: translationId },
      include: { video: true },
    });

    // Skip if already separated
    if (translation.backgroundAudioKey) {
      console.log(
        `[pipeline] Step SEPARATE_AUDIO skipped — background already separated`,
      );
      await updateTranslation(translationId, {
        currentStep: "SEPARATE_AUDIO",
        progress: STEP_PROGRESS.SEPARATE_AUDIO,
      });
      return;
    }

    // Skip if background mixing is disabled
    if (!translation.enableBackgroundMix) {
      console.log(
        `[pipeline] Step SEPARATE_AUDIO skipped — background mixing disabled by user`,
      );
      await updateTranslation(translationId, {
        currentStep: "SEPARATE_AUDIO",
        progress: STEP_PROGRESS.SEPARATE_AUDIO,
      });
      return;
    }

    await updateTranslation(translationId, {
      currentStep: "SEPARATE_AUDIO",
      progress: 18,
    });

    console.log(
      `[pipeline] Step SEPARATE_AUDIO — extracting background audio via Demucs`,
    );

    const tmpDir = path.join(os.tmpdir(), "dubly", translationId);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      // Step 1: Download source video from Tigris (reuse if already present from EXTRACT_AUDIO)
      let videoPath = path.join(tmpDir, "source-video.mp4");
      if (!fs.existsSync(videoPath)) {
        // Also check the EXTRACT_AUDIO path
        const altVideoPath = path.join(tmpDir, "source.mp4");
        if (fs.existsSync(altVideoPath)) {
          videoPath = altVideoPath;
        } else {
          const videoStream = await tigris.download(
            translation.video.storageKey,
          );
          if (!videoStream)
            throw new Error("Failed to download source video for separation");
          const vws = fs.createWriteStream(videoPath);
          for await (const chunk of videoStream as AsyncIterable<Uint8Array>) {
            vws.write(chunk);
          }
          vws.end();
          await new Promise<void>((resolve) => vws.on("finish", resolve));
        }
      }

      // Step 2: Extract full-quality audio (44.1kHz stereo) per D-03
      const fullQualityPath = await ffmpeg.extractAudioFullQuality(
        videoPath,
        translationId,
      );

      // Step 3: Ensure GPU pod is ready (Demucs runs on same pod)
      if (env.RUNPOD_POD_ID) {
        await cosyvoice.waitForHealth(180000);
      }

      // Step 4: Send to Demucs /separate endpoint
      const { background } = await cosyvoice.separateAudio(fullQualityPath);

      // Step 5: Save background track locally and check if meaningful
      const bgPath = path.join(tmpDir, "background-audio.wav");
      fs.writeFileSync(bgPath, background);

      const meaningful = await ffmpeg.isBackgroundMeaningful(bgPath);
      if (!meaningful) {
        console.log(
          `[pipeline] Background track is silence — skipping background mixing`,
        );
        await updateTranslation(translationId, {
          currentStep: "SEPARATE_AUDIO",
          progress: STEP_PROGRESS.SEPARATE_AUDIO,
          enableBackgroundMix: false, // Effectively disable for this translation
        });
        return;
      }

      // Step 6: Upload background track to Tigris
      const bgKey = `translations/${translationId}/background-audio.wav`;
      await tigris.upload(bgKey, background, "audio/wav");

      await updateTranslation(translationId, {
        backgroundAudioKey: bgKey,
        currentStep: "SEPARATE_AUDIO",
        progress: STEP_PROGRESS.SEPARATE_AUDIO,
      });

      console.log(
        `[pipeline] Step SEPARATE_AUDIO complete — background stored at ${bgKey}`,
      );
    } catch (err) {
      // Per D-07: If background extraction fails, fall back silently to speech-only
      const message = err instanceof Error ? err.message : "Unknown error";
      console.warn(
        `[pipeline] SEPARATE_AUDIO failed — falling back to speech-only: ${message}`,
      );
      await updateTranslation(translationId, {
        currentStep: "SEPARATE_AUDIO",
        progress: STEP_PROGRESS.SEPARATE_AUDIO,
        enableBackgroundMix: false,
      });
      // Do NOT throw — allow pipeline to continue without background audio
    }
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
      progress: 28,
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
        speaker?: string;
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
   * Detect unique speakers from the transcript, extract per-speaker audio
   * samples from the source.
   * - Fish Audio: clone a persistent voice model for each speaker
   * - CosyVoice: extract reference WAVs (3-10s) and cache locally for inline synthesis
   */
  async stepCloneVoice(translationId: string) {
    const translation = await db.translation.findUniqueOrThrow({
      where: { id: translationId },
      include: { video: true },
    });

    const isCosyVoice = translation.ttsEngine === "COSYVOICE";
    const tmpDir = path.join(os.tmpdir(), "dubly", translationId);

    // Skip if already cloned (engine-specific checks)
    if (isCosyVoice) {
      const hasRefs = fs.existsSync(path.join(tmpDir, "speaker-refs.json"));
      if (hasRefs) {
        console.log(
          `[pipeline] Step CLONE_VOICE skipped — CosyVoice speaker refs exist`,
        );
        await updateTranslation(translationId, {
          currentStep: "CLONE_VOICE",
          progress: STEP_PROGRESS.CLONE_VOICE,
        });
        return;
      }
    } else {
      if (translation.fishAudioVoiceMap || translation.fishAudioVoiceId) {
        console.log(
          `[pipeline] Step CLONE_VOICE skipped — voice already cloned`,
        );
        await updateTranslation(translationId, {
          currentStep: "CLONE_VOICE",
          progress: STEP_PROGRESS.CLONE_VOICE,
        });
        return;
      }
    }

    if (!translation.extractedAudioKey) {
      throw new Error(
        "No extracted audio key — EXTRACT_AUDIO step may have been skipped",
      );
    }
    if (!translation.transcriptJson) {
      throw new Error(
        "No transcript JSON — TRANSCRIBE step may have been skipped",
      );
    }

    await updateTranslation(translationId, {
      currentStep: "CLONE_VOICE",
      progress: 60,
    });

    // Download source audio to /tmp
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

    // Parse transcript to find unique speakers
    const transcript = translation.transcriptJson as unknown as {
      segments: {
        text: string;
        start: number;
        end: number;
        speaker?: string;
      }[];
    };
    const speakerSegments = new Map<string, { start: number; end: number }[]>();

    for (const seg of transcript.segments) {
      const speaker = seg.speaker ?? "A";
      if (!speakerSegments.has(speaker)) {
        speakerSegments.set(speaker, []);
      }
      speakerSegments.get(speaker)!.push({ start: seg.start, end: seg.end });
    }

    const speakers = Array.from(speakerSegments.keys());
    console.log(
      `[pipeline] Step CLONE_VOICE — detected ${speakers.length} speaker(s): ${speakers.join(", ")}`,
    );

    // Clone/extract a voice for each speaker
    const voiceMap: Record<string, string> = {};

    for (let si = 0; si < speakers.length; si++) {
      const speaker = speakers[si];
      const segments = speakerSegments.get(speaker)!;

      // Ensure pristine embeddings: Find the single longest clean segment instead of micro-stitching cuts
      let bestSegment: { start: number; end: number; duration: number } | null =
        null;
      for (const seg of segments) {
        const durationSec = (seg.end - seg.start) / 1000;
        if (!bestSegment || durationSec > bestSegment.duration) {
          bestSegment = {
            start: seg.start,
            end: seg.end,
            duration: durationSec,
          };
        }
      }

      if (!bestSegment || bestSegment.duration < 0.5) {
        console.warn(
          `[pipeline] No usable audio for speaker ${speaker}, skipping`,
        );
        continue;
      }

      const startSec = bestSegment.start / 1000;
      let endSec = bestSegment.end / 1000;
      // Cap embeddings strictly below maximum memory window thresholds
      if (endSec - startSec > 10) {
        endSec = startSec + 10;
      }

      const speakerSamplePath = path.join(
        tmpDir,
        `speaker-${speaker}-sample.wav`,
      );
      await ffmpeg.extractTimeRange(
        audioPath,
        startSec,
        endSec,
        speakerSamplePath,
      );
      const totalDuration = endSec - startSec;

      if (isCosyVoice) {
        // CosyVoice: reference is already a single contiguous clean shot under 10s
        const refPath = path.join(tmpDir, `speaker-${speaker}-ref.wav`);
        fs.copyFileSync(speakerSamplePath, refPath);
        voiceMap[speaker] = refPath;
        console.log(
          `[pipeline] Extracted CosyVoice ref for speaker ${speaker}: ${refPath} (${totalDuration.toFixed(1)}s)`,
        );
      } else {
        // Fish Audio: compress, and create persistent voice model
        const trimmedPath = path.join(tmpDir, `speaker-${speaker}-trimmed.mp3`);
        await ffmpeg.trimAndCompress(speakerSamplePath, trimmedPath, 30);

        const voiceId = await fishAudio.createVoiceModel(
          trimmedPath,
          `dubly-${translationId}-${speaker}`,
        );
        voiceMap[speaker] = voiceId;
        console.log(
          `[pipeline] Cloned voice for speaker ${speaker}: ${voiceId} (${totalDuration.toFixed(1)}s sample)`,
        );
      }

      // Update progress per speaker
      const progress = 60 + Math.round(((si + 1) / speakers.length) * 5);
      await updateTranslation(translationId, { progress });
    }

    // Store voice mapping (engine-specific)
    if (isCosyVoice) {
      // Write speaker refs manifest for idempotency check on resume
      const refsManifest = path.join(tmpDir, "speaker-refs.json");
      fs.writeFileSync(refsManifest, JSON.stringify(voiceMap));
      console.log(
        `[pipeline] Step CLONE_VOICE complete — ${Object.keys(voiceMap).length} speaker ref(s) extracted`,
      );
      await updateTranslation(translationId, {
        progress: STEP_PROGRESS.CLONE_VOICE,
      });
    } else {
      // Fish Audio: store model IDs in DB
      const firstVoiceId = Object.values(voiceMap)[0] ?? null;
      await updateTranslation(translationId, {
        fishAudioVoiceMap: voiceMap as unknown as Record<string, unknown>,
        fishAudioVoiceId: firstVoiceId,
        progress: STEP_PROGRESS.CLONE_VOICE,
      });
      console.log(
        `[pipeline] Step CLONE_VOICE complete — ${Object.keys(voiceMap).length} voice(s) cloned`,
      );
    }
  },

  /**
   * Step 6 — SYNTHESIZE
   * For each translated segment: generate TTS with cloned voice,
   * apply gap-aware pacing with time-stretching to match timing.
   * - Per D-15: Always synthesize at speed=1.0 (natural speed)
   * - Per D-16: Gap-aware pacing — allow natural overflow into gaps
   * - Per D-13: Track failed segments in DB
   * - Per D-14: Abort if >50% of segments fail
   * - Per D-19: No prosodySpeed, no avgCharsPerSec
   */
  async stepSynthesize(translationId: string) {
    const translation = await db.translation.findUniqueOrThrow({
      where: { id: translationId },
      include: { video: true },
    });

    const isCosyVoice = translation.ttsEngine === "COSYVOICE";
    const tmpDir = path.join(os.tmpdir(), "dubly", translationId);

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

    // Precondition checks
    if (isCosyVoice) {
      const refsManifest = path.join(tmpDir, "speaker-refs.json");
      if (!fs.existsSync(refsManifest)) {
        throw new Error(
          "No CosyVoice speaker refs — CLONE_VOICE step may have been skipped or temp files lost. Re-run from CLONE_VOICE.",
        );
      }
    } else {
      if (!translation.fishAudioVoiceId && !translation.fishAudioVoiceMap) {
        throw new Error(
          "No Fish Audio voice ID — CLONE_VOICE step may have been skipped",
        );
      }
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

    // Per D-09: Health check before synthesis
    if (isCosyVoice && env.RUNPOD_POD_ID) {
      await runpodApi.waitForPodReady(env.RUNPOD_POD_ID, 180000);
      await cosyvoice.waitForHealth(180000);
    }

    try {
      // Build speaker voice lookup
      let voiceMap: Record<string, string>;
      let defaultVoiceRef: string;

      if (isCosyVoice) {
        const refsManifest = path.join(tmpDir, "speaker-refs.json");
        voiceMap = JSON.parse(fs.readFileSync(refsManifest, "utf-8"));
        defaultVoiceRef = Object.values(voiceMap)[0];
      } else {
        voiceMap = (translation.fishAudioVoiceMap ?? {}) as Record<
          string,
          string
        >;
        defaultVoiceRef =
          translation.fishAudioVoiceId ?? Object.values(voiceMap)[0];
      }

      const transcriptMeta = translation.transcriptJson as unknown as {
        languageCode?: string | null;
      };
      const sourceLanguage = transcriptMeta?.languageCode ?? "en";

      const segments = translation.translatedJson as unknown as {
        translatedText: string;
        start: number;
        end: number;
        speaker?: string;
      }[];

      // Split long segments at sentence boundaries to avoid TTS truncation (Phase 12, Pitfall 5)
      const splitSegments = splitLongSegments(segments);
      if (splitSegments.length !== segments.length) {
        console.log(
          `[pipeline] Split ${segments.length} segments into ${splitSegments.length} sub-segments`,
        );
      }

      console.log(
        `[pipeline] Step SYNTHESIZE — generating ${splitSegments.length} TTS segments (engine: ${isCosyVoice ? "CosyVoice" : "Fish Audio"})`,
      );

      // Debug: log the segment timeline
      for (let i = 0; i < Math.min(splitSegments.length, 10); i++) {
        const s = splitSegments[i];
        console.log(
          `[pipeline] Segment ${i}: start=${(s.start / 1000).toFixed(1)}s end=${(s.end / 1000).toFixed(1)}s ` +
            `dur=${((s.end - s.start) / 1000).toFixed(1)}s text="${s.translatedText.slice(0, 60)}..."`,
        );
      }
      if (splitSegments.length > 10) {
        console.log(
          `[pipeline] ... and ${splitSegments.length - 10} more segments`,
        );
      }

      fs.mkdirSync(tmpDir, { recursive: true });

      // Per D-13: Track failed segments
      const failedSegments: { index: number; error: string }[] = [];

      const audioParts: { path: string; startMs: number }[] = [];
      for (let i = 0; i < splitSegments.length; i++) {
        const seg = splitSegments[i];
        const segDurationSec = (seg.end - seg.start) / 1000;
        const nextSegStart =
          i + 1 < splitSegments.length
            ? splitSegments[i + 1].start
            : (translation.video.durationSec ?? 0) * 1000;

        const rawPath = path.join(tmpDir, `tts-raw-${i}.wav`);
        const stretchedPath = path.join(tmpDir, `tts-stretched-${i}.wav`);

        // Skip empty segments
        if (!seg.translatedText || seg.translatedText.trim().length === 0) {
          const segProgress = 70 + Math.round((i / splitSegments.length) * 10);
          await updateTranslation(translationId, { progress: segProgress });
          continue;
        }

        try {
          const speakerRef = voiceMap[seg.speaker ?? "A"] ?? defaultVoiceRef;
          if (!speakerRef) {
            throw new Error(`No voice ref for speaker ${seg.speaker ?? "A"}`);
          }

          // Per D-15: Always synthesize at speed=1.0 (natural speed)
          // Per D-19: No prosodySpeed, no avgCharsPerSec
          let audioBuffer: Buffer;

          if (isCosyVoice) {
            audioBuffer = await cosyvoice.synthesize(
              seg.translatedText,
              speakerRef,
              sourceLanguage,
              translation.targetLanguage,
              1.0, // Per D-15: always 1.0
            );
          } else {
            audioBuffer = await fishAudio.synthesize(
              seg.translatedText,
              speakerRef,
              translation.targetLanguage,
              1.0, // Per D-15: always 1.0
            );
          }
          fs.writeFileSync(rawPath, audioBuffer);
          const actualGeneratedSec = await ffmpeg.getDuration(rawPath);

          // Phase 12: Revised gap-aware pacing — always enforce segment duration
          const targetDurationSec = segDurationSec;
          const tolerance = 0.1; // 10% tolerance
          const relativeDiff =
            Math.abs(actualGeneratedSec - targetDurationSec) /
            targetDurationSec;

          if (relativeDiff < tolerance) {
            // Within 10% of target — use as-is (no stretching needed)
            audioParts.push({ path: rawPath, startMs: seg.start });
            console.log(
              `[pipeline] Seg ${i}: target=${targetDurationSec.toFixed(2)}s ` +
                `actual=${actualGeneratedSec.toFixed(2)}s — within ${(tolerance * 100).toFixed(0)}% tolerance, using as-is`,
            );
          } else if (actualGeneratedSec > targetDurationSec) {
            // TTS is LONGER than segment
            const gapSec = (nextSegStart - seg.end) / 1000;
            if (
              gapSec > 0 &&
              actualGeneratedSec <= targetDurationSec + gapSec * 0.8
            ) {
              // Fits within segment + 80% of gap — allow natural overflow
              audioParts.push({ path: rawPath, startMs: seg.start });
              console.log(
                `[pipeline] Seg ${i}: overflow into gap ` +
                  `(${actualGeneratedSec.toFixed(2)}s into ${targetDurationSec.toFixed(2)}s + ${gapSec.toFixed(2)}s gap)`,
              );
            } else {
              // Too long even with gap — speed up to fit in segment
              const { outputPath: finalPath } = await ffmpeg.timeStretchExact(
                rawPath,
                targetDurationSec,
                stretchedPath,
              );
              audioParts.push({ path: finalPath, startMs: seg.start });
              console.log(
                `[pipeline] Seg ${i}: sped up ${actualGeneratedSec.toFixed(2)}s -> ${targetDurationSec.toFixed(2)}s`,
              );
            }
          } else {
            // TTS is SHORTER than segment — stretch to fill the slot
            const { outputPath: finalPath } = await ffmpeg.timeStretchExact(
              rawPath,
              targetDurationSec,
              stretchedPath,
            );
            audioParts.push({ path: finalPath, startMs: seg.start });
            console.log(
              `[pipeline] Seg ${i}: stretched ${actualGeneratedSec.toFixed(2)}s -> ${targetDurationSec.toFixed(2)}s`,
            );
          }
        } catch (err) {
          // Per D-12: Fall back to silence for failed segments
          const errorMsg =
            err instanceof Error ? err.message : "Unknown TTS error";
          console.warn(`[pipeline] TTS failed for segment ${i}: ${errorMsg}`);
          failedSegments.push({ index: i, error: errorMsg });

          // Per D-14: If >50% of segments fail, abort entirely
          if (failedSegments.length > splitSegments.length / 2) {
            console.error(
              `[pipeline] >50% segments failed (${failedSegments.length}/${splitSegments.length}) — aborting job`,
            );
            await updateTranslation(translationId, {
              failedSegments: failedSegments,
              failedSegmentCount: failedSegments.length,
            });
            throw new Error(
              `TTS failed for ${failedSegments.length} of ${splitSegments.length} segments (>50%). ` +
                `Last error: ${errorMsg}`,
            );
          }
        }

        // Rate-limit between TTS calls
        if (i < splitSegments.length - 1) {
          await new Promise((r) => setTimeout(r, 150));
        }

        // Progress updates (batch every 5 segments)
        if (i % 5 === 0 || i === splitSegments.length - 1) {
          const segProgress = 70 + Math.round((i / splitSegments.length) * 10);
          await updateTranslation(translationId, { progress: segProgress });
        }
      }

      console.log(
        `[pipeline] Synthesis complete: ${audioParts.length} audio parts from ${splitSegments.length} segments ` +
          `(${failedSegments.length} failed)`,
      );

      // Per D-13: Store failed segment info in DB
      if (failedSegments.length > 0) {
        console.warn(
          `[pipeline] ${failedSegments.length} of ${splitSegments.length} segments failed TTS — using silence for those segments`,
        );
        await updateTranslation(translationId, {
          failedSegments: failedSegments,
          failedSegmentCount: failedSegments.length,
        });
      }

      // Per D-18: Absolute time mixing (layer overlapping speakers naturally)
      const synthesizedPath = path.join(tmpDir, "synthesized.wav");
      await ffmpeg.mixAudioAbsolute(
        audioParts,
        synthesizedPath,
        translation.video.durationSec ?? undefined,
      );

      // Phase 12: Post-synthesis timeline validation
      const synthDuration = await ffmpeg.getDuration(synthesizedPath);
      const lastSegEndMs = Math.max(...splitSegments.map((s) => s.end));
      const lastSegEndSec = lastSegEndMs / 1000;
      const videoDurationSec = translation.video.durationSec ?? 0;

      console.log(
        `[pipeline] Timeline validation:\n` +
          `  Synthesized audio duration: ${synthDuration.toFixed(1)}s\n` +
          `  Last segment ends at:       ${lastSegEndSec.toFixed(1)}s\n` +
          `  Video duration:             ${videoDurationSec.toFixed(1)}s\n` +
          `  Speech coverage:            ${((lastSegEndSec / videoDurationSec) * 100).toFixed(0)}% of video\n` +
          `  Audio vs last segment:      ${synthDuration >= lastSegEndSec ? "OK" : "SHORT by " + (lastSegEndSec - synthDuration).toFixed(1) + "s"}`,
      );

      if (synthDuration < lastSegEndSec * 0.8) {
        console.warn(
          `[pipeline] WARNING: Synthesized audio (${synthDuration.toFixed(1)}s) is significantly ` +
            `shorter than last segment end (${lastSegEndSec.toFixed(1)}s) — timing drift may be present`,
        );
      }

      // Upload to Tigris
      const audioKey = `translations/${translationId}/synthesized-audio.wav`;
      const finalBuffer = fs.readFileSync(synthesizedPath);
      await tigris.upload(audioKey, finalBuffer, "audio/wav");

      await updateTranslation(translationId, {
        synthesizedAudioKey: audioKey,
        progress: STEP_PROGRESS.SYNTHESIZE,
      });

      console.log(
        `[pipeline] Step SYNTHESIZE complete — stored at ${audioKey}`,
      );
    } finally {
      if (isCosyVoice && env.RUNPOD_POD_ID) {
        schedulePodShutdown();
      }
    }
  },

  /**
   * Step 7 — MERGE
   * Download original video + synthesized audio from Tigris.
   * Per D-20: Two-pass merge — pre-mix speech with ducked background, then mux onto video.
   * Per D-21: Mux with -c:v copy -c:a aac (no re-encode).
   * Per D-22: Quality check on output before marking complete.
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
    if (!fs.existsSync(videoPath)) {
      // Also check the EXTRACT_AUDIO path
      const altVideoPath = path.join(tmpDir, "source.mp4");
      if (fs.existsSync(altVideoPath)) {
        fs.copyFileSync(altVideoPath, videoPath);
      } else {
        const videoStream = await tigris.download(translation.video.storageKey);
        if (!videoStream) throw new Error("Failed to download source video");
        const vws = fs.createWriteStream(videoPath);
        for await (const chunk of videoStream as AsyncIterable<Uint8Array>) {
          vws.write(chunk);
        }
        vws.end();
        await new Promise<void>((resolve) => vws.on("finish", resolve));
      }
    }

    // Download synthesized audio
    const speechPath = path.join(tmpDir, "synth-audio.wav");
    const audioStream = await tigris.download(translation.synthesizedAudioKey);
    if (!audioStream) throw new Error("Failed to download synthesized audio");
    const aws = fs.createWriteStream(speechPath);
    for await (const chunk of audioStream as AsyncIterable<Uint8Array>) {
      aws.write(chunk);
    }
    aws.end();
    await new Promise<void>((resolve) => aws.on("finish", resolve));

    // Verify files are valid
    const videoSize = fs.statSync(videoPath).size;
    const audioSize = fs.statSync(speechPath).size;
    console.log(
      `[pipeline] Merge inputs — video: ${(videoSize / 1024 / 1024).toFixed(1)}MB, speech: ${(audioSize / 1024).toFixed(1)}KB`,
    );

    if (audioSize < 100) {
      throw new Error(
        `Synthesized audio file is too small (${audioSize} bytes) — likely empty`,
      );
    }

    // Per D-20: Two-pass merge approach
    let finalAudioPath = speechPath;

    // Check if background audio exists and mixing is enabled
    if (translation.backgroundAudioKey && translation.enableBackgroundMix) {
      console.log(`[pipeline] Downloading background audio for pre-mix...`);

      const bgPath = path.join(tmpDir, "background-audio.wav");
      // Reuse local file if still present from SEPARATE_AUDIO step
      if (!fs.existsSync(bgPath)) {
        const bgStream = await tigris.download(translation.backgroundAudioKey);
        if (!bgStream) {
          console.warn(
            `[pipeline] Failed to download background audio — proceeding with speech-only`,
          );
        } else {
          const bws = fs.createWriteStream(bgPath);
          for await (const chunk of bgStream as AsyncIterable<Uint8Array>) {
            bws.write(chunk);
          }
          bws.end();
          await new Promise<void>((resolve) => bws.on("finish", resolve));
        }
      }

      if (fs.existsSync(bgPath)) {
        try {
          // Pass 1a: Duck background by -8dB (per D-06)
          const duckedBgPath = path.join(tmpDir, "background-ducked.wav");
          await ffmpeg.duckBackground(bgPath, duckedBgPath, -8);

          // Pass 1b: Pre-mix speech + ducked background (per D-20)
          const premixPath = path.join(tmpDir, "premixed-audio.wav");
          await ffmpeg.preMixAudio(speechPath, duckedBgPath, premixPath);

          finalAudioPath = premixPath;
          console.log(
            `[pipeline] Pre-mix complete — speech + ducked background`,
          );
        } catch (err) {
          // Per D-07: If background mixing fails, fall back to speech-only
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.warn(
            `[pipeline] Background pre-mix failed — using speech-only: ${msg}`,
          );
          finalAudioPath = speechPath;
        }
      }
    }

    const audioDuration = await ffmpeg.getDuration(finalAudioPath);
    console.log(
      `[pipeline] Final audio duration: ${audioDuration.toFixed(1)}s`,
    );

    // Pass 2: Mux audio onto video (per D-21: -c:v copy, -c:a aac)
    const outputPath = await ffmpeg.mergeAudioVideo(
      videoPath,
      finalAudioPath,
      translationId,
    );

    // Per D-22: Quality check
    const expectedDuration = translation.video.durationSec ?? audioDuration;
    const qualityCheck = await ffmpeg.verifyMergeOutput(
      outputPath,
      expectedDuration,
    );
    if (!qualityCheck.valid) {
      throw new Error(`Merge quality check failed: ${qualityCheck.reason}`);
    }

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
