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
const JOB_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes base timeout

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
   * - CosyVoice: extract reference WAVs (3–10s) and cache locally for inline synthesis
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

      // Extract up to 30s of this speaker's audio segments
      const speakerParts: string[] = [];
      let totalDuration = 0;

      for (let j = 0; j < segments.length && totalDuration < 30; j++) {
        const seg = segments[j];
        const startSec = seg.start / 1000;
        const endSec = seg.end / 1000;
        const segDur = endSec - startSec;
        if (segDur < 0.3) continue; // skip very short segments

        const partPath = path.join(tmpDir, `speaker-${speaker}-part-${j}.wav`);
        await ffmpeg.extractTimeRange(audioPath, startSec, endSec, partPath);
        speakerParts.push(partPath);
        totalDuration += segDur;
      }

      if (speakerParts.length === 0) {
        console.warn(
          `[pipeline] No usable audio for speaker ${speaker}, skipping`,
        );
        continue;
      }

      // Concatenate speaker parts into a single sample
      const speakerSamplePath = path.join(
        tmpDir,
        `speaker-${speaker}-sample.wav`,
      );
      await ffmpeg.concatenateAudio(speakerParts, speakerSamplePath);

      if (isCosyVoice) {
        // CosyVoice: keep the raw WAV reference — no model creation needed
        // Trim to 10s max for optimal cross-lingual synthesis
        const refPath = path.join(tmpDir, `speaker-${speaker}-ref.wav`);
        if (totalDuration > 10) {
          await ffmpeg.extractTimeRange(speakerSamplePath, 0, 10, refPath);
        } else {
          fs.copyFileSync(speakerSamplePath, refPath);
        }
        voiceMap[speaker] = refPath;
        console.log(
          `[pipeline] Extracted CosyVoice ref for speaker ${speaker}: ${refPath} (${Math.min(totalDuration, 10).toFixed(1)}s)`,
        );
      } else {
        // Fish Audio: trim, compress, and create persistent voice model
        const trimmedPath = path.join(
          tmpDir,
          `speaker-${speaker}-trimmed.mp3`,
        );
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
   * time-stretch to match original duration, concatenate with silence gaps.
   * - Fish Audio: uses persistent voice model IDs
   * - CosyVoice: sends reference WAV path inline with each call
   * Upload the full synthesized audio to Tigris.
   */
  async stepSynthesize(translationId: string) {
    const translation = await db.translation.findUniqueOrThrow({
      where: { id: translationId },
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

    // Precondition: voice references must exist (engine-specific)
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

    if (isCosyVoice && env.RUNPOD_POD_ID) {
      await runpodApi.startPod(env.RUNPOD_POD_ID);
      await runpodApi.waitForPodReady(env.RUNPOD_POD_ID, 180000); // 3 minutes timeout
    }

    try {
      // Build speaker → voice lookup (engine-specific)
      let voiceMap: Record<string, string>;
    let defaultVoiceRef: string;

    if (isCosyVoice) {
      // CosyVoice: read local WAV paths from manifest
      const refsManifest = path.join(tmpDir, "speaker-refs.json");
      voiceMap = JSON.parse(fs.readFileSync(refsManifest, "utf-8"));
      defaultVoiceRef = Object.values(voiceMap)[0];
    } else {
      // Fish Audio: read model IDs from DB
      voiceMap = (translation.fishAudioVoiceMap ?? {}) as Record<
        string,
        string
      >;
      defaultVoiceRef =
        translation.fishAudioVoiceId ?? Object.values(voiceMap)[0];
    }

    // Source language for CosyVoice mode selection (cross_lingual vs zero_shot)
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

    console.log(
      `[pipeline] Step SYNTHESIZE — generating ${segments.length} TTS segments (engine: ${isCosyVoice ? "CosyVoice" : "Fish Audio"})`,
    );

    fs.mkdirSync(tmpDir, { recursive: true });

    // Build an ordered list of audio file paths using ABSOLUTE position tracking.
    // This prevents cumulative drift — each segment is placed at its exact timestamp.
    const audioParts: string[] = [];
    let runningPositionMs = 0; // tracks where we are in the output audio timeline

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segDurationSec = (seg.end - seg.start) / 1000;

      // Silence gap: use absolute position to compute gap, not relative to prev segment
      const gapMs = seg.start - runningPositionMs;
      const gapSec = gapMs / 1000;

      if (gapSec > 0.02) {
        const silencePath = path.join(tmpDir, `silence-${i}.wav`);
        await ffmpeg.generateSilence(gapSec, silencePath);
        audioParts.push(silencePath);
        runningPositionMs += gapMs;
      } else if (gapSec < -0.05) {
        // Negative gap means we've drifted ahead — log but don't insert negative silence
        console.warn(
          `[pipeline] Segment ${i} drift: ${gapSec.toFixed(3)}s ahead of expected position`,
        );
      }

      // Generate TTS for the segment
      const rawPath = path.join(tmpDir, `tts-raw-${i}.wav`);
      const stretchedPath = path.join(tmpDir, `tts-stretched-${i}.wav`);

      // Skip empty/whitespace-only segments — insert silence instead of calling TTS
      if (!seg.translatedText || seg.translatedText.trim().length === 0) {
        console.warn(
          `[pipeline] Segment ${i}: empty translated text, inserting silence (${segDurationSec.toFixed(1)}s)`,
        );
        const emptyPath = path.join(tmpDir, `empty-${i}.wav`);
        await ffmpeg.generateSilence(Math.max(segDurationSec, 0.1), emptyPath);
        audioParts.push(emptyPath);
        runningPositionMs = seg.end;
        const segProgress = 70 + Math.round((i / segments.length) * 10);
        await updateTranslation(translationId, { progress: segProgress });
        continue;
      }

      try {
        // Use the correct voice for this speaker
        const speakerRef = voiceMap[seg.speaker ?? "A"] ?? defaultVoiceRef;
        if (!speakerRef) {
          throw new Error(`No voice ref for speaker ${seg.speaker ?? "A"}`);
        }

        // Estimate prosody speed hint: if translated text is much longer/shorter
        // than the time slot allows, hint TTS to speak faster/slower
        // This reduces the amount of post-processing stretch needed
        const avgCharsPerSec = 14; // rough estimate for natural speech
        const expectedDuration = seg.translatedText.length / avgCharsPerSec;
        const prosodySpeed =
          segDurationSec > 0.5 && expectedDuration > 0
            ? Math.max(0.7, Math.min(1.8, expectedDuration / segDurationSec))
            : undefined;

        let audioBuffer: Buffer;

        if (isCosyVoice) {
          // CosyVoice: send reference WAV path inline
          audioBuffer = await cosyvoice.synthesize(
            seg.translatedText,
            speakerRef,
            sourceLanguage,
            translation.targetLanguage,
            prosodySpeed,
          );
        } else {
          // Fish Audio: use persistent voice model ID
          audioBuffer = await fishAudio.synthesize(
            seg.translatedText,
            speakerRef,
            translation.targetLanguage,
            prosodySpeed,
          );
        }
        fs.writeFileSync(rawPath, audioBuffer);

        // Time-stretch to EXACT target duration (with clamping, truncate/pad)
        if (segDurationSec > 0.1) {
          const { stretchRatio } = await ffmpeg.timeStretchExact(
            rawPath,
            segDurationSec,
            stretchedPath,
          );
          if (stretchRatio > 1.8 || stretchRatio < 0.6) {
            console.warn(
              `[pipeline] Segment ${i}: extreme stretch ratio ${stretchRatio.toFixed(2)} ` +
                `(TTS generated ${(await ffmpeg.getDuration(rawPath)).toFixed(1)}s for ${segDurationSec.toFixed(1)}s slot)`,
            );
          }
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

      // Advance running position by exactly the segment duration (absolute alignment)
      runningPositionMs = seg.end;

      // Rate-limit: small delay between TTS calls to avoid hammering API
      if (i < segments.length - 1) {
        await new Promise((r) => setTimeout(r, 150));
      }

      // Update progress proportionally (batch DB writes every 5 segments)
      if (i % 5 === 0 || i === segments.length - 1) {
        const segProgress = 70 + Math.round((i / segments.length) * 10);
        await updateTranslation(translationId, { progress: segProgress });
      }
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
    } finally {
      if (isCosyVoice && env.RUNPOD_POD_ID) {
        console.log(`[pipeline] Ensuring RunPod Standard Pod stops compute billing...`);
        await runpodApi.stopPod(env.RUNPOD_POD_ID).catch((err: any) => 
          console.error(`[pipeline] FAILED to stop RunPod On-Demand Pod!`, err)
        );
      }
    }
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
