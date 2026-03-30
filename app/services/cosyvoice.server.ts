import * as fs from "fs";
import { env } from "~/utils/env.server";

// ── Constants ──────────────────────────────────────────────────────────

const MAX_RETRIES = 5;

/**
 * Exponential backoff delays per D-11: 2s, 4s, 8s, 16s, 30s.
 */
const RETRY_BACKOFF_MS = [2000, 4000, 8000, 16000, 30000];

/**
 * Languages supported by CosyVoice 3 cross-lingual synthesis.
 * Trained on 1M hours across these 9 languages with supervised semantic tokens.
 */
export const COSYVOICE_LANGUAGES = [
  "en",
  "zh",
  "ja",
  "ko",
  "de",
  "es",
  "fr",
  "it",
  "ru",
] as const;

export type CosyVoiceLanguage = (typeof COSYVOICE_LANGUAGES)[number];

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Select inference mode based on language pair.
 * cross_lingual: source != target (extracts timbre only, uses target phonology)
 * zero_shot: source = target (clones voice + style for same-language synthesis)
 */
function selectMode(
  sourceLanguage: string,
  targetLanguage: string,
): "cross_lingual" | "zero_shot" {
  return sourceLanguage === targetLanguage ? "zero_shot" : "cross_lingual";
}

/**
 * Derive the CosyVoice Pod base HTTP URL from the RunPod proxy URL.
 * COSYVOICE_URL may be the RunPod serverless URL or the pod proxy URL.
 * For /health and /separate, we need the pod's direct proxy URL.
 */
function getPodBaseUrl(): string {
  // If RUNPOD_POD_ID is set, construct the pod proxy URL
  if (env.RUNPOD_POD_ID) {
    return `https://${env.RUNPOD_POD_ID}-8000.proxy.runpod.net`;
  }
  // Fall back to stripping known path suffixes from COSYVOICE_URL
  const url = env.COSYVOICE_URL ?? "";
  return url.replace(/\/(synthesize|runsync|run)$/, "").replace(/\/+$/, "");
}

/**
 * Detect if an error is likely caused by a pod restart.
 * Common patterns: connection refused, ECONNRESET, IN_QUEUE status, 502/503 errors.
 */
function isPodRestartError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return (
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("in_queue") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("fetch failed") ||
    msg.includes("network error")
  );
}

// ── Service ────────────────────────────────────────────────────────────

/**
 * CosyVoice 3 service — cross-lingual voice cloning & TTS via self-hosted
 * FastAPI endpoint (GPU docker container).
 */
