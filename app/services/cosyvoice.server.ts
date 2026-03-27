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
    // Guard: COSYVOICE_URL must be configured
    if (!env.COSYVOICE_URL) {
      throw new Error(
        "COSYVOICE_URL is not configured. Set it in your .env file to use CosyVoice TTS engine.",
      );
    }

    // Guard: reject empty text
    if (!text || text.trim().length === 0) {
      throw new Error("Cannot synthesize empty text");
    }

    const mode = selectMode(sourceLanguage, targetLanguage);
    const clampedSpeed = Math.max(0.5, Math.min(2.0, speed ?? 1.0));

    console.log(
      `[cosyvoice] Synthesizing (mode: ${mode}, target: ${targetLanguage}, speed: ${clampedSpeed})...`,
    );

    // Read reference audio as Blob for FormData
    const wavBuffer = fs.readFileSync(promptWavPath);
    const wavBlob = new Blob([wavBuffer], { type: "audio/wav" });

    // Build multipart/form-data payload
    const formData = new FormData();
    formData.append("text", text);
    formData.append("mode", mode);
    formData.append("speed", String(clampedSpeed));
    formData.append("reference_audio", wavBlob, "reference.wav");

    if (mode === "zero_shot" && promptText) {
      formData.append(
        "reference_text",
        `You are a helpful assistant.<|endofprompt|>${promptText}`,
      );
    } 

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
        // FastAPI /synthesize endpoint
        const res = await fetch(`${env.COSYVOICE_URL}/synthesize`, {
          method: "POST",
          // Let fetch automatically set the boundary in Content-Type header
          body: formData,
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(
            `CosyVoice inference failed (${res.status}): ${errText}`,
          );
        }

        // Response is a direct WAV binary stream
        const arrayBuffer = await res.arrayBuffer();
        const outputBuffer = Buffer.from(arrayBuffer);

        // Validate: non-empty response
        if (outputBuffer.length === 0) {
          throw new Error("CosyVoice returned empty audio payload");
        }

        console.log(
          `[cosyvoice] Synthesized audio (${outputBuffer.length} bytes WAV, mode: ${mode})`,
        );

        return outputBuffer;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(
          `[cosyvoice] TTS attempt ${attempt + 1} failed: ${lastError.message}`,
        );
      }
    }

    throw lastError ?? new Error("CosyVoice TTS failed after retries");
  },
};
