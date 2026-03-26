import * as fs from "fs";
import { env } from "~/utils/env.server";

// ── Constants ──────────────────────────────────────────────────────────

const COSYVOICE_SAMPLE_RATE = 24000;
const COSYVOICE_CHANNELS = 1;
const COSYVOICE_BIT_DEPTH = 16;
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
 * Wrap raw PCM bytes in a WAV header.
 * CosyVoice returns raw PCM int16, 24kHz, mono — FFmpeg needs a proper WAV.
 */
function pcmToWav(pcmBuffer: Buffer): Buffer {
  const byteRate =
    COSYVOICE_SAMPLE_RATE * COSYVOICE_CHANNELS * (COSYVOICE_BIT_DEPTH / 8);
  const blockAlign = COSYVOICE_CHANNELS * (COSYVOICE_BIT_DEPTH / 8);
  const dataSize = pcmBuffer.length;
  const fileSize = 36 + dataSize;

  const header = Buffer.alloc(44);

  // RIFF chunk descriptor
  header.write("RIFF", 0); // ChunkID
  header.writeUInt32LE(fileSize, 4); // ChunkSize
  header.write("WAVE", 8); // Format

  // fmt sub-chunk
  header.write("fmt ", 12); // Subchunk1ID
  header.writeUInt32LE(16, 16); // Subchunk1Size (PCM = 16)
  header.writeUInt16LE(1, 20); // AudioFormat (PCM = 1)
  header.writeUInt16LE(COSYVOICE_CHANNELS, 22); // NumChannels
  header.writeUInt32LE(COSYVOICE_SAMPLE_RATE, 24); // SampleRate
  header.writeUInt32LE(byteRate, 28); // ByteRate
  header.writeUInt16LE(blockAlign, 32); // BlockAlign
  header.writeUInt16LE(COSYVOICE_BIT_DEPTH, 34); // BitsPerSample

  // data sub-chunk
  header.write("data", 36); // Subchunk2ID
  header.writeUInt32LE(dataSize, 40); // Subchunk2Size

  return Buffer.concat([header, pcmBuffer]);
}

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

/**
 * Estimate audio duration from raw PCM byte count.
 * Formula: bytes / (sampleRate × channels × bytesPerSample)
 */
function estimateDurationSec(pcmBytes: number): number {
  return (
    pcmBytes /
    (COSYVOICE_SAMPLE_RATE * COSYVOICE_CHANNELS * (COSYVOICE_BIT_DEPTH / 8))
  );
}

// ── Service ────────────────────────────────────────────────────────────

/**
 * CosyVoice 3 service — cross-lingual voice cloning & TTS via self-hosted
 * FastAPI endpoint on RunPod Serverless (GPU).
 *
 * Mirrors the Fish Audio service pattern: object literal export, retry with
 * exponential backoff, response validation.
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
   * @param promptWavPath - Path to speaker reference WAV (≥16kHz mono, 3–10s)
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

    // Build multipart/form-data
    const form = new FormData();
    form.append("tts_text", text);
    form.append("mode", mode);
    form.append("stream", "false");
    form.append("speed", String(clampedSpeed));

    // Attach speaker reference audio
    const wavBuffer = fs.readFileSync(promptWavPath);
    const wavBlob = new Blob([wavBuffer], { type: "audio/wav" });
    form.append("prompt_wav", wavBlob, "reference.wav");

    // zero_shot mode requires prompt_text with special prefix
    if (mode === "zero_shot") {
      const prefix = "You are a helpful assistant.<|endofprompt|>";
      const fullPromptText = promptText
        ? `${prefix}${promptText}`
        : prefix;
      form.append("prompt_text", fullPromptText);
    }

    // Retry loop with exponential backoff (matching Fish Audio pattern)
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
        const res = await fetch(`${env.COSYVOICE_URL}/inference`, {
          method: "POST",
          body: form,
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(
            `CosyVoice inference failed (${res.status}): ${errText}`,
          );
        }

        const arrayBuffer = await res.arrayBuffer();
        const pcmBuffer = Buffer.from(arrayBuffer);

        // Validate: non-empty response
        if (pcmBuffer.length === 0) {
          throw new Error("CosyVoice returned empty response");
        }

        // Validate: duration estimation (catch garbage responses)
        const durationSec = estimateDurationSec(pcmBuffer.length);
        if (durationSec < 0.1) {
          throw new Error(
            `CosyVoice returned suspiciously short audio (${durationSec.toFixed(2)}s, ${pcmBuffer.length} bytes)`,
          );
        }

        console.log(
          `[cosyvoice] Synthesized ${durationSec.toFixed(2)}s audio (${pcmBuffer.length} bytes PCM, mode: ${mode})`,
        );

        // Convert raw PCM to WAV for FFmpeg compatibility
        return pcmToWav(pcmBuffer);
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