export const cosyvoice = {
  /**
   * Supported languages for UI filtering.
   */
  SUPPORTED_LANGUAGES: COSYVOICE_LANGUAGES,

  /**
   * Poll the CosyVoice /health endpoint until ready:true.
   * Per D-09: Wait up to 3 minutes for pod to be ready.
   * Per D-08: Health returns ready:true only after model load + warmup.
   */
  async waitForHealth(timeoutMs: number = 180000): Promise<void> {
    const baseUrl = getPodBaseUrl();
    const healthUrl = `${baseUrl}/health`;
    const start = Date.now();

    console.log(`[cosyvoice] Polling health at ${healthUrl}...`);

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          if (data.ready === true) {
            console.log(`[cosyvoice] Health check passed in ${((Date.now() - start) / 1000).toFixed(1)}s`);
            return;
          }
        }
      } catch {
        // Connection refused or timeout -- pod not ready yet
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    throw new Error(`CosyVoice health check timed out after ${(timeoutMs / 1000).toFixed(0)}s`);
  },

  /**
   * Send audio to the Demucs /separate endpoint on the GPU pod.
   * Per D-01: Uses htdemucs model for AI source separation.
   * Per D-02: Runs on the same RunPod pod as CosyVoice.
   * Returns the background track as a Buffer.
   */
  async separateAudio(
    audioPath: string,
  ): Promise<{ background: Buffer; vocals: Buffer; sampleRate: number }> {
    const baseUrl = getPodBaseUrl();
    const separateUrl = `${baseUrl}/separate`;

    console.log(`[cosyvoice] Sending audio to Demucs /separate at ${separateUrl}...`);

    const audioBuffer = fs.readFileSync(audioPath);
    const blob = new Blob([audioBuffer], { type: "audio/wav" });
    const formData = new FormData();
    formData.append("audio", blob, "source-audio-full.wav");

    const res = await fetch(separateUrl, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(300000), // 5 min timeout for large files
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Demucs /separate failed (${res.status}): ${errText}`);
    }

    const result = await res.json();

    const backgroundBuffer = Buffer.from(result.background, "base64");
    const vocalsBuffer = Buffer.from(result.vocals, "base64");

    console.log(
      `[cosyvoice] Demucs separation complete — background: ${(backgroundBuffer.length / 1024).toFixed(0)}KB, vocals: ${(vocalsBuffer.length / 1024).toFixed(0)}KB`,
    );

    return {
      background: backgroundBuffer,
      vocals: vocalsBuffer,
      sampleRate: result.sample_rate,
    };
  },

  /**
   * Synthesize speech from text using a speaker reference audio.
   *
   * @param text - Text to synthesize in the target language
   * @param promptWavPath - Path to speaker reference WAV (>=16kHz mono, 3-30s)
   * @param sourceLanguage - ISO 639-1 code of the source audio language
   * @param targetLanguage - ISO 639-1 code of the target language
   * @param speed - Speech speed multiplier (ignored — always 1.0 per D-15)
   * @param promptText - Transcript of reference audio (required for zero_shot only)
   * @returns WAV buffer ready for FFmpeg processing
   */
  async synthesize(
    text: string,
    promptWavPath: string,
    sourceLanguage: string,
    targetLanguage: string,
    speed?: number,
    promptText?: string,
  ): Promise<Buffer> {
    // Guard: COSYVOICE_URL and RUNPOD_API_KEY must be configured
    if (!env.COSYVOICE_URL || !env.RUNPOD_API_KEY) {
      throw new Error(
        "COSYVOICE_URL and RUNPOD_API_KEY are not configured. Set them in your .env file to use the RunPod Serverless CosyVoice engine.",
      );
    }

    // Guard: reject empty text
    if (!text || text.trim().length === 0) {
      throw new Error("Cannot synthesize empty text");
    }

    const mode = selectMode(sourceLanguage, targetLanguage);
    // Per D-15: Always synthesize at speed=1.0. Do NOT use speed parameter for pacing.
    const clampedSpeed = 1.0;

    // CosyVoice demands explicit linguistic tokenization markers for cross-lingual zero-shot
    const finalText = `<|${targetLanguage}|>${text}`;

    console.log(
      `[cosyvoice] Synthesizing via RunPod Serverless (mode: ${mode}, target: ${targetLanguage}, speed: ${clampedSpeed})...`,
    );

    // Read reference audio & encode to Base64
    const wavBuffer = fs.readFileSync(promptWavPath);
    const wavBase64 = wavBuffer.toString("base64");

    // Build JSON payload for RunPod Serverless
    const inputPayload: Record<string, any> = {
      tts_text: finalText,
      mode: mode,
      speed: clampedSpeed,
      prompt_wav: wavBase64,
    };

    if (mode === "zero_shot" && promptText) {
      inputPayload.prompt_text = promptText;
    }

    const runpodPayload = {
      input: inputPayload,
    };

    // Retry loop with exponential backoff (per D-11: 5 retries)
    let lastError: Error | null = null;
    let hadPriorSuccess = false;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)];
        console.log(
          `[cosyvoice] Retry ${attempt}/${MAX_RETRIES} after ${delay}ms...`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }

      try {
        // RunPod /runsync endpoint
        const res = await fetch(env.COSYVOICE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.RUNPOD_API_KEY}`,
          },
          body: JSON.stringify(runpodPayload),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(
            `RunPod inference failed (${res.status}): ${errText}`,
          );
        }

        const runpodResult = await res.json();

        // RunPod specific response structure checks
        if (runpodResult.status !== "COMPLETED") {
          throw new Error(`RunPod returned unsuccessful status: ${runpodResult.status}`);
        }

        const output = runpodResult.output;
        if (!output || output.error) {
          throw new Error(`RunPod serverless error: ${output?.error ?? "Unknown execution error"}`);
        }

        const audioBase64 = output.audio;
        if (!audioBase64) {
          throw new Error("RunPod returned empty audio payload inside output object");
        }

        const outputBuffer = Buffer.from(audioBase64, "base64");

        console.log(
          `[cosyvoice] Synthesized audio (${outputBuffer.length} bytes WAV, duration: ${output.duration_sec}s)`,
        );

        hadPriorSuccess = true;
        return outputBuffer;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(
          `[cosyvoice] TTS attempt ${attempt + 1} failed: ${lastError.message}`,
        );

        // Per D-10: If TTS fails after previously succeeding, detect pod restart
        // and wait for recovery. Recovery waits do NOT count as retries.
        if (hadPriorSuccess && isPodRestartError(lastError)) {
          console.warn(`[cosyvoice] Pod restart detected — waiting for recovery...`);
          try {
            await this.waitForHealth(180000);
            // Don't count this attempt — retry the same segment
            attempt--;
            continue;
          } catch {
            console.error(`[cosyvoice] Pod recovery failed — continuing retry loop`);
          }
        }
      }
    }

    throw lastError ?? new Error("CosyVoice TTS failed after retries");
  },
};
