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
   * Uses async task pattern: POST to start → poll GET for result.
   * This avoids RunPod's Cloudflare proxy 100s timeout (524 errors).
   * Returns the background track as a Buffer.
   */
  async separateAudio(
    audioPath: string,
  ): Promise<{ background: Buffer; vocals: Buffer; sampleRate: number }> {
    const baseUrl = getPodBaseUrl();
    const separateUrl = `${baseUrl}/separate`;

    console.log(`[cosyvoice] Sending audio to Demucs /separate at ${separateUrl}...`);

    // Step 1: Upload file and start async task
    const audioBuffer = fs.readFileSync(audioPath);
    const blob = new Blob([audioBuffer], { type: "audio/wav" });
    const formData = new FormData();
    formData.append("audio", blob, "source-audio-full.wav");

    const startRes = await fetch(separateUrl, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(60000), // 60s to upload file
    });

    if (!startRes.ok) {
      const errText = await startRes.text();
      throw new Error(`Demucs /separate submit failed (${startRes.status}): ${errText}`);
    }

    const startData = await startRes.json();
    const taskId = startData.task_id;

    if (!taskId) {
      throw new Error("Demucs /separate did not return a task_id");
    }

    console.log(`[cosyvoice] Demucs task started: ${taskId}. Polling for result...`);

    // Step 2: Poll for completion (lightweight status-only responses)
    const pollUrl = `${baseUrl}/separate/${taskId}`;
    const pollTimeout = 600000; // 10 min max
    const pollInterval = 5000; // 5s between polls
    const start = Date.now();

    while (Date.now() - start < pollTimeout) {
      await new Promise((r) => setTimeout(r, pollInterval));

      const pollRes = await fetch(pollUrl, {
        signal: AbortSignal.timeout(15000),
      });

      if (!pollRes.ok) {
        const errText = await pollRes.text();
        throw new Error(`Demucs poll failed (${pollRes.status}): ${errText}`);
      }

      const pollData = await pollRes.json();

      if (pollData.status === "processing") {
        continue;
      }

      if (pollData.status === "completed") {
        // Step 3: Download each stem as a separate binary request (avoids base64 bloat & proxy size limits)
        const bgRes = await fetch(`${baseUrl}/separate/${taskId}/background`, {
          signal: AbortSignal.timeout(60000),
        });
        if (!bgRes.ok) throw new Error(`Failed to download background stem (${bgRes.status})`);
        const backgroundBuffer = Buffer.from(await bgRes.arrayBuffer());

        const vocalsRes = await fetch(`${baseUrl}/separate/${taskId}/vocals`, {
          signal: AbortSignal.timeout(60000),
        });
        if (!vocalsRes.ok) throw new Error(`Failed to download vocals stem (${vocalsRes.status})`);
        const vocalsBuffer = Buffer.from(await vocalsRes.arrayBuffer());

        // Clean up server-side files
        await fetch(`${baseUrl}/separate/${taskId}`, { method: "DELETE" }).catch(() => {});

        console.log(
          `[cosyvoice] Demucs separation complete in ${((Date.now() - start) / 1000).toFixed(1)}s — background: ${(backgroundBuffer.length / 1024).toFixed(0)}KB, vocals: ${(vocalsBuffer.length / 1024).toFixed(0)}KB`,
        );

        return {
          background: backgroundBuffer,
          vocals: vocalsBuffer,
          sampleRate: 44100, // Demucs htdemucs outputs at 44.1kHz
        };
      }

      // Any other status is an error
      throw new Error(`Demucs task failed: ${pollData.error ?? "Unknown error"}`);
    }

    throw new Error(`Demucs separation timed out after ${pollTimeout / 1000}s`);
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
    // Guard: reject empty text
    if (!text || text.trim().length === 0) {
      throw new Error("Cannot synthesize empty text");
    }

    const mode = selectMode(sourceLanguage, targetLanguage);
    // Per D-15: Always synthesize at speed=1.0. Do NOT use speed parameter for pacing.
    const clampedSpeed = 1.0;

    // Choose path: direct pod (fast) or RunPod Serverless (queued)
    if (env.RUNPOD_POD_ID) {
      // Pod's FastAPI server handles all text formatting (endofprompt + language tag).
      // Send plain text + target_language separately.
      return this.synthesizeViaPod(text, promptWavPath, mode, clampedSpeed, targetLanguage, promptText);
    }

    if (!env.COSYVOICE_URL || !env.RUNPOD_API_KEY) {
      throw new Error(
        "Either RUNPOD_POD_ID (for direct pod) or COSYVOICE_URL + RUNPOD_API_KEY (for serverless) must be configured.",
      );
    }

    // Serverless handler expects pre-formatted text with language tag
    const finalText = `<|${targetLanguage}|>${text}`;
    return this.synthesizeViaServerless(finalText, promptWavPath, mode, clampedSpeed, targetLanguage, promptText);
  },

  /**
   * Synthesize by calling the pod's FastAPI /synthesize endpoint directly.
   * Skips RunPod Serverless queue entirely — much faster when a pod is running.
   */
  async synthesizeViaPod(
    finalText: string,
    promptWavPath: string,
    mode: "cross_lingual" | "zero_shot",
    speed: number,
    targetLanguage: string,
    promptText?: string,
  ): Promise<Buffer> {
    const baseUrl = getPodBaseUrl();
    const synthesizeUrl = `${baseUrl}/synthesize`;

    console.log(
      `[cosyvoice] Synthesizing via Pod direct (mode: ${mode}, target: ${targetLanguage}, speed: ${speed})...`,
    );

    const wavBuffer = fs.readFileSync(promptWavPath);
    let lastError: Error | null = null;
    let hadPriorSuccess = false;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)];
        console.log(`[cosyvoice] Retry ${attempt}/${MAX_RETRIES} after ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }

      try {
        // Build multipart form matching FastAPI's expected fields
        const formData = new FormData();
        formData.append("text", finalText);
        formData.append("mode", mode);
        formData.append("speed", String(speed));
        formData.append("target_language", targetLanguage);
        formData.append("reference_text", promptText ?? "");
        formData.append(
          "reference_audio",
          new Blob([wavBuffer], { type: "audio/wav" }),
          "reference.wav",
        );

        const res = await fetch(synthesizeUrl, {
          method: "POST",
          body: formData,
          signal: AbortSignal.timeout(120000), // 2 min timeout per segment
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Pod /synthesize failed (${res.status}): ${errText}`);
        }

        // FastAPI returns raw WAV bytes as a streaming response
        const arrayBuffer = await res.arrayBuffer();
        const outputBuffer = Buffer.from(arrayBuffer);

        console.log(
          `[cosyvoice] Synthesized audio via pod (${outputBuffer.length} bytes WAV)`,
        );

        hadPriorSuccess = true;
        return outputBuffer;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[cosyvoice] TTS attempt ${attempt + 1} failed: ${lastError.message}`);

        if (hadPriorSuccess && isPodRestartError(lastError)) {
          console.warn(`[cosyvoice] Pod restart detected — waiting for recovery...`);
          try {
            await this.waitForHealth(180000);
            attempt--;
            continue;
          } catch {
            console.error(`[cosyvoice] Pod recovery failed — continuing retry loop`);
          }
        }
      }
    }

    throw lastError ?? new Error("CosyVoice TTS failed after retries (pod direct)");
  },

  /**
   * Synthesize via RunPod Serverless /runsync endpoint.
   * Fallback when no dedicated pod is running.
   */
  async synthesizeViaServerless(
    finalText: string,
    promptWavPath: string,
    mode: "cross_lingual" | "zero_shot",
    speed: number,
    targetLanguage: string,
    promptText?: string,
  ): Promise<Buffer> {
    console.log(
      `[cosyvoice] Synthesizing via RunPod Serverless (mode: ${mode}, target: ${targetLanguage}, speed: ${speed})...`,
    );

    const wavBuffer = fs.readFileSync(promptWavPath);
    const wavBase64 = wavBuffer.toString("base64");

    const inputPayload: Record<string, any> = {
      tts_text: finalText,
      mode: mode,
      speed: speed,
      prompt_wav: wavBase64,
    };

    if (mode === "zero_shot" && promptText) {
      inputPayload.prompt_text = promptText;
    }

    const runpodPayload = { input: inputPayload };

    let lastError: Error | null = null;
    let hadPriorSuccess = false;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)];
        console.log(`[cosyvoice] Retry ${attempt}/${MAX_RETRIES} after ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }

      try {
        const res = await fetch(env.COSYVOICE_URL!, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.RUNPOD_API_KEY}`,
          },
          body: JSON.stringify(runpodPayload),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`RunPod inference failed (${res.status}): ${errText}`);
        }

        const runpodResult = await res.json();

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
        console.warn(`[cosyvoice] TTS attempt ${attempt + 1} failed: ${lastError.message}`);

        if (hadPriorSuccess && isPodRestartError(lastError)) {
          console.warn(`[cosyvoice] Pod restart detected — waiting for recovery...`);
          try {
            await this.waitForHealth(180000);
            attempt--;
            continue;
          } catch {
            console.error(`[cosyvoice] Pod recovery failed — continuing retry loop`);
          }
        }
      }
    }

    throw lastError ?? new Error("CosyVoice TTS failed after retries (serverless)");
  },
};
