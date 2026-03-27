import * as fs from "fs";
import { env } from "~/utils/env.server";

// ── Constants ──────────────────────────────────────────────────────────

const MAX_RETRIES = 2;

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
 * cross_lingual: source ≠ target (extracts timbre only, uses target phonology)
 * zero_shot: source = target (clones voice + style for same-language synthesis)
 */
function selectMode(
  sourceLanguage: string,
  targetLanguage: string,
): "cross_lingual" | "zero_shot" {
  return sourceLanguage === targetLanguage ? "zero_shot" : "cross_lingual";
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
   * Synthesize speech from text using a speaker reference audio.
   *
   * @param text - Text to synthesize in the target language
   * @param promptWavPath - Path to speaker reference WAV (≥16kHz mono, 3–30s)
   * @param sourceLanguage - ISO 639-1 code of the source audio language
   * @param targetLanguage - ISO 639-1 code of the target language
   * @param speed - Speech speed multiplier (0.5–2.0, default 1.0)
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
    const clampedSpeed = Math.max(0.5, Math.min(2.0, speed ?? 1.0));

    console.log(
      `[cosyvoice] Synthesizing via RunPod Serverless (mode: ${mode}, target: ${targetLanguage}, speed: ${clampedSpeed})...`,
    );

    // Read reference audio & encode to Base64
    const wavBuffer = fs.readFileSync(promptWavPath);
    const wavBase64 = wavBuffer.toString("base64");

    // Build JSON payload for RunPod Serverless
    const inputPayload: Record<string, any> = {
      tts_text: text,
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

    // Retry loop with exponential backoff
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = attempt * 1000;
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

        return outputBuffer;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(
          `[cosyvoice] TTS attempt ${attempt + 1} failed: ${lastError.message}`,
        );
      }
    }

    throw lastError ?? new Error("CosyVoice RunPod TTS failed after retries");
  },
};
